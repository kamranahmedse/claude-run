import { readdir, readFile, stat, open } from "fs/promises";
import { join, basename } from "path";
import { homedir } from "os";
import { createInterface } from "readline";

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
}

export interface StreamResult {
  messages: ConversationMessage[];
  nextOffset: number;
}

let claudeDir = join(homedir(), ".claude");
let projectsDir = join(claudeDir, "projects");
const fileIndex = new Map<string, string>();
let historyCache: HistoryEntry[] | null = null;
const pendingRequests = new Map<string, Promise<unknown>>();

// Search index: sessionId -> full text content
const searchIndex = new Map<string, string>();

export interface SearchResult {
  session: Session;
  score: number;
  matchContext?: string;
}

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

function encodeProjectPath(path: string): string {
  return path.replace(/[/.]/g, "-");
}

function getProjectName(projectPath: string): string {
  const parts = projectPath.split("/").filter(Boolean);
  return parts[parts.length - 1] || projectPath;
}

function extractTextFromContent(content: string | ContentBlock[]): string {
  if (typeof content === "string") {
    return content;
  }

  const parts: string[] = [];
  for (const block of content) {
    if (block.type === "text" && block.text) {
      parts.push(block.text);
    } else if (block.type === "thinking" && block.thinking) {
      parts.push(block.thinking);
    } else if (block.type === "tool_result" && typeof block.content === "string") {
      parts.push(block.content);
    }
  }
  return parts.join(" ");
}

function normalizeText(text: string): string {
  // Lowercase and convert underscores to spaces for matching
  return text.toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
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

export async function loadStorage(): Promise<void> {
  await Promise.all([buildFileIndex(), loadHistoryCache()]);
}

export async function getSessions(): Promise<Session[]> {
  return dedupe("getSessions", async () => {
    const entries = historyCache ?? (await loadHistoryCache());
    const sessions: Session[] = [];
    const seenIds = new Set<string>();

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
      sessions.push({
        id: sessionId,
        display: entry.display,
        timestamp: entry.timestamp,
        project: entry.project,
        projectName: getProjectName(entry.project),
      });
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

async function getSessionFullText(sessionId: string): Promise<string> {
  // Check cache first
  if (searchIndex.has(sessionId)) {
    return searchIndex.get(sessionId)!;
  }

  const messages = await getConversation(sessionId);
  const parts: string[] = [];

  for (const msg of messages) {
    if (msg.message?.content) {
      parts.push(extractTextFromContent(msg.message.content));
    }
    if (msg.summary) {
      parts.push(msg.summary);
    }
  }

  const fullText = parts.join(" ");
  searchIndex.set(sessionId, fullText);
  return fullText;
}

function getRecencyMultiplier(timestamp: number): number {
  const now = Date.now();
  const age = now - timestamp;
  const day = 24 * 60 * 60 * 1000;

  if (age < day) return 3.0; // Last 24 hours
  if (age < 7 * day) return 2.0; // Last 7 days
  if (age < 30 * day) return 1.5; // Last 30 days
  return 1.0;
}

function searchMatches(
  text: string,
  queryWords: string[]
): { matches: boolean; matchContext?: string } {
  const normalizedText = normalizeText(text);

  // Fast check: all query words must appear as substrings
  for (const word of queryWords) {
    if (!normalizedText.includes(word)) {
      return { matches: false };
    }
  }

  // Prefix matching: each query word must prefix some word in text
  const textWords = normalizedText.split(/\s+/);
  for (const queryWord of queryWords) {
    const found = textWords.some((tw) => tw.startsWith(queryWord));
    if (!found) {
      return { matches: false };
    }
  }

  // Find context around first match
  const firstQueryWord = queryWords[0];
  const idx = normalizedText.indexOf(firstQueryWord);
  if (idx !== -1) {
    const start = Math.max(0, idx - 50);
    const end = Math.min(normalizedText.length, idx + firstQueryWord.length + 100);
    let context = text.substring(start, end);
    if (start > 0) context = "..." + context;
    if (end < text.length) context = context + "...";
    return { matches: true, matchContext: context };
  }

  return { matches: true };
}

export async function searchSessions(query: string): Promise<SearchResult[]> {
  const queryWords = normalizeText(query).split(/\s+/).filter(Boolean);

  if (queryWords.length === 0) {
    return [];
  }

  const sessions = await getSessions();
  const results: SearchResult[] = [];

  // Process sessions in parallel batches for performance
  const batchSize = 10;
  for (let i = 0; i < sessions.length; i += batchSize) {
    const batch = sessions.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (session) => {
        const fullText = await getSessionFullText(session.id);
        const { matches, matchContext } = searchMatches(fullText, queryWords);

        if (matches) {
          const baseScore = queryWords.length;
          const recencyMultiplier = getRecencyMultiplier(session.timestamp);
          return {
            session,
            score: baseScore * recencyMultiplier,
            matchContext,
          };
        }
        return null;
      })
    );

    for (const result of batchResults) {
      if (result) {
        results.push(result);
      }
    }
  }

  // Sort by score descending, then by timestamp descending
  results.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return b.session.timestamp - a.session.timestamp;
  });

  return results;
}

export function invalidateSearchIndex(sessionId?: string): void {
  if (sessionId) {
    searchIndex.delete(sessionId);
  } else {
    searchIndex.clear();
  }
}
