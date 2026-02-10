import { Database } from "bun:sqlite";
import { join } from "path";
import { mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import FlexSearch from "flexsearch";

export interface SearchSignals {
  exactLiteral: boolean;
  exactPhrase: boolean;
  exactTokens: boolean;
  fuzzy: boolean;
}

export interface HybridSearchResult {
  sessionId: string;
  source: string;
  display: string;
  project: string;
  snippet: string;
  timestamp: number;
  tier: 1 | 2 | 3;
  score: number;
  rank?: number;
  signals: SearchSignals;
}

export interface SearchCoverage {
  indexedSessions: number;
  totalSessions: number;
  bySource: Record<string, { indexed: number; total: number }>;
  lastUpdatedAt: number;
}

export interface SearchResponse {
  query: string;
  partial: boolean;
  coverage: SearchCoverage;
  results: HybridSearchResult[];
}

interface SearchOptions {
  fuzzy?: boolean;
  limit?: number;
}

interface FuzzyDoc {
  sessionId: string;
  source: string;
  display: string;
  project: string;
  content: string;
  timestamp: number;
}

let db: Database | null = null;
let fuzzyIndex = new FlexSearch.Index({
  tokenize: "forward",
  cache: true,
  resolution: 9,
});

const fuzzyDocs = new Map<string, FuzzyDoc>();
const dirtySessionIds = new Set<string>();

let expectedBySource = new Map<string, Set<string>>();
const indexedIds = new Set<string>();
const indexedBySource = new Map<string, Set<string>>();

function makeSessionKey(source: string, sessionId: string): string {
  return `${source}:${sessionId}`;
}

function ensureSourceSet(map: Map<string, Set<string>>, source: string): Set<string> {
  const existing = map.get(source);
  if (existing) return existing;
  const created = new Set<string>();
  map.set(source, created);
  return created;
}

function resetFuzzyIndex(): void {
  fuzzyIndex = new FlexSearch.Index({
    tokenize: "forward",
    cache: true,
    resolution: 9,
  });
  fuzzyDocs.clear();
}

export function tokenizeSearchQuery(query: string): string[] {
  return query
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter(Boolean) || [];
}

export function shouldUseFuzzyForQuery(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length < 3) return false;
  return tokenizeSearchQuery(trimmed).length > 0;
}

function buildFtsQuery(query: string): string {
  const tokens = tokenizeSearchQuery(query);
  if (tokens.length === 0) return "";
  return tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(" ");
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, "");
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function determineExactSignals(query: string, haystack: string): Omit<SearchSignals, "fuzzy"> {
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedHaystack = stripHtml(haystack).toLowerCase();

  if (!normalizedQuery) {
    return {
      exactLiteral: false,
      exactPhrase: false,
      exactTokens: false,
    };
  }

  const tokens = tokenizeSearchQuery(normalizedQuery);
  const exactTokens = tokens.length > 0 && tokens.every((token) => normalizedHaystack.includes(token));
  const exactLiteral = normalizedHaystack.includes(normalizedQuery);

  let exactPhrase = false;
  if (tokens.length > 1) {
    const literalWithSpace = normalizedHaystack.includes(tokens.join(" "));
    const separatorPattern = tokens
      .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[^\\p{L}\\p{N}]+");

    let separatorMatch = false;
    try {
      separatorMatch = new RegExp(separatorPattern, "iu").test(normalizedHaystack);
    } catch {
      separatorMatch = false;
    }

    exactPhrase = literalWithSpace || separatorMatch;
  }

  return {
    exactLiteral,
    exactPhrase,
    exactTokens,
  };
}

export function rankMergedResults(results: HybridSearchResult[]): HybridSearchResult[] {
  return [...results].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;

    if (a.tier === 1 || a.tier === 2) {
      // For exact results, prefer recency first so active conversations surface immediately.
      // Keep quality signals before timestamp, but do not let BM25 rank override recency.
      if (a.signals.exactLiteral !== b.signals.exactLiteral) {
        return Number(b.signals.exactLiteral) - Number(a.signals.exactLiteral);
      }
      if (a.signals.exactPhrase !== b.signals.exactPhrase) {
        return Number(b.signals.exactPhrase) - Number(a.signals.exactPhrase);
      }
      if (a.signals.exactTokens !== b.signals.exactTokens) {
        return Number(b.signals.exactTokens) - Number(a.signals.exactTokens);
      }
      if (a.timestamp !== b.timestamp) {
        return b.timestamp - a.timestamp;
      }
      if (a.rank !== undefined && b.rank !== undefined && a.rank !== b.rank) {
        return a.rank - b.rank;
      }
      return b.score - a.score;
    }

    if (a.score !== b.score) return b.score - a.score;
    return b.timestamp - a.timestamp;
  });
}

export function computeCoverageSnapshot(
  expected: Record<string, Set<string>>,
  indexed: Set<string>,
  dirtyCount: number,
): { partial: boolean; coverage: SearchCoverage } {
  const bySource: Record<string, { indexed: number; total: number }> = {};
  let totalSessions = 0;
  let indexedSessions = 0;

  for (const [source, ids] of Object.entries(expected)) {
    const total = ids.size;
    let indexedForSource = 0;
    for (const id of ids) {
      if (indexed.has(id) || indexed.has(makeSessionKey(source, id))) {
        indexedForSource++;
      }
    }
    bySource[source] = { indexed: indexedForSource, total };
    totalSessions += total;
    indexedSessions += indexedForSource;
  }

  return {
    partial: indexedSessions < totalSessions || dirtyCount > 0,
    coverage: {
      indexedSessions,
      totalSessions,
      bySource,
      lastUpdatedAt: Date.now(),
    },
  };
}

function getCoverageSnapshot(): { partial: boolean; coverage: SearchCoverage } {
  const expectedRecord: Record<string, Set<string>> = {};
  for (const [source, ids] of expectedBySource.entries()) {
    expectedRecord[source] = ids;
  }
  return computeCoverageSnapshot(expectedRecord, indexedIds, dirtySessionIds.size);
}

function buildFuzzySnippet(text: string, queryTokens: string[]): string {
  if (!text.trim()) return "";

  const cleaned = text.replace(/\s+/g, " ").trim();
  const lower = cleaned.toLowerCase();
  let firstIdx = -1;

  for (const token of queryTokens) {
    const idx = lower.indexOf(token.toLowerCase());
    if (idx !== -1 && (firstIdx === -1 || idx < firstIdx)) {
      firstIdx = idx;
    }
  }

  const radius = 80;
  const start = Math.max(0, (firstIdx === -1 ? 0 : firstIdx) - radius);
  const end = Math.min(cleaned.length, (firstIdx === -1 ? 160 : firstIdx + radius));
  let snippet = cleaned.slice(start, end);
  if (start > 0) snippet = `...${snippet}`;
  if (end < cleaned.length) snippet = `${snippet}...`;

  let escaped = escapeHtml(snippet);
  if (queryTokens.length > 0) {
    const pattern = queryTokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    if (pattern) {
      const regex = new RegExp(`(${pattern})`, "gi");
      escaped = escaped.replace(regex, '<mark class="search-highlight">$1</mark>');
    }
  }

  return escaped;
}

function normalizeFuzzySearchResult(result: unknown): string[] {
  if (!Array.isArray(result)) return [];
  if (result.length === 0) return [];

  if (Array.isArray(result[0])) {
    return (result as unknown[])
      .flat()
      .map((id) => String(id));
  }

  return (result as unknown[]).map((id) => String(id));
}

function toFuzzyText(display: string, project: string, content: string): string {
  return `${display}\n${project}\n${content}`;
}

function inferScore(tier: 1 | 2 | 3, rank: number | undefined, order: number): number {
  if (tier === 1) {
    return 3000 - (rank ?? 0);
  }
  if (tier === 2) {
    return 2000 - (rank ?? 0);
  }
  return 1000 - order;
}

function rebuildInMemoryStateFromDb(): void {
  if (!db) return;

  indexedIds.clear();
  indexedBySource.clear();
  resetFuzzyIndex();

  const indexedRows = db.query("SELECT session_id as sessionId, source FROM session_index_meta").all() as Array<{ sessionId: string; source: string }>;
  for (const row of indexedRows) {
    const key = makeSessionKey(row.source, row.sessionId);
    indexedIds.add(key);
    ensureSourceSet(indexedBySource, row.source).add(row.sessionId);
  }

  const fuzzyRows = db.query(
    `SELECT
      f.session_id as sessionId,
      f.source,
      f.display,
      f.project,
      f.content,
      COALESCE(m.session_timestamp, 0) as timestamp
    FROM sessions_fts f
    LEFT JOIN session_index_meta m ON f.session_id = m.session_id AND f.source = m.source`
  ).all() as Array<{ sessionId: string; source: string; display: string; project: string; content: string; timestamp: number }>;

  for (const row of fuzzyRows) {
    const doc: FuzzyDoc = {
      sessionId: row.sessionId,
      source: row.source,
      display: row.display,
      project: row.project,
      content: row.content || "",
      timestamp: row.timestamp || 0,
    };
    const key = makeSessionKey(doc.source, doc.sessionId);
    fuzzyDocs.set(key, doc);
    fuzzyIndex.add(key, toFuzzyText(doc.display, doc.project, doc.content));
  }
}

export function initSearchDb(): void {
  const dbDir = join(homedir(), ".claude-run-plus");
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(join(dbDir, "search.db"));
  db.run("PRAGMA journal_mode=WAL");
  db.run("PRAGMA synchronous=NORMAL");

  db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
      session_id UNINDEXED,
      source UNINDEXED,
      display,
      project,
      content,
      tokenize='unicode61'
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS session_index_meta (
      session_id TEXT NOT NULL,
      source TEXT NOT NULL,
      content_hash TEXT,
      session_timestamp INTEGER DEFAULT 0,
      last_indexed_at INTEGER,
      PRIMARY KEY (source, session_id)
    )
  `);

  const cols = db.query("PRAGMA table_info(session_index_meta)").all() as Array<{ name: string; pk: number }>;
  const hasCompositePk = cols.some((c) => c.name === "source" && c.pk > 0) && cols.some((c) => c.name === "session_id" && c.pk > 0);

  if (!hasCompositePk) {
    const hasContentHashCol = cols.some((c) => c.name === "content_hash");
    const hasSessionTimestampCol = cols.some((c) => c.name === "session_timestamp");

    db.run(`
      CREATE TABLE IF NOT EXISTS session_index_meta_v2 (
        session_id TEXT NOT NULL,
        source TEXT NOT NULL,
        content_hash TEXT,
        session_timestamp INTEGER DEFAULT 0,
        last_indexed_at INTEGER,
        PRIMARY KEY (source, session_id)
      )
    `);

    const contentHashSelect = hasContentHashCol ? "content_hash" : "NULL";
    const sessionTimestampSelect = hasSessionTimestampCol ? "COALESCE(session_timestamp, 0)" : "0";

    db.run(`
      INSERT OR REPLACE INTO session_index_meta_v2 (session_id, source, content_hash, session_timestamp, last_indexed_at)
      SELECT session_id, COALESCE(source, 'unknown'), ${contentHashSelect}, ${sessionTimestampSelect}, last_indexed_at
      FROM session_index_meta
    `);

    db.run("DROP TABLE session_index_meta");
    db.run("ALTER TABLE session_index_meta_v2 RENAME TO session_index_meta");
  }

  const refreshedCols = db.query("PRAGMA table_info(session_index_meta)").all() as Array<{ name: string }>;
  if (!refreshedCols.some((c) => c.name === "session_timestamp")) {
    db.run("ALTER TABLE session_index_meta ADD COLUMN session_timestamp INTEGER DEFAULT 0");
  }
  if (!refreshedCols.some((c) => c.name === "content_hash")) {
    db.run("ALTER TABLE session_index_meta ADD COLUMN content_hash TEXT");
  }

  rebuildInMemoryStateFromDb();
}

export function setExpectedSessions(sessions: Array<{ id: string; source: string }>): void {
  const next = new Map<string, Set<string>>();

  for (const session of sessions) {
    ensureSourceSet(next, session.source).add(session.id);
  }

  expectedBySource = next;
}

export function indexSession(
  sessionId: string,
  source: string,
  display: string,
  project: string,
  content: string,
  timestamp: number = 0,
): void {
  if (!db) return;

  db.run("DELETE FROM sessions_fts WHERE session_id = ? AND source = ?", [sessionId, source]);
  db.run(
    "INSERT INTO sessions_fts (session_id, source, display, project, content) VALUES (?, ?, ?, ?, ?)",
    [sessionId, source, display, project, content],
  );

  const contentHash = String(Bun.hash(content));

  db.run(
    "INSERT OR REPLACE INTO session_index_meta (session_id, source, content_hash, session_timestamp, last_indexed_at) VALUES (?, ?, ?, ?, ?)",
    [sessionId, source, contentHash, timestamp, Date.now()],
  );

  const key = makeSessionKey(source, sessionId);
  indexedIds.add(key);
  ensureSourceSet(indexedBySource, source).add(sessionId);

  if (fuzzyDocs.has(key)) {
    fuzzyIndex.remove(key);
  }

  const fuzzyDoc: FuzzyDoc = {
    sessionId,
    source,
    display,
    project,
    content,
    timestamp,
  };

  fuzzyDocs.set(key, fuzzyDoc);
  fuzzyIndex.add(key, toFuzzyText(display, project, content));

  dirtySessionIds.delete(sessionId);
}

export function removeIndexedSession(sessionId: string, source?: string): void {
  if (!db) return;

  const rows = source
    ? db.query("SELECT source FROM session_index_meta WHERE session_id = ? AND source = ?").all(sessionId, source) as Array<{ source: string }>
    : db.query("SELECT source FROM session_index_meta WHERE session_id = ?").all(sessionId) as Array<{ source: string }>;

  if (source) {
    db.run("DELETE FROM sessions_fts WHERE session_id = ? AND source = ?", [sessionId, source]);
    db.run("DELETE FROM session_index_meta WHERE session_id = ? AND source = ?", [sessionId, source]);
  } else {
    db.run("DELETE FROM sessions_fts WHERE session_id = ?", [sessionId]);
    db.run("DELETE FROM session_index_meta WHERE session_id = ?", [sessionId]);
  }

  for (const row of rows) {
    const key = makeSessionKey(row.source, sessionId);
    indexedIds.delete(key);

    const bySource = indexedBySource.get(row.source);
    bySource?.delete(sessionId);
    if (bySource && bySource.size === 0) {
      indexedBySource.delete(row.source);
    }

    if (fuzzyDocs.has(key)) {
      fuzzyIndex.remove(key);
      fuzzyDocs.delete(key);
    }
  }

  if (source) {
    expectedBySource.get(source)?.delete(sessionId);
  } else {
    for (const ids of expectedBySource.values()) {
      ids.delete(sessionId);
    }
  }

  dirtySessionIds.delete(sessionId);
}

export function isSessionIndexed(sessionId: string, source?: string): boolean {
  if (!db) return false;

  if (source) {
    const result = db.query("SELECT 1 FROM session_index_meta WHERE session_id = ? AND source = ?").get(sessionId, source);
    return !!result;
  }

  const result = db.query("SELECT 1 FROM session_index_meta WHERE session_id = ?").get(sessionId);
  return !!result;
}

export function markSessionDirty(sessionId: string): void {
  dirtySessionIds.add(sessionId);
}

export function getDirtySessions(): string[] {
  const ids = [...dirtySessionIds];
  dirtySessionIds.clear();
  return ids;
}

export function searchSessions(query: string, source?: string, options: SearchOptions = {}): SearchResponse {
  const normalizedQuery = query.trim();
  const { partial, coverage } = getCoverageSnapshot();

  if (!db || !normalizedQuery) {
    return {
      query,
      partial,
      coverage,
      results: [],
    };
  }

  const tokens = tokenizeSearchQuery(normalizedQuery);
  const ftsQuery = buildFtsQuery(normalizedQuery);

  if (!ftsQuery) {
    return {
      query,
      partial,
      coverage,
      results: [],
    };
  }

  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const includeFuzzy = options.fuzzy !== false && shouldUseFuzzyForQuery(normalizedQuery);
  const exactCandidateLimit = Math.max(limit * 10, 300);

  let sql = `
    SELECT
      f.session_id as sessionId,
      f.source,
      f.display,
      f.project,
      f.content,
      snippet(sessions_fts, -1, '<mark class="search-highlight">', '</mark>', '...', 24) as snippet,
      bm25(sessions_fts, 0, 0, 5.0, 3.0, 10.0) as rank,
      COALESCE(m.session_timestamp, 0) as timestamp
    FROM sessions_fts f
    LEFT JOIN session_index_meta m ON f.session_id = m.session_id AND f.source = m.source
    WHERE sessions_fts MATCH ?
  `;

  const params: (string | number)[] = [ftsQuery];

  if (source) {
    sql += " AND f.source = ?";
    params.push(source);
  }

  sql += ` ORDER BY rank LIMIT ${exactCandidateLimit}`;

  const merged = new Map<string, HybridSearchResult>();

  try {
    const exactRows = db.query(sql).all(...params) as Array<{
      sessionId: string;
      source: string;
      display: string;
      project: string;
      content: string;
      snippet: string;
      rank: number;
      timestamp: number;
    }>;

    for (const row of exactRows) {
      const exact = determineExactSignals(normalizedQuery, `${row.display}\n${row.project}\n${row.content}`);
      const tier: 1 | 2 = exact.exactLiteral || exact.exactPhrase ? 1 : 2;
      const key = makeSessionKey(row.source, row.sessionId);

      merged.set(key, {
        sessionId: row.sessionId,
        source: row.source,
        display: row.display,
        project: row.project,
        snippet: row.snippet,
        timestamp: Number(row.timestamp) || 0,
        rank: Number(row.rank) || 0,
        tier,
        score: inferScore(tier, Number(row.rank) || 0, 0),
        signals: {
          exactLiteral: exact.exactLiteral,
          exactPhrase: exact.exactPhrase,
          exactTokens: exact.exactTokens,
          fuzzy: false,
        },
      });
    }

    if (includeFuzzy) {
      const fuzzyRaw = fuzzyIndex.search(normalizedQuery, { limit: 300 });
      const fuzzyIds = normalizeFuzzySearchResult(fuzzyRaw);
      let fuzzyOrder = 0;

      for (const fuzzyId of fuzzyIds) {
        const doc = fuzzyDocs.get(fuzzyId);
        if (!doc) continue;
        if (source && doc.source !== source) continue;

        const existing = merged.get(fuzzyId);
        if (existing) {
          existing.signals.fuzzy = true;
          existing.score += 10;
          continue;
        }

        const snippet = buildFuzzySnippet(doc.content || `${doc.display}\n${doc.project}`, tokens);

        merged.set(fuzzyId, {
          sessionId: doc.sessionId,
          source: doc.source,
          display: doc.display,
          project: doc.project,
          snippet,
          timestamp: doc.timestamp,
          tier: 3,
          score: inferScore(3, undefined, fuzzyOrder),
          signals: {
            exactLiteral: false,
            exactPhrase: false,
            exactTokens: false,
            fuzzy: true,
          },
        });

        fuzzyOrder++;
      }
    }
  } catch {
    return {
      query,
      partial,
      coverage,
      results: [],
    };
  }

  const ranked = rankMergedResults([...merged.values()]).slice(0, limit);

  return {
    query,
    partial,
    coverage,
    results: ranked,
  };
}

export function closeSearchDb(): void {
  if (db) {
    db.close();
    db = null;
  }

  dirtySessionIds.clear();
  expectedBySource.clear();
  indexedIds.clear();
  indexedBySource.clear();
  resetFuzzyIndex();
}
