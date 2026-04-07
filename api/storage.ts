import { readdir, readFile, writeFile, stat, open } from "fs/promises";
import { join, basename, dirname } from "path";
import { homedir } from "os";
import { createInterface } from "readline";
import { findPricing, calculateSessionCosts, type TurnUsage, type SessionCosts } from "./pricing";
import {
  createSessionIdSearchResult,
  createSnippet,
  escapeRegExp,
  matchesSessionId,
} from "./search-utils";

export interface HistoryEntry {
  display: string;
  timestamp: number;
  project: string;
  sessionId?: string;
}

export interface Session {
  id: string;
  display: string;
  timestamp: number;
  project: string;
  projectName: string;
  messageCount: number;
  model?: string;
  provider: "claude" | "codex" | "gemini";
  surface?: "cli" | "tui" | "app" | "exec";
  capabilities?: {
    delete?: boolean;
  };
}

export interface ConversationMessage {
  type: "user" | "assistant" | "summary" | "file-history-snapshot";
  uuid?: string;
  parentUuid?: string;
  timestamp?: string;
  sessionId?: string;
  message?: {
    role: string;
    content: string | ContentBlock[];
    model?: string;
    usage?: TokenUsage;
  };
  summary?: string;
}

export interface ContentBlock {
  type: "text" | "thinking" | "tool_use" | "tool_result";
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | ContentBlock[];
  is_error?: boolean;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
}

export interface SessionTokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_write_5m_tokens: number;
  cache_write_1h_tokens: number;
  cache_read_tokens: number;
}

export interface SubagentInfo {
  agentId: string;
  toolUseId: string;
}

export interface StreamResult {
  messages: ConversationMessage[];
  nextOffset: number;
}

export interface SearchMatch {
  messageIndex: number;
  text: string;
  snippet: string;
}

export interface SearchResult {
  sessionId: string;
  display: string;
  projectName: string;
  timestamp: number;
  matchCount: number;
  firstMatch: SearchMatch;
  provider?: "claude" | "codex" | "gemini";
}

let claudeDir = join(homedir(), ".claude");
let projectsDir = join(claudeDir, "projects");
const fileIndex = new Map<string, string>();
const sessionMetaCache = new Map<string, { count: number; model?: string }>();
const orphanDisplayCache = new Map<string, string>();
let historyCache: HistoryEntry[] | null = null;
const pendingRequests = new Map<string, Promise<unknown>>();

export function initStorage(dir?: string): void {
  claudeDir = dir ?? join(homedir(), ".claude");
  projectsDir = join(claudeDir, "projects");
}

export function getClaudeDir(): string {
  return claudeDir;
}

export function invalidateHistoryCache(): void {
  historyCache = null;
}

export function addToFileIndex(sessionId: string, filePath: string): void {
  fileIndex.set(sessionId, filePath);
}

export function hasSession(sessionId: string): boolean {
  return fileIndex.has(sessionId);
}

export function invalidateSessionMeta(sessionId: string): void {
  sessionMetaCache.delete(sessionId);
}

function encodeProjectPath(path: string): string {
  return path.replace(/[/.]/g, "-");
}

function getProjectName(projectPath: string): string {
  const parts = projectPath.split("/").filter(Boolean);
  return parts[parts.length - 1] || projectPath;
}

function decodeProjectDir(dirName: string): string {
  return dirName.startsWith("-")
    ? "/" + dirName.slice(1).replace(/-/g, "/")
    : dirName;
}

async function getOrphanSessionDisplay(sessionId: string, filePath: string): Promise<string> {
  const cached = orphanDisplayCache.get(sessionId);
  if (cached !== undefined) return cached;
  let display = "";
  try {
    const content = await readFile(filePath, "utf-8");
    const firstNewline = content.indexOf("\n");
    const firstLine = firstNewline === -1 ? content : content.slice(0, firstNewline);
    if (firstLine.trim()) {
      const msg: ConversationMessage = JSON.parse(firstLine);
      if (msg.type === "user" && msg.message?.content) {
        const c = msg.message.content;
        const text = typeof c === "string" ? c : c.filter((b) => b.type === "text").map((b) => (b as any).text).join(" ");
        display = text.slice(0, 200);
      }
    }
  } catch {}
  orphanDisplayCache.set(sessionId, display);
  return display;
}

async function buildFileIndex(): Promise<void> {
  try {
    const projectDirs = await readdir(projectsDir, { withFileTypes: true });
    const directories = projectDirs.filter((d) => d.isDirectory());

    await Promise.all(
      directories.map(async (dir) => {
        try {
          const projectPath = join(projectsDir, dir.name);
          const files = await readdir(projectPath);
          for (const file of files) {
            if (file.endsWith(".jsonl")) {
              const sessionId = basename(file, ".jsonl");
              fileIndex.set(sessionId, join(projectPath, file));
            }
          }
        } catch {
          // Ignore errors for individual directories
        }
      })
    );
  } catch {
    // Projects directory may not exist yet
  }
}

async function loadHistoryCache(): Promise<HistoryEntry[]> {
  try {
    const historyPath = join(claudeDir, "history.jsonl");
    const content = await readFile(historyPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const entries: HistoryEntry[] = [];

    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Skip malformed lines
      }
    }

    historyCache = entries;
    return entries;
  } catch {
    historyCache = [];
    return [];
  }
}

async function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = pendingRequests.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const promise = fn().finally(() => {
    pendingRequests.delete(key);
  });

  pendingRequests.set(key, promise);
  return promise;
}

async function findSessionByTimestamp(
  encodedProject: string,
  timestamp: number
): Promise<string | undefined> {
  try {
    const projectPath = join(projectsDir, encodedProject);
    const files = await readdir(projectPath);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

    const fileStats = await Promise.all(
      jsonlFiles.map(async (file) => {
        const filePath = join(projectPath, file);
        const fileStat = await stat(filePath);
        return { file, mtime: fileStat.mtimeMs };
      })
    );

    let closestFile: string | null = null;
    let closestTimeDiff = Infinity;

    for (const { file, mtime } of fileStats) {
      const timeDiff = Math.abs(mtime - timestamp);
      if (timeDiff < closestTimeDiff) {
        closestTimeDiff = timeDiff;
        closestFile = file;
      }
    }

    if (closestFile) {
      return basename(closestFile, ".jsonl");
    }
  } catch {
    // Project directory doesn't exist
  }

  return undefined;
}

async function findSessionFile(sessionId: string): Promise<string | null> {
  if (fileIndex.has(sessionId)) {
    return fileIndex.get(sessionId)!;
  }

  const targetFile = `${sessionId}.jsonl`;

  try {
    const projectDirs = await readdir(projectsDir, { withFileTypes: true });
    const directories = projectDirs.filter((d) => d.isDirectory());

    const results = await Promise.all(
      directories.map(async (dir) => {
        try {
          const projectPath = join(projectsDir, dir.name);
          const files = await readdir(projectPath);
          if (files.includes(targetFile)) {
            return join(projectPath, targetFile);
          }
        } catch {
          // Ignore errors for individual directories
        }
        return null;
      })
    );

    const filePath = results.find((r) => r !== null);
    if (filePath) {
      fileIndex.set(sessionId, filePath);
      return filePath;
    }
  } catch (err) {
    console.error("Error finding session file:", err);
  }

  return null;
}

async function countSessionMessages(sessionId: string): Promise<{ count: number; model?: string }> {
  const cached = sessionMetaCache.get(sessionId);
  if (cached) return cached;

  const filePath = await findSessionFile(sessionId);
  if (!filePath) {
    return { count: 0 };
  }

  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    let count = 0;
    let model: string | undefined;
    for (const line of lines) {
      try {
        const msg: ConversationMessage = JSON.parse(line);
        if (msg.type === "user" || msg.type === "assistant") {
          count++;
          if (!model && msg.type === "assistant" && msg.message?.model) {
            model = msg.message.model;
          }
        }
      } catch {
        // Skip malformed lines
      }
    }
    const result = { count, model };
    sessionMetaCache.set(sessionId, result);
    return result;
  } catch {
    return { count: 0 };
  }
}

export async function loadStorage(): Promise<void> {
  await Promise.all([buildFileIndex(), loadHistoryCache()]);
}

export async function getSessions(): Promise<Session[]> {
  return dedupe("getSessions", async () => {
    const entries = historyCache ?? (await loadHistoryCache());
    const seenIds = new Set<string>();

    // Phase 1: resolve sessionIds and deduplicate
    const resolvedEntries: { sessionId: string; entry: HistoryEntry }[] = [];
    for (const entry of entries) {
      let sessionId = entry.sessionId;
      if (!sessionId) {
        const encodedProject = encodeProjectPath(entry.project);
        sessionId = await findSessionByTimestamp(encodedProject, entry.timestamp);
      }

      if (!sessionId || seenIds.has(sessionId)) {
        continue;
      }

      seenIds.add(sessionId);
      resolvedEntries.push({ sessionId, entry });
    }

    // Phase 2: count messages in parallel
    const sessions = await Promise.all(
      resolvedEntries.map(async ({ sessionId, entry }) => {
        const { count: messageCount, model } = await countSessionMessages(sessionId);
        return {
          id: sessionId,
          display: entry.display,
          timestamp: entry.timestamp,
          project: entry.project,
          projectName: getProjectName(entry.project),
          messageCount,
          model,
          provider: "claude" as const,
        };
      })
    );

    // Phase 3: include orphan sessions (on disk but not in history.jsonl)
    const ORPHAN_BATCH = 100;
    const orphanEntries = [...fileIndex.entries()].filter(([id]) => !seenIds.has(id));
    for (let i = 0; i < orphanEntries.length; i += ORPHAN_BATCH) {
      const batch = orphanEntries.slice(i, i + ORPHAN_BATCH);
      const orphanSessions = await Promise.all(
        batch.map(async ([sessionId, filePath]) => {
          const { count: messageCount, model } = await countSessionMessages(sessionId);
          if (messageCount === 0) return null;
          const dirName = basename(dirname(filePath));
          const project = decodeProjectDir(dirName);
          let timestamp = Date.now();
          try {
            const fileStat = await stat(filePath);
            timestamp = fileStat.mtimeMs;
          } catch {}
          const display = await getOrphanSessionDisplay(sessionId, filePath);
          return {
            id: sessionId,
            display: display || sessionId,
            timestamp,
            project,
            projectName: getProjectName(project),
            messageCount,
            model,
            provider: "claude" as const,
          };
        })
      );
      for (const s of orphanSessions) {
        if (s) sessions.push(s);
      }
    }

    return sessions.sort((a, b) => b.timestamp - a.timestamp);
  });
}

export async function getProjects(): Promise<string[]> {
  const entries = historyCache ?? (await loadHistoryCache());
  const projects = new Set<string>();

  for (const entry of entries) {
    if (entry.project) {
      projects.add(entry.project);
    }
  }

  // Include projects that only have orphan sessions
  for (const [, filePath] of fileIndex) {
    const dirName = basename(dirname(filePath));
    const project = decodeProjectDir(dirName);
    if (project) projects.add(project);
  }

  return [...projects].sort();
}

export async function getConversation(
  sessionId: string
): Promise<ConversationMessage[]> {
  return dedupe(`getConversation:${sessionId}`, async () => {
    const filePath = await findSessionFile(sessionId);

    if (!filePath) {
      return [];
    }

    const messages: ConversationMessage[] = [];

    try {
      const content = await readFile(filePath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);

      for (const line of lines) {
        try {
          const msg: ConversationMessage = JSON.parse(line);
          if (msg.type === "user" || msg.type === "assistant") {
            messages.push(msg);
          } else if (msg.type === "summary") {
            messages.unshift(msg);
          }
        } catch {
          // Skip malformed lines
        }
      }
    } catch (err) {
      console.error("Error reading conversation:", err);
    }

    return messages;
  });
}

export type { SessionCosts };

export interface SessionMeta {
  usage: SessionTokenUsage;
  subagents: SubagentInfo[];
  model?: string;
  costs: SessionCosts | null;
}

export async function getSessionMeta(sessionId: string): Promise<SessionMeta> {
  const usage: SessionTokenUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_write_5m_tokens: 0,
    cache_write_1h_tokens: 0,
    cache_read_tokens: 0,
  };
  const subagents: SubagentInfo[] = [];
  const turns: TurnUsage[] = [];
  let model: string | undefined;

  const filePath = await findSessionFile(sessionId);
  if (!filePath) return { usage, subagents, costs: null };

  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const seenAgents = new Set<string>();

    for (const line of lines) {
      try {
        const msg = JSON.parse(line);

        // Accumulate token usage from assistant messages
        if (msg.type === "assistant") {
          if (!model && msg.message?.model) {
            model = msg.message.model;
          }
          const u = msg?.message?.usage;
          if (u) {
            const turnInput = u.input_tokens ?? 0;
            const turnOutput = u.output_tokens ?? 0;
            const turnCacheRead = u.cache_read_input_tokens ?? 0;
            let turnCacheWrite5m = 0;
            let turnCacheWrite1h = 0;

            if (u.cache_creation) {
              turnCacheWrite5m = u.cache_creation.ephemeral_5m_input_tokens ?? 0;
              turnCacheWrite1h = u.cache_creation.ephemeral_1h_input_tokens ?? 0;
            } else if (u.cache_creation_input_tokens) {
              // Without the TTL breakdown, we can't determine the split.
              // Older API responses predate the 1h TTL option, so default to 5m.
              turnCacheWrite5m = u.cache_creation_input_tokens;
            }

            usage.input_tokens += turnInput;
            usage.output_tokens += turnOutput;
            usage.cache_read_tokens += turnCacheRead;
            usage.cache_write_5m_tokens += turnCacheWrite5m;
            usage.cache_write_1h_tokens += turnCacheWrite1h;

            turns.push({
              input_tokens: turnInput,
              output_tokens: turnOutput,
              cache_read_tokens: turnCacheRead,
              cache_write_5m_tokens: turnCacheWrite5m,
              cache_write_1h_tokens: turnCacheWrite1h,
            });
          }
        }

        // Collect subagent info from progress messages
        if (
          msg.type === "progress" &&
          msg.data?.type === "agent_progress" &&
          msg.data.agentId &&
          msg.parentToolUseID &&
          !seenAgents.has(msg.data.agentId)
        ) {
          seenAgents.add(msg.data.agentId);
          subagents.push({
            agentId: msg.data.agentId,
            toolUseId: msg.parentToolUseID,
          });
        }
      } catch {
        // skip
      }
    }
  } catch {
    // file not readable
  }

  const pricing = findPricing(model ?? "");
  const costs = pricing ? calculateSessionCosts(turns, pricing) : null;

  return { usage, subagents, model, costs };
}

export async function getSessionTokenUsage(
  sessionId: string
): Promise<SessionTokenUsage> {
  const { usage } = await getSessionMeta(sessionId);
  return usage;
}

export async function deleteSession(sessionId: string): Promise<boolean> {
  const historyPath = join(claudeDir, "history.jsonl");

  try {
    const content = await readFile(historyPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const filteredLines: string[] = [];

    for (const line of lines) {
      try {
        const entry: HistoryEntry = JSON.parse(line);
        if (entry.sessionId === sessionId) {
          continue;
        }
        filteredLines.push(line);
      } catch {
        filteredLines.push(line);
      }
    }

    if (filteredLines.length === lines.length) {
      return false;
    }

    await writeFile(historyPath, filteredLines.join("\n") + "\n", "utf-8");
    historyCache = null;
    return true;
  } catch {
    return false;
  }
}

export async function renameSession(
  sessionId: string,
  newName: string
): Promise<boolean> {
  const historyPath = join(claudeDir, "history.jsonl");

  // Validate input
  const trimmedName = newName.trim();
  if (!trimmedName || trimmedName.length > 200) {
    return false;
  }

  try {
    const content = await readFile(historyPath, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    const updatedLines: string[] = [];
    let found = false;

    for (const line of lines) {
      try {
        const entry: HistoryEntry = JSON.parse(line);
        // Match by sessionId if available, otherwise skip (old format without sessionId)
        if (entry.sessionId === sessionId) {
          entry.display = trimmedName;
          updatedLines.push(JSON.stringify(entry));
          found = true;
        } else {
          updatedLines.push(line);
        }
      } catch {
        // Keep malformed lines as-is
        updatedLines.push(line);
      }
    }

    if (!found) {
      return false;
    }

    // Atomic write: write to temp file then rename
    const tempPath = historyPath + ".tmp";
    await writeFile(tempPath, updatedLines.join("\n") + "\n", "utf-8");

    // Rename temp file to original (atomic on most filesystems)
    const { rename } = await import("fs/promises");
    await rename(tempPath, historyPath);

    // Invalidate cache to force reload
    historyCache = null;
    return true;
  } catch (err) {
    console.error("Error renaming session:", err);
    return false;
  }
}

export async function getConversationStream(
  sessionId: string,
  fromOffset: number = 0
): Promise<StreamResult> {
  const filePath = await findSessionFile(sessionId);

  if (!filePath) {
    return { messages: [], nextOffset: 0 };
  }

  const messages: ConversationMessage[] = [];

  let fileHandle;
  try {
    const fileStat = await stat(filePath);
    const fileSize = fileStat.size;

    if (fromOffset >= fileSize) {
      return { messages: [], nextOffset: fromOffset };
    }

    fileHandle = await open(filePath, "r");
    const stream = fileHandle.createReadStream({
      start: fromOffset,
      encoding: "utf-8",
    });

    const rl = createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    let bytesConsumed = 0;

    for await (const line of rl) {
      const lineBytes = Buffer.byteLength(line, "utf-8") + 1;

      if (line.trim()) {
        try {
          const msg: ConversationMessage = JSON.parse(line);
          if (msg.type === "user" || msg.type === "assistant") {
            messages.push(msg);
          }
          bytesConsumed += lineBytes;
        } catch {
          break;
        }
      } else {
        bytesConsumed += lineBytes;
      }
    }

    const actualOffset = fromOffset + bytesConsumed;
    const nextOffset = actualOffset > fileSize ? fileSize : actualOffset;

    return { messages, nextOffset };
  } catch (err) {
    console.error("Error reading conversation stream:", err);
    return { messages: [], nextOffset: fromOffset };
  } finally {
    if (fileHandle) {
      await fileHandle.close();
    }
  }
}

export async function getSubagentMap(
  sessionId: string
): Promise<SubagentInfo[]> {
  const filePath = await findSessionFile(sessionId);
  if (!filePath) {
    return [];
  }

  const infos: SubagentInfo[] = [];
  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    const seen = new Set<string>();
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (
          msg.type === "progress" &&
          msg.data?.type === "agent_progress" &&
          msg.data.agentId &&
          msg.parentToolUseID &&
          !seen.has(msg.data.agentId)
        ) {
          seen.add(msg.data.agentId);
          infos.push({
            agentId: msg.data.agentId,
            toolUseId: msg.parentToolUseID,
          });
        }
      } catch {
        // skip
      }
    }
  } catch {
    // file not readable
  }

  return infos;
}

export async function getSubagentConversation(
  sessionId: string,
  agentId: string
): Promise<ConversationMessage[]> {
  const filePath = await findSessionFile(sessionId);
  if (!filePath) {
    return [];
  }

  // Session file is at: <projects>/<encoded-path>/<sessionId>.jsonl
  // Subagent files are at: <projects>/<encoded-path>/<sessionId>/subagents/agent-<agentId>.jsonl
  const sessionDir = filePath.replace(/\.jsonl$/, "");
  const subagentPath = join(sessionDir, "subagents", `agent-${agentId}.jsonl`);

  const messages: ConversationMessage[] = [];
  try {
    const content = await readFile(subagentPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (msg.type === "user" || msg.type === "assistant") {
          messages.push(msg);
        }
      } catch {
        // skip
      }
    }
  } catch {
    // subagent file not found
  }

  return messages;
}

function extractTextFromContent(content: string | ContentBlock[] | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;

  const texts: string[] = [];
  for (const block of content) {
    if (block.text) {
      texts.push(block.text);
    }
    // Skip thinking blocks and tool input — they add noise to search results.
    // Tool result content (text from tool outputs) is still included.
    if (block.content) {
      texts.push(extractTextFromContent(block.content));
    }
  }
  return texts.join(" ");
}

function extractMessageText(msg: ConversationMessage): string {
  if (msg.summary) {
    return msg.summary;
  }
  if (msg.message?.content) {
    return extractTextFromContent(msg.message.content);
  }
  return "";
}

async function searchSessionFile(
  filePath: string,
  session: Session,
  trimmedQuery: string,
  lowerQuery: string,
  queryRegex: RegExp,
): Promise<SearchResult | null> {
  try {
    const content = await readFile(filePath, "utf-8");

    // Pre-filter: case-insensitive regex test on raw file content.
    // Skips the expensive JSON parse pipeline for non-matching files.
    if (!queryRegex.test(content)) return null;

    const lines = content.trim().split("\n").filter(Boolean);
    let matchCount = 0;
    let firstMatch: SearchMatch | null = null;
    let messageIndex = 0;

    for (const line of lines) {
      try {
        const msg: ConversationMessage = JSON.parse(line);
        if (msg.type !== "user" && msg.type !== "assistant") continue;

        const text = extractMessageText(msg);
        if (text.toLowerCase().includes(lowerQuery)) {
          matchCount++;
          if (!firstMatch) {
            firstMatch = {
              messageIndex,
              text: text.slice(0, 200),
              snippet: createSnippet(text, trimmedQuery),
            };
          }
        }
        messageIndex++;
      } catch {
        // Skip malformed lines
      }
    }

    if (matchCount > 0 && firstMatch) {
      return {
        sessionId: session.id,
        display: session.display,
        projectName: session.projectName,
        timestamp: session.timestamp,
        matchCount,
        firstMatch,
      };
    }
  } catch {
    // file not readable
  }

  return null;
}

export async function searchConversations(query: string): Promise<SearchResult[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  return dedupe(`search:${trimmedQuery.toLowerCase()}`, async () => {
    const sessions = await getSessions();
    const lowerQuery = trimmedQuery.toLowerCase();
    const queryRegex = new RegExp(escapeRegExp(trimmedQuery), "i");
    const results: SearchResult[] = [];

    // Process in batches to bound concurrent file reads and memory pressure.
    const BATCH_SIZE = 50;
    for (let i = 0; i < sessions.length; i += BATCH_SIZE) {
      const batch = sessions.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (session) => {
          if (matchesSessionId(session.id, trimmedQuery)) {
            return createSessionIdSearchResult(session, trimmedQuery);
          }

          const filePath = await findSessionFile(session.id);
          if (!filePath) return null;
          return searchSessionFile(filePath, session, trimmedQuery, lowerQuery, queryRegex);
        }),
      );
      for (const r of batchResults) {
        if (r) results.push(r);
      }
    }

    // Check fileIndex for orphan sessions (e.g. subagent sessions not in history.jsonl)
    // that match the query as a session ID
    const knownIds = new Set(sessions.map((s) => s.id));
    for (const [sessionId, filePath] of fileIndex) {
      if (knownIds.has(sessionId)) continue;
      if (!matchesSessionId(sessionId, trimmedQuery)) continue;

      const dirName = basename(dirname(filePath));
      const decodedProject = decodeProjectDir(dirName);
      let timestamp = Date.now();
      try {
        const fileStat = await stat(filePath);
        timestamp = fileStat.mtimeMs;
      } catch {}

      const text = `Session ID: ${sessionId}`;
      results.push({
        sessionId,
        display: sessionId,
        projectName: getProjectName(decodedProject),
        timestamp,
        matchCount: 1,
        firstMatch: {
          messageIndex: 0,
          text,
          snippet: createSnippet(text, trimmedQuery),
        },
      });
    }

    return results.sort((a, b) => b.timestamp - a.timestamp);
  });
}

/** Find orphan sessions (on disk but not in history.jsonl) matching a session ID query */
export async function findOrphanSessions(query: string): Promise<Session[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const sessions = await getSessions();
  const knownIds = new Set(sessions.map((s) => s.id));
  const results: Session[] = [];

  for (const [sessionId, filePath] of fileIndex) {
    if (knownIds.has(sessionId)) continue;
    if (!matchesSessionId(sessionId, trimmed)) continue;

    const dirName = basename(dirname(filePath));
    const decodedProject = decodeProjectDir(dirName);
    let timestamp = Date.now();
    try {
      const fileStat = await stat(filePath);
      timestamp = fileStat.mtimeMs;
    } catch {}
    const { count: messageCount, model } = await countSessionMessages(sessionId);

    results.push({
      id: sessionId,
      display: sessionId,
      timestamp,
      project: decodedProject,
      projectName: getProjectName(decodedProject),
      messageCount,
      model,
      provider: "claude" as const,
    });
  }

  return results.sort((a, b) => b.timestamp - a.timestamp);
}
