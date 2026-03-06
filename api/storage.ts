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

function normalizeProjectPath(projectPath: string): string {
  return projectPath.replace(/\\/g, "/").replace(/\/+/g, "/").trim();
}

function addPathVariant(variants: Set<string>, value: string): void {
  if (!value || /[\\/:]/.test(value)) {
    return;
  }

  variants.add(value);

  const collapsedDashes = value.replace(/-+/g, "-");
  if (collapsedDashes) {
    variants.add(collapsedDashes);
  }

  const trimmedDashes = collapsedDashes.replace(/^-+|-+$/g, "");
  if (trimmedDashes) {
    variants.add(trimmedDashes);
  }
}

function getProjectDirectoryCandidates(projectPath: string): string[] {
  const normalized = normalizeProjectPath(projectPath);
  const variants = new Set<string>();

  addPathVariant(variants, normalized.replace(/[/.]/g, "-"));
  addPathVariant(variants, normalized.replace(/[\\/.:]/g, "-"));
  addPathVariant(variants, normalized.replace(/[^a-zA-Z0-9_-]/g, "-"));
  addPathVariant(variants, normalized.replace(/[\\/]/g, "-"));

  return [...variants].filter(Boolean);
}

function getProjectName(projectPath: string): string {
  const normalized = normalizeProjectPath(projectPath).replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || projectPath;
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

async function getProjectDirectorySet(): Promise<Set<string>> {
  try {
    const projectDirs = await readdir(projectsDir, { withFileTypes: true });
    return new Set(projectDirs.filter((d) => d.isDirectory()).map((d) => d.name));
  } catch {
    return new Set<string>();
  }
}

async function findSessionByTimestampInDirectory(
  projectDirectory: string,
  timestamp: number
): Promise<string | undefined> {
  try {
    const projectPath = join(projectsDir, projectDirectory);
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

async function findSessionByTimestamp(
  projectPath: string,
  timestamp: number,
  projectDirectories: Set<string>
): Promise<string | undefined> {
  const candidates = getProjectDirectoryCandidates(projectPath);
  const matchingCandidates = candidates.filter((candidate) =>
    projectDirectories.has(candidate)
  );
  if (projectDirectories.size > 0 && matchingCandidates.length === 0) {
    return undefined;
  }

  const prioritized = matchingCandidates.length > 0 ? matchingCandidates : candidates;

  for (const candidate of prioritized) {
    const sessionId = await findSessionByTimestampInDirectory(candidate, timestamp);
    if (sessionId) {
      return sessionId;
    }
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
    const projectDirectories = await getProjectDirectorySet();
    const sessions: Session[] = [];
    const seenIds = new Set<string>();

    for (const entry of entries) {
      let sessionId = entry.sessionId;
      if (!sessionId) {
        sessionId = await findSessionByTimestamp(
          entry.project,
          entry.timestamp,
          projectDirectories
        );
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
