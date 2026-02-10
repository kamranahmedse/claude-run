import { describe, expect, test } from "bun:test";
import {
  closeSearchDb,
  computeCoverageSnapshot,
  determineExactSignals,
  indexSession,
  initSearchDb,
  rankMergedResults,
  removeIndexedSession,
  searchSessions,
  setExpectedSessions,
  shouldUseFuzzyForQuery,
  type HybridSearchResult,
} from "./search";

describe("hybrid search ranking", () => {
  test("exact literal match is ranked above fuzzy-only match", () => {
    const results: HybridSearchResult[] = [
      {
        sessionId: "fuzzy",
        source: "claude",
        display: "Fuzzy",
        project: "proj",
        snippet: "...approximate...",
        timestamp: 100,
        tier: 3,
        score: 50,
        signals: {
          exactLiteral: false,
          exactPhrase: false,
          exactTokens: false,
          fuzzy: true,
        },
      },
      {
        sessionId: "exact",
        source: "claude",
        display: "Exact",
        project: "proj",
        snippet: "...wa-sqlite...",
        timestamp: 90,
        tier: 1,
        score: 1,
        rank: -2,
        signals: {
          exactLiteral: true,
          exactPhrase: true,
          exactTokens: true,
          fuzzy: false,
        },
      },
    ];

    const ranked = rankMergedResults(results);
    expect(ranked[0]?.sessionId).toBe("exact");
  });

  test("exact phrase is detected for hyphenated query", () => {
    const signals = determineExactSignals("wa-sqlite", "Using WA-SQLite in browser");
    expect(signals.exactLiteral).toBe(true);
    expect(signals.exactPhrase).toBe(true);
    expect(signals.exactTokens).toBe(true);
  });

  test("exact matches are sorted by recency before BM25 rank", () => {
    const results: HybridSearchResult[] = [
      {
        sessionId: "old-high-rank",
        source: "claude",
        display: "Older",
        project: "proj",
        snippet: "...cusip...",
        timestamp: 1700000000000,
        tier: 1,
        score: 10,
        rank: -40,
        signals: {
          exactLiteral: true,
          exactPhrase: false,
          exactTokens: true,
          fuzzy: false,
        },
      },
      {
        sessionId: "new-low-rank",
        source: "claude",
        display: "Recent",
        project: "proj",
        snippet: "...cusip...",
        timestamp: 1800000000000,
        tier: 1,
        score: 9,
        rank: -1,
        signals: {
          exactLiteral: true,
          exactPhrase: false,
          exactTokens: true,
          fuzzy: false,
        },
      },
    ];

    const ranked = rankMergedResults(results);
    expect(ranked[0]?.sessionId).toBe("new-low-rank");
  });

  test("coverage marks partial when indexed sessions are incomplete", () => {
    const coverage = computeCoverageSnapshot(
      {
        claude: new Set(["a", "b"]),
        codex: new Set(["c"]),
      },
      new Set(["a"]),
      0,
    );

    expect(coverage.partial).toBe(true);
    expect(coverage.coverage.totalSessions).toBe(3);
    expect(coverage.coverage.indexedSessions).toBe(1);
  });

  test("coverage supports source-qualified keys to avoid id collisions", () => {
    const coverage = computeCoverageSnapshot(
      {
        claude: new Set(["same-id"]),
        codex: new Set(["same-id"]),
      },
      new Set(["claude:same-id"]),
      0,
    );

    expect(coverage.partial).toBe(true);
    expect(coverage.coverage.indexedSessions).toBe(1);
    expect(coverage.coverage.bySource.claude.indexed).toBe(1);
    expect(coverage.coverage.bySource.codex.indexed).toBe(0);
  });

  test("search keeps results from different sources when session ids collide", () => {
    initSearchDb();

    const collidingId = `collision-${Date.now()}`;
    const token = `uniqtoken-${Date.now()}`;

    setExpectedSessions([
      { id: collidingId, source: "claude" },
      { id: collidingId, source: "codex" },
    ]);

    indexSession(collidingId, "claude", "Claude collision", "proj-a", `content ${token}`, Date.now());
    indexSession(collidingId, "codex", "Codex collision", "proj-b", `content ${token}`, Date.now() + 1);

    const response = searchSessions(token, undefined, { fuzzy: false, limit: 20 });
    const hits = response.results.filter((r) => r.sessionId === collidingId);

    expect(hits.length).toBe(2);
    expect(new Set(hits.map((h) => h.source))).toEqual(new Set(["claude", "codex"]));

    removeIndexedSession(collidingId);
    closeSearchDb();
  });

  test("disables fuzzy for very short queries to keep typing fluid", () => {
    expect(shouldUseFuzzyForQuery("a")).toBe(false);
    expect(shouldUseFuzzyForQuery("wa")).toBe(false);
    expect(shouldUseFuzzyForQuery("was")).toBe(true);
    expect(shouldUseFuzzyForQuery("wa-sqlite")).toBe(true);
  });
});
