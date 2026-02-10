import { readdir, readFile, stat, open, unlink } from "fs/promises";
import { join, basename } from "path";
import { homedir } from "os";
import { createInterface } from "readline";

export type SessionSource = "claude" | "factory" | "codex" | "pi";
export type ModelConfidence = "explicit" | "derived" | "unknown";

export interface HistoryEntry {
  display: string;
  timestamp: number;
  project: string;
  sessionId?: string;
  source: SessionSource;
  modelProvider?: string;
  modelId?: string;
  modelConfidence?: ModelConfidence;
}

export interface Session {
  id: string;
  display: string;
  timestamp: number;
  project: string;
  projectName: string;
  source: SessionSource;
  modelProvider?: string;
  modelId?: string;
  modelConfidence?: ModelConfidence;
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
    provider?: string;
    api?: string;
    usage?: TokenUsage;
    modelConfidence?: ModelConfidence;
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
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  [key: string]: unknown;
}

export interface StreamResult {
  messages: ConversationMessage[];
  nextOffset: number;
}

let claudeDir = join(homedir(), ".claude");
let factoryDir = join(homedir(), ".factory");
let codexDir = join(homedir(), ".codex");
let piDir = join(homedir(), ".pi", "agent");

const fileIndex = new Map<string, { path: string; source: SessionSource }>();
let historyCache: HistoryEntry[] | null = null;
const pendingRequests = new Map<string, Promise<unknown>>();

export interface StorageInitOptions {
  claudeDir?: string;
  factoryDir?: string;
  codexDir?: string;
  piDir?: string;
}

export function initStorage(dirOrOptions?: string | StorageInitOptions): void {
  if (typeof dirOrOptions === "string") {
    claudeDir = dirOrOptions;
    factoryDir = join(homedir(), ".factory");
    codexDir = join(homedir(), ".codex");
    piDir = join(homedir(), ".pi", "agent");
  } else {
    const options = dirOrOptions ?? {};
    claudeDir = options.claudeDir ?? join(homedir(), ".claude");
    factoryDir = options.factoryDir ?? join(homedir(), ".factory");
    codexDir = options.codexDir ?? join(homedir(), ".codex");
    piDir = options.piDir ?? join(homedir(), ".pi", "agent");
  }

  fileIndex.clear();
  historyCache = null;
  pendingRequests.clear();
}

export function getClaudeDir(): string {
  return claudeDir;
}

export function getFactoryDir(): string {
  return factoryDir;
}

export function getCodexDir(): string {
  return codexDir;
}

export function getPiDir(): string {
  return piDir;
}

export function invalidateHistoryCache(): void {
  historyCache = null;
}

export function addToFileIndex(sessionId: string, filePath: string, source: SessionSource = "claude"): void {
  fileIndex.set(sessionId, { path: filePath, source });
}

function getProjectName(projectPath: string): string {
  const parts = projectPath.split("/").filter(Boolean);
  return parts[parts.length - 1] || projectPath;
}

function encodeProjectPath(path: string): string {
  return path.replace(/[/.]/g, "-");
}

function inferProviderFromModel(model?: string): string | undefined {
  if (!model) return undefined;
  const lower = model.toLowerCase();
  if (lower.includes("claude")) return "anthropic";
  if (lower.includes("gpt") || lower.includes("o1") || lower.includes("o3")) return "openai";
  if (lower.includes("gemini")) return "google";
  if (lower.includes("llama") || lower.includes("qwen") || lower.includes("mistral")) return "openrouter";
  return undefined;
}

function normalizeModelId(value?: string): string | undefined {
  if (!value || typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^custom:/, "");
}

async function readFactorySettingsMeta(sessionFilePath: string): Promise<{
  modelId?: string;
  modelProvider?: string;
  modelConfidence?: ModelConfidence;
}> {
  const settingsPath = sessionFilePath.replace(/\.jsonl$/, ".settings.json");

  try {
    const settings = JSON.parse(await readFile(settingsPath, "utf-8")) as Record<string, unknown>;
    const modelId = normalizeModelId(typeof settings.model === "string" ? settings.model : undefined);
    const modelProvider = typeof settings.providerLock === "string"
      ? settings.providerLock
      : inferProviderFromModel(modelId);

    if (!modelId && !modelProvider) {
      return {};
    }

    return {
      modelId,
      modelProvider,
      modelConfidence: "derived",
    };
  } catch {
    return {};
  }
}

function toText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value.map((v) => toText(v)).filter(Boolean).join("\n");
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.content === "string") return obj.content;
  }
  return "";
}

function firstTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    for (const item of content) {
      if (typeof item === "string") {
        if (item.trim()) return item;
        continue;
      }
      if (item && typeof item === "object") {
        const block = item as Record<string, unknown>;
        const text = typeof block.text === "string" ? block.text : toText(block.content);
        if (text.trim()) return text;
      }
    }
  }
  return "";
}

function cleanTitle(text: string, fallback: string): string {
  const cleaned = sanitizeForIndex(text)
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return fallback;
  return cleaned.slice(0, 200);
}

function parseTimestampValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string") {
    const asNum = Number(value);
    if (!Number.isNaN(asNum)) {
      return asNum < 1e12 ? asNum * 1000 : asNum;
    }
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

export function getLastPiActivityTimestampFromEntries(entries: Array<Record<string, unknown>>): number {
  let latest = 0;

  for (const entry of entries) {
    const entryTs = parseTimestampValue(entry.timestamp);
    if (entryTs && entryTs > latest) latest = entryTs;

    const message = entry.message;
    if (message && typeof message === "object") {
      const msgTs = parseTimestampValue((message as Record<string, unknown>).timestamp);
      if (msgTs && msgTs > latest) latest = msgTs;
    }
  }

  return latest;
}

// --- Claude loader ---

async function buildClaudeFileIndex(): Promise<void> {
  const projectsDir = join(claudeDir, "projects");
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
              fileIndex.set(sessionId, { path: join(projectPath, file), source: "claude" });
            }
          }
        } catch { /* ignore */ }
      })
    );
  } catch { /* projects dir may not exist */ }
}

async function loadClaudeHistory(): Promise<HistoryEntry[]> {
  try {
    const historyPath = join(claudeDir, "history.jsonl");
    const content = await readFile(historyPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const entries: HistoryEntry[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        entries.push({
          ...parsed,
          source: "claude" as SessionSource,
          modelId: typeof parsed.model === "string" ? parsed.model : undefined,
          modelProvider:
            typeof parsed.provider === "string"
              ? parsed.provider
              : inferProviderFromModel(typeof parsed.model === "string" ? parsed.model : undefined),
          modelConfidence:
            typeof parsed.model === "string" || typeof parsed.provider === "string"
              ? "explicit"
              : undefined,
        });
      } catch { /* skip malformed */ }
    }
    return entries;
  } catch {
    return [];
  }
}

async function findClaudeSessionByTimestamp(
  encodedProject: string,
  timestamp: number
): Promise<string | undefined> {
  try {
    const projectsDir = join(claudeDir, "projects");
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
    if (closestFile) return basename(closestFile, ".jsonl");
  } catch { /* ignore */ }
  return undefined;
}

// --- Factory loader ---

async function buildFactoryFileIndex(): Promise<void> {
  const sessionsDir = join(factoryDir, "sessions");
  try {
    const entries = await readdir(sessionsDir, { withFileTypes: true });
    const directories = entries.filter((d) => d.isDirectory());
    await Promise.all(
      directories.map(async (dir) => {
        try {
          const projectPath = join(sessionsDir, dir.name);
          const files = await readdir(projectPath);
          for (const file of files) {
            if (file.endsWith(".jsonl")) {
              const sessionId = basename(file, ".jsonl");
              fileIndex.set(sessionId, { path: join(projectPath, file), source: "factory" });
            }
          }
        } catch { /* ignore */ }
      })
    );
  } catch { /* sessions dir may not exist */ }
}

async function loadFactoryHistory(): Promise<HistoryEntry[]> {
  const sessionsDir = join(factoryDir, "sessions");
  const entries: HistoryEntry[] = [];
  try {
    const projDirs = await readdir(sessionsDir, { withFileTypes: true });
    const directories = projDirs.filter((d) => d.isDirectory());
    await Promise.all(
      directories.map(async (dir) => {
        try {
          const projectPath = join(sessionsDir, dir.name);
          const files = await readdir(projectPath);
          for (const file of files) {
            if (!file.endsWith(".jsonl")) continue;
            const filePath = join(projectPath, file);
            try {
              const content = await readFile(filePath, "utf-8");
              const firstLine = content.split("\n")[0];
              if (!firstLine) continue;
              const parsed = JSON.parse(firstLine);
              if (parsed.type !== "session_start") continue;
              const fileStat = await stat(filePath);
              const cwd = parsed.cwd || dir.name.replace(/-/g, "/");
              const settingsMeta = await readFactorySettingsMeta(filePath);
              entries.push({
                display: parsed.sessionTitle || parsed.title || "Factory Session",
                timestamp: fileStat.mtimeMs,
                project: cwd,
                sessionId: parsed.id || basename(file, ".jsonl"),
                source: "factory",
                modelProvider: settingsMeta.modelProvider,
                modelId: settingsMeta.modelId,
                modelConfidence: settingsMeta.modelConfidence,
              });
            } catch { /* skip malformed */ }
          }
        } catch { /* ignore */ }
      })
    );
  } catch { /* sessions dir may not exist */ }
  return entries;
}

async function getFactoryConversation(sessionId: string): Promise<ConversationMessage[]> {
  const entry = fileIndex.get(sessionId);
  if (!entry || entry.source !== "factory") {
    const filePath = await findFactorySessionFile(sessionId);
    if (!filePath) return [];
    return parseFactorySession(filePath);
  }
  return parseFactorySession(entry.path);
}

async function findFactorySessionFile(sessionId: string): Promise<string | null> {
  const sessionsDir = join(factoryDir, "sessions");
  const targetFile = `${sessionId}.jsonl`;
  try {
    const projDirs = await readdir(sessionsDir, { withFileTypes: true });
    for (const dir of projDirs) {
      if (!dir.isDirectory()) continue;
      const projectPath = join(sessionsDir, dir.name);
      const files = await readdir(projectPath);
      if (files.includes(targetFile)) {
        return join(projectPath, targetFile);
      }
    }
  } catch { /* ignore */ }
  return null;
}

async function parseFactorySession(filePath: string): Promise<ConversationMessage[]> {
  const messages: ConversationMessage[] = [];
  let derivedModel: string | undefined;
  const settingsMeta = await readFactorySettingsMeta(filePath);

  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "message" && parsed.message) {
          const role = parsed.message.role;
          if (role !== "user" && role !== "assistant") continue;

          const firstText = firstTextFromContent(parsed.message.content);
          const modelMatch = firstText.match(/\bModel:\s*([^\n\r]+)/i);
          if (!derivedModel && modelMatch) {
            derivedModel = normalizeModelId(modelMatch[1]?.trim());
          }

          const explicitModel = normalizeModelId(typeof parsed.message.model === "string" ? parsed.message.model : undefined);
          const model = explicitModel || derivedModel || (role === "assistant" ? settingsMeta.modelId : undefined);
          const provider =
            typeof parsed.message.provider === "string"
              ? parsed.message.provider
              : inferProviderFromModel(model) || (role === "assistant" ? settingsMeta.modelProvider : undefined);

          let modelConfidence: ModelConfidence = "unknown";
          if (explicitModel) modelConfidence = "explicit";
          else if (derivedModel) modelConfidence = "derived";
          else if (model) modelConfidence = settingsMeta.modelConfidence || "derived";

          messages.push({
            type: role,
            uuid: parsed.id,
            timestamp: parsed.timestamp,
            message: {
              role,
              content: parsed.message.content,
              model,
              provider,
              usage: parsed.message.usage as TokenUsage | undefined,
              modelConfidence,
            },
          });
        }
      } catch { /* skip */ }
    }
  } catch { /* ignore */ }
  return messages;
}

// --- Codex loader ---

async function buildCodexFileIndex(): Promise<void> {
  const sessionsDir = join(codexDir, "sessions");
  try {
    await walkCodexSessions(sessionsDir, (sessionId, filePath) => {
      fileIndex.set(sessionId, { path: filePath, source: "codex" });
    });
  } catch { /* sessions dir may not exist */ }
}

async function walkCodexSessions(
  dir: string,
  callback: (sessionId: string, filePath: string) => void
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkCodexSessions(fullPath, callback);
    } else if (entry.name.endsWith(".jsonl")) {
      const match = entry.name.match(/([0-9a-f]{4,}-[0-9a-f-]+)\.jsonl$/);
      if (match) {
        callback(match[1], fullPath);
      }
    }
  }
}

async function loadCodexHistory(): Promise<HistoryEntry[]> {
  try {
    const historyPath = join(codexDir, "history.jsonl");
    const content = await readFile(historyPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const entries: HistoryEntry[] = [];
    const seenSessions = new Set<string>();
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const sessionId = parsed.session_id;
        if (!sessionId || seenSessions.has(sessionId)) continue;
        seenSessions.add(sessionId);
        const ts = typeof parsed.ts === "string" ? parseInt(parsed.ts, 10) : parsed.ts;
        const timestamp = ts < 1e12 ? ts * 1000 : ts;
        entries.push({
          display: (parsed.text || "Codex Session").slice(0, 200),
          timestamp,
          project: "",
          sessionId,
          source: "codex",
        });
      } catch { /* skip */ }
    }
    return entries;
  } catch {
    return [];
  }
}

async function enrichCodexEntries(entries: HistoryEntry[]): Promise<void> {
  for (const entry of entries) {
    if (entry.source !== "codex" || !entry.sessionId) continue;
    const indexed = fileIndex.get(entry.sessionId);
    if (!indexed) continue;
    try {
      const content = await readFile(indexed.path, "utf-8");
      const lines = content.split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "session_meta" && parsed.payload) {
            entry.project = parsed.payload.cwd || entry.project || "";
            if (!entry.modelProvider && parsed.payload.model_provider) {
              entry.modelProvider = parsed.payload.model_provider;
            }
          }

          if (parsed.type === "turn_context" && parsed.payload?.model && !entry.modelId) {
            entry.modelId = parsed.payload.model;
          }

          if (entry.project && entry.modelProvider && entry.modelId) {
            entry.modelConfidence = "derived";
            break;
          }
        } catch {
          // skip malformed
        }
      }

      if (!entry.modelConfidence) {
        entry.modelConfidence = entry.modelProvider || entry.modelId ? "derived" : "unknown";
      }
    } catch { /* ignore */ }
  }
}

async function findCodexSessionFile(sessionId: string): Promise<string | null> {
  const indexed = fileIndex.get(sessionId);
  if (indexed?.source === "codex") {
    return indexed.path;
  }

  const sessionsDir = join(codexDir, "sessions");
  try {
    let foundPath: string | null = null;
    await walkCodexSessions(sessionsDir, (id, filePath) => {
      if (!foundPath && id === sessionId) {
        foundPath = filePath;
      }
    });

    if (foundPath) {
      fileIndex.set(sessionId, { path: foundPath, source: "codex" });
    }

    return foundPath;
  } catch {
    return null;
  }
}

async function getCodexConversation(sessionId: string): Promise<ConversationMessage[]> {
  const filePath = await findCodexSessionFile(sessionId);
  if (!filePath) {
    return [];
  }
  return parseCodexSession(filePath);
}

async function parseCodexSession(filePath: string): Promise<ConversationMessage[]> {
  const messages: ConversationMessage[] = [];
  let currentModel: string | undefined;
  let currentProvider: string | undefined;

  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);

        if (parsed.type === "session_meta" && parsed.payload) {
          currentProvider = parsed.payload.model_provider || currentProvider;
          continue;
        }

        if (parsed.type === "turn_context" && parsed.payload) {
          currentModel = parsed.payload.model || currentModel;
          continue;
        }

        if (parsed.type === "response_item" && parsed.payload) {
          const { role, content: payloadContent } = parsed.payload;
          if (role === "user") {
            const textParts = (payloadContent || [])
              .filter((c: { type: string }) => c.type === "input_text")
              .map((c: { text: string }) => c.text || "");
            if (textParts.length > 0) {
              messages.push({
                type: "user",
                uuid: `codex-${messages.length}`,
                timestamp: parsed.timestamp,
                message: {
                  role: "user",
                  content: textParts.join("\n"),
                  model: currentModel,
                  provider: currentProvider,
                  modelConfidence: currentModel || currentProvider ? "derived" : "unknown",
                },
              });
            }
          } else if (role === "assistant") {
            const textParts = (payloadContent || [])
              .filter((c: { type: string }) => c.type === "output_text")
              .map((c: { text: string }) => c.text || "");
            if (textParts.length > 0) {
              messages.push({
                type: "assistant",
                uuid: `codex-${messages.length}`,
                timestamp: parsed.timestamp,
                message: {
                  role: "assistant",
                  content: textParts.join("\n"),
                  model: currentModel,
                  provider: currentProvider,
                  modelConfidence: currentModel || currentProvider ? "derived" : "unknown",
                },
              });
            }
          }
        } else if (parsed.type === "function_call") {
          const payload = parsed.payload || {};
          messages.push({
            type: "assistant",
            uuid: `codex-fc-${messages.length}`,
            timestamp: parsed.timestamp,
            message: {
              role: "assistant",
              model: currentModel,
              provider: currentProvider,
              modelConfidence: currentModel || currentProvider ? "derived" : "unknown",
              content: [
                {
                  type: "tool_use",
                  id: payload.call_id || payload.id,
                  name: payload.name || payload.type || "function_call",
                  input: payload.arguments ? JSON.parse(payload.arguments) : {},
                },
              ],
            },
          });
        } else if (parsed.type === "function_call_output") {
          const payload = parsed.payload || {};
          messages.push({
            type: "assistant",
            uuid: `codex-fco-${messages.length}`,
            timestamp: parsed.timestamp,
            message: {
              role: "assistant",
              model: currentModel,
              provider: currentProvider,
              modelConfidence: currentModel || currentProvider ? "derived" : "unknown",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: payload.call_id,
                  content: payload.output || "",
                },
              ],
            },
          });
        } else if (parsed.type === "reasoning") {
          const payload = parsed.payload || {};
          if (payload.text) {
            messages.push({
              type: "assistant",
              uuid: `codex-r-${messages.length}`,
              timestamp: parsed.timestamp,
              message: {
                role: "assistant",
                model: currentModel,
                provider: currentProvider,
                modelConfidence: currentModel || currentProvider ? "derived" : "unknown",
                content: [
                  {
                    type: "thinking",
                    thinking: payload.text,
                  },
                ],
              },
            });
          }
        }
      } catch { /* skip */ }
    }
  } catch { /* ignore */ }
  return messages;
}

// --- Pi loader ---

function parsePiSessionIdFromFilename(fileName: string): string {
  const withoutExt = basename(fileName, ".jsonl");
  const match = withoutExt.match(/_([0-9a-f-]{8,})$/i);
  return match ? match[1] : withoutExt;
}

async function walkPiSessions(
  dir: string,
  callback: (filePath: string, fileName: string) => Promise<void> | void,
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkPiSessions(fullPath, callback);
    } else if (entry.name.endsWith(".jsonl")) {
      await callback(fullPath, entry.name);
    }
  }
}

async function buildPiFileIndex(): Promise<void> {
  const sessionsDir = join(piDir, "sessions");
  try {
    await walkPiSessions(sessionsDir, (filePath, fileName) => {
      const sessionId = parsePiSessionIdFromFilename(fileName);
      fileIndex.set(sessionId, { path: filePath, source: "pi" });
    });
  } catch {
    // sessions dir may not exist
  }
}

async function loadPiHistory(): Promise<HistoryEntry[]> {
  const sessionsDir = join(piDir, "sessions");
  const entries: HistoryEntry[] = [];

  try {
    await walkPiSessions(sessionsDir, async (filePath, fileName) => {
      const fallbackSessionId = parsePiSessionIdFromFilename(fileName);
      let sessionId = fallbackSessionId;
      let timestamp = 0;
      let project = "";
      let display = "Pi Session";
      let modelProvider: string | undefined;
      let modelId: string | undefined;
      let modelConfidence: ModelConfidence = "unknown";

      try {
        const content = await readFile(filePath, "utf-8");
        const lines = content.split("\n").filter(Boolean);
        const parsedEntries: Array<Record<string, unknown>> = [];

        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (!parsed || typeof parsed !== "object") continue;
            const parsedRecord = parsed as Record<string, unknown>;
            parsedEntries.push(parsedRecord);

            if (parsedRecord.type === "session") {
              if (typeof parsedRecord.id === "string") sessionId = parsedRecord.id;
              const ts = parseTimestampValue(parsedRecord.timestamp);
              if (ts) timestamp = ts;
              if (typeof parsedRecord.cwd === "string") project = parsedRecord.cwd;
            }

            if (!modelId && parsedRecord.type === "model_change") {
              const provider = parsedRecord.provider;
              const mid = parsedRecord.modelId;
              modelProvider = typeof provider === "string" ? provider : modelProvider;
              modelId = typeof mid === "string" ? mid : modelId;
              if (modelId || modelProvider) modelConfidence = "explicit";
            }

            const parsedMessage = parsedRecord.message;
            if (parsedRecord.type === "message" && parsedMessage && typeof parsedMessage === "object") {
              const msg = parsedMessage as Record<string, unknown>;
              const role = msg.role;

              if (!display || display === "Pi Session") {
                if (role === "user") {
                  display = cleanTitle(firstTextFromContent(msg.content), "Pi Session");
                } else if (role === "assistant") {
                  display = cleanTitle(firstTextFromContent(msg.content), "Pi Session");
                }
              }

              if (!modelId && role === "assistant") {
                if (typeof msg.provider === "string") {
                  modelProvider = msg.provider;
                }
                if (typeof msg.model === "string") {
                  modelId = msg.model;
                }
                if ((modelProvider || modelId) && modelConfidence !== "explicit") {
                  modelConfidence = "derived";
                }
              }
            }

          } catch {
            // skip malformed line
          }
        }

        const latestActivityTs = getLastPiActivityTimestampFromEntries(parsedEntries);
        if (latestActivityTs > timestamp) {
          timestamp = latestActivityTs;
        }
      } catch {
        // ignore per-file parse failure
      }

      if (!timestamp) {
        try {
          timestamp = (await stat(filePath)).mtimeMs;
        } catch {
          timestamp = Date.now();
        }
      }

      fileIndex.set(sessionId, { path: filePath, source: "pi" });

      entries.push({
        display,
        timestamp,
        project,
        sessionId,
        source: "pi",
        modelProvider,
        modelId,
        modelConfidence,
      });
    });
  } catch {
    return [];
  }

  return entries;
}

async function findPiSessionFile(sessionId: string): Promise<string | null> {
  const sessionsDir = join(piDir, "sessions");
  try {
    let found: string | null = null;
    await walkPiSessions(sessionsDir, async (filePath, fileName) => {
      if (found) return;
      const id = parsePiSessionIdFromFilename(fileName);
      if (id === sessionId) {
        found = filePath;
      }
    });
    return found;
  } catch {
    return null;
  }
}

function mapPiContent(content: unknown): string | ContentBlock[] {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return toText(content);

  const blocks: ContentBlock[] = [];

  for (const item of content) {
    if (!item || typeof item !== "object") {
      const text = toText(item);
      if (text) blocks.push({ type: "text", text });
      continue;
    }

    const block = item as Record<string, unknown>;
    const type = block.type;

    if (type === "text") {
      const text = typeof block.text === "string" ? block.text : toText(block.content);
      if (text) blocks.push({ type: "text", text });
      continue;
    }

    if (type === "thinking") {
      const thinking = typeof block.thinking === "string" ? block.thinking : toText(block.text);
      if (thinking) blocks.push({ type: "thinking", thinking });
      continue;
    }

    if (type === "toolCall") {
      blocks.push({
        type: "tool_use",
        id: typeof block.id === "string" ? block.id : undefined,
        name: typeof block.name === "string" ? block.name : "tool",
        input: block.arguments ?? block.input ?? {},
      });
      continue;
    }

    const text = toText(block);
    if (text) {
      blocks.push({ type: "text", text });
    }
  }

  return blocks.length > 0 ? blocks : "";
}

async function parsePiSession(filePath: string): Promise<ConversationMessage[]> {
  const messages: ConversationMessage[] = [];
  let currentProvider: string | undefined;
  let currentModel: string | undefined;

  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);

        if (parsed.type === "model_change") {
          currentProvider = parsed.provider || currentProvider;
          currentModel = parsed.modelId || currentModel;
          continue;
        }

        if (parsed.type !== "message" || !parsed.message) continue;

        const role = parsed.message.role;

        if (role === "user" || role === "assistant") {
          const explicitProvider = typeof parsed.message.provider === "string" ? parsed.message.provider : undefined;
          const explicitModel = typeof parsed.message.model === "string" ? parsed.message.model : undefined;

          const provider = explicitProvider || currentProvider;
          const model = explicitModel || currentModel;

          if (explicitProvider) currentProvider = explicitProvider;
          if (explicitModel) currentModel = explicitModel;

          messages.push({
            type: role,
            uuid: parsed.id,
            timestamp: parsed.timestamp,
            message: {
              role,
              content: mapPiContent(parsed.message.content),
              provider,
              model,
              api: typeof parsed.message.api === "string" ? parsed.message.api : undefined,
              usage: parsed.message.usage as TokenUsage | undefined,
              modelConfidence: explicitProvider || explicitModel ? "explicit" : provider || model ? "derived" : "unknown",
            },
          });
          continue;
        }

        if (role === "toolResult") {
          messages.push({
            type: "assistant",
            uuid: parsed.id,
            timestamp: parsed.timestamp,
            message: {
              role: "assistant",
              provider: currentProvider,
              model: currentModel,
              modelConfidence: currentProvider || currentModel ? "derived" : "unknown",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: parsed.message.toolCallId,
                  content: toText(parsed.message.content),
                  is_error: !!parsed.message.isError,
                },
              ],
            },
          });
          continue;
        }

        if (role === "bashExecution") {
          const summary = [parsed.message.command, parsed.message.output]
            .filter((v: unknown) => typeof v === "string" && v.length > 0)
            .join("\n\n");

          messages.push({
            type: "assistant",
            uuid: parsed.id,
            timestamp: parsed.timestamp,
            message: {
              role: "assistant",
              provider: currentProvider,
              model: currentModel,
              modelConfidence: currentProvider || currentModel ? "derived" : "unknown",
              content: [
                {
                  type: "tool_result",
                  content: summary,
                  is_error: parsed.message.exitCode ? parsed.message.exitCode !== 0 : false,
                },
              ],
            },
          });
          continue;
        }

        if (role === "custom" && parsed.message.display !== false) {
          const customText = toText(parsed.message.content);
          if (customText) {
            messages.push({
              type: "assistant",
              uuid: parsed.id,
              timestamp: parsed.timestamp,
              message: {
                role: "assistant",
                provider: currentProvider,
                model: currentModel,
                modelConfidence: currentProvider || currentModel ? "derived" : "unknown",
                content: customText,
              },
            });
          }
        }
      } catch {
        // skip malformed line
      }
    }
  } catch {
    return [];
  }

  return messages;
}

async function getPiConversation(sessionId: string): Promise<ConversationMessage[]> {
  const entry = fileIndex.get(sessionId);
  if (entry?.source === "pi") {
    return parsePiSession(entry.path);
  }

  const filePath = await findPiSessionFile(sessionId);
  if (!filePath) return [];

  return parsePiSession(filePath);
}

// --- Unified API ---

async function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = pendingRequests.get(key);
  if (existing) return existing as Promise<T>;
  const promise = fn().finally(() => pendingRequests.delete(key));
  pendingRequests.set(key, promise);
  return promise;
}

async function findClaudeSessionFile(sessionId: string): Promise<string | null> {
  const entry = fileIndex.get(sessionId);
  if (entry?.source === "claude") return entry.path;

  const targetFile = `${sessionId}.jsonl`;
  const projectsDir = join(claudeDir, "projects");
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
        } catch { /* ignore */ }
        return null;
      })
    );
    const filePath = results.find((r) => r !== null);
    if (filePath) {
      fileIndex.set(sessionId, { path: filePath, source: "claude" });
      return filePath;
    }
  } catch { /* ignore */ }
  return null;
}

async function loadAllHistory(): Promise<HistoryEntry[]> {
  const [claudeEntries, factoryEntries, codexEntries, piEntries] = await Promise.all([
    loadClaudeHistory(),
    loadFactoryHistory(),
    loadCodexHistory(),
    loadPiHistory(),
  ]);
  await enrichCodexEntries(codexEntries);
  const allEntries = [...claudeEntries, ...factoryEntries, ...codexEntries, ...piEntries];
  historyCache = allEntries;
  return allEntries;
}

export async function loadStorage(): Promise<void> {
  await Promise.all([
    buildClaudeFileIndex(),
    buildFactoryFileIndex(),
    buildCodexFileIndex(),
    buildPiFileIndex(),
  ]);
  await loadAllHistory();
}

export async function getSessions(): Promise<Session[]> {
  return dedupe("getSessions", async () => {
    const entries = historyCache ?? (await loadAllHistory());
    const sessions: Session[] = [];
    const seenIds = new Set<string>();

    for (const entry of entries) {
      let sessionId = entry.sessionId;

      if (!sessionId && entry.source === "claude") {
        const encodedProject = encodeProjectPath(entry.project);
        sessionId = await findClaudeSessionByTimestamp(encodedProject, entry.timestamp);
      }

      if (!sessionId || seenIds.has(sessionId)) continue;
      seenIds.add(sessionId);

      sessions.push({
        id: sessionId,
        display: entry.display,
        timestamp: entry.timestamp,
        project: entry.project,
        projectName: getProjectName(entry.project),
        source: entry.source,
        modelProvider: entry.modelProvider,
        modelId: entry.modelId,
        modelConfidence: entry.modelConfidence,
      });
    }

    return sessions.sort((a, b) => b.timestamp - a.timestamp);
  });
}

export async function getProjects(): Promise<string[]> {
  const entries = historyCache ?? (await loadAllHistory());
  const latestByProject = new Map<string, number>();

  for (const entry of entries) {
    if (!entry.project) continue;
    const prev = latestByProject.get(entry.project) ?? 0;
    const ts = Number.isFinite(entry.timestamp) ? entry.timestamp : 0;
    if (ts >= prev) {
      latestByProject.set(entry.project, ts);
    }
  }

  return [...latestByProject.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([project]) => project);
}

export async function getConversation(sessionId: string): Promise<ConversationMessage[]> {
  return dedupe(`getConversation:${sessionId}`, async () => {
    const entry = fileIndex.get(sessionId);

    if (entry?.source === "factory") {
      return getFactoryConversation(sessionId);
    }
    if (entry?.source === "codex") {
      return getCodexConversation(sessionId);
    }
    if (entry?.source === "pi") {
      return getPiConversation(sessionId);
    }

    // Default: Claude
    const filePath = await findClaudeSessionFile(sessionId);
    if (!filePath) return [];

    const messages: ConversationMessage[] = [];
    try {
      const content = await readFile(filePath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const msg: ConversationMessage = JSON.parse(line);
          if (msg.type === "user" || msg.type === "assistant") {
            if (msg.type === "assistant" && msg.message) {
              const model = msg.message.model;
              const provider = msg.message.provider || inferProviderFromModel(model);
              msg.message.provider = provider;
              msg.message.modelConfidence = model || provider ? "explicit" : "unknown";
            }
            messages.push(msg);
          } else if (msg.type === "summary") {
            messages.unshift(msg);
          }
        } catch { /* skip */ }
      }
    } catch { /* ignore */ }
    return messages;
  });
}

export async function getConversationStream(
  sessionId: string,
  fromOffset: number = 0
): Promise<StreamResult> {
  const entry = fileIndex.get(sessionId);
  let filePath: string | null = null;

  if (entry) {
    filePath = entry.path;
  } else {
    filePath = await findClaudeSessionFile(sessionId);
  }

  if (!filePath) {
    return { messages: [], nextOffset: 0 };
  }

  // For non-Claude sources, use message-count offset (incremental updates)
  if (entry && entry.source !== "claude") {
    const messages = await getConversation(sessionId);
    if (fromOffset >= messages.length) {
      return { messages: [], nextOffset: messages.length };
    }
    return {
      messages: messages.slice(fromOffset),
      nextOffset: messages.length,
    };
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

    const rl = createInterface({ input: stream, crlfDelay: Infinity });
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
  } catch {
    return { messages: [], nextOffset: fromOffset };
  } finally {
    if (fileHandle) await fileHandle.close();
  }
}

export function getSessionSource(sessionId: string): SessionSource {
  const entry = fileIndex.get(sessionId);
  return entry?.source ?? "claude";
}

async function findSessionFileBySource(sessionId: string, source: SessionSource): Promise<string | null> {
  if (source === "claude") return findClaudeSessionFile(sessionId);
  if (source === "factory") return findFactorySessionFile(sessionId);
  if (source === "codex") return findCodexSessionFile(sessionId);
  return findPiSessionFile(sessionId);
}

async function resolveSessionFileForDelete(
  sessionId: string,
  sourceHint?: SessionSource,
): Promise<{ path: string; source: SessionSource } | null> {
  const indexed = fileIndex.get(sessionId);

  if (sourceHint) {
    if (indexed?.source === sourceHint) {
      return indexed;
    }

    const path = await findSessionFileBySource(sessionId, sourceHint);
    return path ? { path, source: sourceHint } : null;
  }

  if (indexed) {
    return indexed;
  }

  for (const source of ["claude", "factory", "codex", "pi"] as const) {
    const path = await findSessionFileBySource(sessionId, source);
    if (path) {
      return { path, source };
    }
  }

  return null;
}

function isFsNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeCode = (error as { code?: unknown }).code;
  return maybeCode === "ENOENT";
}

export async function deleteSession(sessionId: string, sourceHint?: SessionSource): Promise<boolean> {
  const resolved = await resolveSessionFileForDelete(sessionId, sourceHint);
  if (!resolved) return false;

  try {
    await unlink(resolved.path);
  } catch (error) {
    if (!isFsNotFoundError(error)) {
      return false;
    }
  }

  const indexed = fileIndex.get(sessionId);
  if (!indexed || !sourceHint || indexed.source === sourceHint) {
    fileIndex.delete(sessionId);
  }

  pendingRequests.delete(`getConversation:${sessionId}`);
  pendingRequests.delete(`content:${sessionId}`);
  pendingRequests.delete("getSessions");
  pendingRequests.delete("getProjects");
  invalidateHistoryCache();

  return true;
}

const SANITIZE_PATTERNS = [
  /<command-name>[^<]*<\/command-name>/g,
  /<command-message>[^<]*<\/command-message>/g,
  /<command-args>[^<]*<\/command-args>/g,
  /<local-command-stdout>[^<]*<\/local-command-stdout>/g,
  /<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g,
  /<system-reminder>[\s\S]*?<\/system-reminder>/g,
  /<system-notification>[\s\S]*?<\/system-notification>/g,
  /^\s*Caveat:.*?unless the user explicitly asks you to\./s,
];

function sanitizeForIndex(text: string): string {
  let result = text;
  for (const pattern of SANITIZE_PATTERNS) {
    result = result.replace(pattern, "");
  }
  return result.trim();
}

export function getAllSessionContent(sessionId: string): Promise<string> {
  return dedupe(`content:${sessionId}`, async () => {
    const messages = await getConversation(sessionId);
    const parts: string[] = [];
    for (const msg of messages) {
      if (!msg.message) continue;
      const content = msg.message.content;
      if (typeof content === "string") {
        const cleaned = sanitizeForIndex(content);
        if (cleaned) parts.push(cleaned);
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && block.text) {
            const cleaned = sanitizeForIndex(block.text);
            if (cleaned) parts.push(cleaned);
          }
        }
      }
    }
    return parts.join("\n");
  });
}
