import { readdir, readFile, rename, stat, open, unlink, writeFile } from "fs/promises";
import { join, basename } from "path";
import { homedir } from "os";
import { createInterface } from "readline";
import { createReadStream } from "fs";
import type { ProviderAdapter } from "./provider-types";
import type {
  Session,
  ConversationMessage,
  ContentBlock,
  StreamResult,
  SessionMeta,
  SearchResult,
  SearchMatch,
  SessionTokenUsage,
} from "./storage";
import { findPricing, calculateAggregateCosts } from "./pricing";
import {
  createSessionIdSearchResult,
  createSnippet,
  escapeRegExp,
  matchesSessionId,
} from "./search-utils";

interface CodexSessionMeta {
  cwd: string;
  originator: string;
  surface: string;
  timestamp: number;
  firstPrompt?: string;
  messageCount?: number;
  model?: string;
}

function getProjectName(projectPath: string): string {
  const parts = projectPath.split("/").filter(Boolean);
  return parts[parts.length - 1] || projectPath;
}

async function readFirstLine(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const stream = createReadStream(filePath, { encoding: "utf-8", highWaterMark: 1024 });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    let resolved = false;
    rl.on("line", (line) => {
      if (!resolved) {
        resolved = true;
        rl.close();
        stream.destroy();
        resolve(line);
      }
    });
    rl.on("close", () => {
      if (!resolved) resolve(null);
    });
    rl.on("error", () => {
      if (!resolved) resolve(null);
    });
  });
}

async function findJsonlFilesRecursive(dir: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = await findJsonlFilesRecursive(fullPath);
        results.push(...nested);
      } else if (entry.name.endsWith(".jsonl")) {
        results.push(fullPath);
      }
    }
  } catch {
    // directory may not exist
  }
  return results;
}

async function parallelMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export class CodexAdapter implements ProviderAdapter {
  readonly name = "codex" as const;

  private codexDir: string;
  private sessionIndex = new Map<string, { threadName: string; updatedAt: string }>();
  private fileIndex = new Map<string, string>();
  private reverseFileIndex = new Map<string, string>();
  private sessionMetaCache = new Map<string, CodexSessionMeta>();
  private historyCache: { sessionId: string; ts: string; text: string }[] | null = null;

  private static ORIGINATOR_TO_SURFACE: Record<string, string> = {
    codex_cli_rs: "cli",
    "codex-tui": "tui",
    "Codex Desktop": "app",
    codex_exec: "exec",
  };

  constructor(codexDir?: string) {
    this.codexDir = codexDir ?? join(homedir(), ".codex");
  }

  async init(): Promise<void> {
    // 1. Parse session_index.jsonl
    const indexPath = join(this.codexDir, "session_index.jsonl");
    try {
      const content = await readFile(indexPath, "utf-8");
      for (const line of content.trim().split("\n").filter(Boolean)) {
        try {
          const entry = JSON.parse(line);
          if (entry.id) {
            this.sessionIndex.set(entry.id, {
              threadName: entry.thread_name ?? "",
              updatedAt: entry.updated_at ?? "",
            });
          }
        } catch { /* skip malformed */ }
      }
    } catch { /* file may not exist */ }

    // 2. Scan sessions/ for .jsonl files, read first line for session_meta
    const sessionsDir = join(this.codexDir, "sessions");
    const files = await findJsonlFilesRecursive(sessionsDir);

    await parallelMap(files, 50, async (filePath) => {
      const firstLine = await readFirstLine(filePath);
      if (!firstLine) return;
      try {
        const meta = JSON.parse(firstLine);
        if (meta.type !== "session_meta") return;
        const sessionId = meta.payload?.id;
        if (!sessionId) return;
        this.fileIndex.set(sessionId, filePath);
        this.reverseFileIndex.set(filePath, sessionId);
        const originator = meta.payload.originator ?? "";
        this.sessionMetaCache.set(sessionId, {
          cwd: meta.payload.cwd ?? "",
          originator,
          surface: CodexAdapter.ORIGINATOR_TO_SURFACE[originator] ?? "cli",
          timestamp: Date.parse(meta.payload.timestamp ?? meta.timestamp ?? new Date().toISOString()),
        });
      } catch { /* skip malformed */ }
    });

    // 3. Scan each session for firstPrompt + messageCount
    await parallelMap([...this.fileIndex.entries()], 50, async ([sessionId, filePath]) => {
      const cached = this.sessionMetaCache.get(sessionId);
      if (!cached) return;
      const { firstPrompt, messageCount, model } = await this.scanSessionHead(filePath);
      cached.firstPrompt = firstPrompt;
      cached.messageCount = messageCount;
      if (model) cached.model = model;
    });
  }

  private async scanSessionHead(filePath: string): Promise<{ firstPrompt?: string; messageCount: number; model?: string }> {
    let firstPrompt: string | undefined;
    let model: string | undefined;
    let messageCount = 0;

    try {
      const content = await readFile(filePath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);

      for (const line of lines) {
        try {
          const msg = JSON.parse(line);

          // Extract model and reasoning_effort from turn_context
          if (!model && msg.type === "turn_context" && msg.payload?.model) {
            const effort = msg.payload?.collaboration_mode?.settings?.reasoning_effort;
            model = effort ? `${msg.payload.model} (${effort})` : msg.payload.model;
          }

          if (msg.type !== "response_item") continue;
          const payload = msg.payload;
          if (!payload) continue;

          if (payload.role === "user") {
            messageCount++;
            if (!firstPrompt && payload.content) {
              const textParts = Array.isArray(payload.content)
                ? payload.content.filter((c: any) => c.type === "input_text").map((c: any) => c.text)
                : [];
              if (textParts.length > 0) {
                firstPrompt = textParts.join("\n").slice(0, 200);
              }
            }
          } else if (payload.role === "assistant") {
            messageCount++;
          }
        } catch { /* skip */ }
      }
    } catch { /* file not readable */ }

    return { firstPrompt, messageCount, model };
  }

  getWatchPaths(): { paths: string[]; depth: number } {
    return {
      paths: [
        join(this.codexDir, "session_index.jsonl"),
        join(this.codexDir, "sessions"),
      ],
      depth: 4,
    };
  }

  async getSessions(): Promise<Session[]> {
    if (this.rescanPending) {
      this.rescanPending = false;
      await this.rescanNewSessions();
    }

    const sessions: Session[] = [];

    for (const [sessionId] of this.fileIndex) {
      const indexEntry = this.sessionIndex.get(sessionId);
      const meta = this.sessionMetaCache.get(sessionId);
      if (!meta) continue;

      sessions.push({
        id: sessionId,
        display: (indexEntry?.threadName)
          || meta.firstPrompt?.slice(0, 100)
          || "Untitled",
        timestamp: indexEntry?.updatedAt
          ? Date.parse(indexEntry.updatedAt)
          : meta.timestamp,
        project: meta.cwd,
        projectName: getProjectName(meta.cwd),
        messageCount: meta.messageCount ?? 0,
        model: meta.model,
        provider: "codex",
        surface: meta.surface as Session["surface"],
      });
    }

    return sessions.sort((a, b) => b.timestamp - a.timestamp);
  }

  async getProjects(): Promise<string[]> {
    const projects = new Set<string>();
    for (const meta of this.sessionMetaCache.values()) {
      if (meta.cwd) projects.add(meta.cwd);
    }
    return [...projects].sort();
  }

  async getConversation(sessionId: string): Promise<ConversationMessage[]> {
    const filePath = this.fileIndex.get(sessionId);
    if (!filePath) return [];

    const messages: ConversationMessage[] = [];
    const meta = this.sessionMetaCache.get(sessionId);
    const model = meta?.model;

    try {
      const content = await readFile(filePath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        try {
          const raw = JSON.parse(lines[lineIndex]);
          const msg = this.convertLine(raw, sessionId, lineIndex, model);
          if (msg) messages.push(msg);
        } catch { /* skip */ }
      }
    } catch { /* file not readable */ }

    return messages;
  }

  private convertLine(raw: any, sessionId: string, lineIndex: number, model?: string): ConversationMessage | null {
    if (raw.type !== "response_item") return null;
    const payload = raw.payload;
    if (!payload) return null;

    const uuid = `codex-${sessionId}-${lineIndex}`;

    // Skip types we don't display
    if (payload.role === "developer") return null;

    // User message
    if (payload.role === "user") {
      let textContent = "";
      if (Array.isArray(payload.content)) {
        const textParts = payload.content
          .filter((c: any) => c.type === "input_text")
          .map((c: any) => c.text);
        textContent = textParts.join("\n");
      }

      // Check if it contains tool_result blocks
      const hasToolResult = Array.isArray(payload.content) &&
        payload.content.some((c: any) => c.type === "tool_result" || c.type === "function_call_output");

      if (hasToolResult) return null; // Skip tool results embedded in user messages

      if (!textContent.trim()) return null;

      return {
        type: "user",
        uuid,
        message: {
          role: "user",
          content: textContent,
        },
      };
    }

    // Assistant message
    if (payload.role === "assistant") {
      const blocks: ContentBlock[] = [];
      if (Array.isArray(payload.content)) {
        for (const c of payload.content) {
          if (c.type === "output_text" && c.text) {
            blocks.push({ type: "text", text: c.text });
          }
        }
      }
      if (blocks.length === 0) return null;

      return {
        type: "assistant",
        uuid,
        message: {
          role: "assistant",
          content: blocks,
          model,
        },
      };
    }

    // Reasoning (encrypted, show placeholder)
    if (payload.type === "reasoning") {
      const thinkingText = payload.summary?.[0]?.text ?? "[Reasoning]";
      return {
        type: "assistant",
        uuid,
        message: {
          role: "assistant",
          content: [{ type: "thinking", thinking: thinkingText }],
        },
      };
    }

    // Function call
    if (payload.type === "function_call") {
      let parsedArgs: unknown = {};
      try {
        parsedArgs = JSON.parse(payload.arguments ?? "{}");
      } catch {
        parsedArgs = { raw: payload.arguments };
      }

      return {
        type: "assistant",
        uuid,
        message: {
          role: "assistant",
          content: [{
            type: "tool_use",
            id: payload.call_id,
            name: payload.name,
            input: parsedArgs,
          }],
        },
      };
    }

    // Function call output
    if (payload.type === "function_call_output") {
      return {
        type: "user",
        uuid,
        message: {
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: payload.call_id,
            content: payload.output ?? "",
          }] as any,
        },
      };
    }

    return null;
  }

  async getConversationStream(sessionId: string, fromOffset: number = 0): Promise<StreamResult> {
    const filePath = this.fileIndex.get(sessionId);
    if (!filePath) return { messages: [], nextOffset: 0 };

    const meta = this.sessionMetaCache.get(sessionId);
    const model = meta?.model;
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
      let lineIndex = fromOffset > 0 ? -1 : 0; // approximate line index

      for await (const line of rl) {
        const lineBytes = Buffer.byteLength(line, "utf-8") + 1;

        if (line.trim()) {
          try {
            const raw = JSON.parse(line);
            // Use byte offset as part of uuid for stream uniqueness
            const msg = this.convertLine(raw, sessionId, fromOffset + bytesConsumed, model);
            if (msg) messages.push(msg);
            bytesConsumed += lineBytes;
          } catch {
            break;
          }
        } else {
          bytesConsumed += lineBytes;
        }
        lineIndex++;
      }

      const actualOffset = fromOffset + bytesConsumed;
      const nextOffset = actualOffset > fileSize ? fileSize : actualOffset;

      return { messages, nextOffset };
    } catch {
      return { messages: [], nextOffset: fromOffset };
    } finally {
      if (fileHandle) {
        await fileHandle.close();
      }
    }
  }

  async getSessionMeta(sessionId: string): Promise<SessionMeta> {
    const usage: SessionTokenUsage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_write_5m_tokens: 0,
      cache_write_1h_tokens: 0,
      cache_read_tokens: 0,
    };
    let model: string | undefined;

    const filePath = this.fileIndex.get(sessionId);
    if (!filePath) return { usage, subagents: [], costs: null };

    const meta = this.sessionMetaCache.get(sessionId);
    if (meta?.model) model = meta.model;

    try {
      const content = await readFile(filePath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);

      for (const line of lines) {
        try {
          const raw = JSON.parse(line);
          // Extract model from turn_context
          if (!model && raw.type === "turn_context" && raw.payload?.model) {
            model = raw.payload.model;
          }
          // Extract token usage from token_count events (use total_token_usage)
          if (raw.type === "event_msg" && raw.payload?.type === "token_count" && raw.payload.info?.total_token_usage) {
            const tu = raw.payload.info.total_token_usage;
            // Keep updating — the last token_count has the cumulative totals
            // OpenAI's input_tokens includes cached_input_tokens as a subset,
            // but Claude's model treats them as separate additive counters.
            // Subtract cached from input to align with Claude's semantics.
            const cached = tu.cached_input_tokens ?? 0;
            usage.input_tokens = (tu.input_tokens ?? 0) - cached;
            // reasoning_output_tokens is a subset of output_tokens (not additive)
            usage.output_tokens = tu.output_tokens ?? 0;
            usage.cache_read_tokens = cached;
          }
        } catch { /* skip */ }
      }
    } catch { /* file not readable */ }

    const pricing = findPricing(model ?? "");
    const costs = pricing ? calculateAggregateCosts(usage, pricing) : null;

    return { usage, subagents: [], model, costs };
  }

  async searchConversations(query: string): Promise<SearchResult[]> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return [];

    const lowerQuery = trimmedQuery.toLowerCase();
    const queryRegex = new RegExp(escapeRegExp(trimmedQuery), "i");
    const results: SearchResult[] = [];
    const sessions = await this.getSessions();

    const BATCH_SIZE = 50;
    for (let i = 0; i < sessions.length; i += BATCH_SIZE) {
      const batch = sessions.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (session) => {
          if (matchesSessionId(session.id, trimmedQuery)) {
            return createSessionIdSearchResult(session, trimmedQuery);
          }

          const filePath = this.fileIndex.get(session.id);
          if (!filePath) return null;

          try {
            const content = await readFile(filePath, "utf-8");
            if (!queryRegex.test(content)) return null;

            const lines = content.trim().split("\n").filter(Boolean);
            let matchCount = 0;
            let firstMatch: SearchMatch | null = null;
            let messageIndex = 0;

            for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
              try {
                const raw = JSON.parse(lines[lineIdx]);
                if (raw.type !== "response_item") continue;
                const payload = raw.payload;
                if (!payload) continue;
                if (payload.role === "developer") continue;
                if (payload.role !== "user" && payload.role !== "assistant") continue;

                const text = this.extractTextFromPayload(payload);
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
              } catch { /* skip */ }
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
          } catch { /* file not readable */ }

          return null;
        }),
      );

      for (const r of batchResults) {
        if (r) results.push(r);
      }
    }

    return results.sort((a, b) => b.timestamp - a.timestamp);
  }

  private extractTextFromPayload(payload: any): string {
    if (payload.role === "user" && Array.isArray(payload.content)) {
      return payload.content
        .filter((c: any) => c.type === "input_text")
        .map((c: any) => c.text ?? "")
        .join(" ");
    }
    if (payload.role === "assistant" && Array.isArray(payload.content)) {
      return payload.content
        .filter((c: any) => c.type === "output_text")
        .map((c: any) => c.text ?? "")
        .join(" ");
    }
    return "";
  }

  ownsSession(sessionId: string): boolean {
    return this.fileIndex.has(sessionId);
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const filePath = this.fileIndex.get(sessionId);
    const removedIndexEntry = await this.removeSessionIndexEntry(sessionId);
    const removedSessionFile = await this.removeSessionFile(filePath);
    await this.removeShellSnapshots(sessionId);

    if (!removedIndexEntry && !removedSessionFile) {
      return false;
    }

    this.removeSessionFromCache(sessionId);
    return true;
  }

  resolveSessionId(filePath: string): string | null {
    if (filePath.endsWith("session_index.jsonl")) return null;
    if (filePath.endsWith("history.jsonl")) return null;
    return this.reverseFileIndex.get(filePath) ?? null;
  }

  private rescanPending = false;

  invalidateHistoryCache(): void {
    this.historyCache = null;
    this.rescanPending = true;
  }

  invalidateSessionMeta(sessionId: string): void {
    // Re-scan session head to refresh messageCount/firstPrompt
    const filePath = this.fileIndex.get(sessionId);
    if (!filePath) return;
    this.scanSessionHead(filePath).then(({ firstPrompt, messageCount, model }) => {
      const cached = this.sessionMetaCache.get(sessionId);
      if (cached) {
        cached.firstPrompt = firstPrompt;
        cached.messageCount = messageCount;
        if (model) cached.model = model;
      }
    }).catch(() => {});
  }

  private async rescanNewSessions(): Promise<void> {
    // Re-read session_index.jsonl
    const indexPath = join(this.codexDir, "session_index.jsonl");
    try {
      const content = await readFile(indexPath, "utf-8");
      this.sessionIndex.clear();
      for (const line of content.trim().split("\n").filter(Boolean)) {
        try {
          const entry = JSON.parse(line);
          if (entry.id) {
            this.sessionIndex.set(entry.id, {
              threadName: entry.thread_name ?? "",
              updatedAt: entry.updated_at ?? "",
            });
          }
        } catch { /* skip */ }
      }
    } catch { /* file may not exist */ }

    // Scan for new session files
    const sessionsDir = join(this.codexDir, "sessions");
    const files = await findJsonlFilesRecursive(sessionsDir);

    for (const filePath of files) {
      // Skip files already indexed
      if (this.reverseFileIndex.has(filePath)) continue;

      const firstLine = await readFirstLine(filePath);
      if (!firstLine) continue;
      try {
        const meta = JSON.parse(firstLine);
        if (meta.type !== "session_meta") continue;
        const sessionId = meta.payload?.id;
        if (!sessionId) continue;
        this.fileIndex.set(sessionId, filePath);
        this.reverseFileIndex.set(filePath, sessionId);
        const originator = meta.payload.originator ?? "";
        this.sessionMetaCache.set(sessionId, {
          cwd: meta.payload.cwd ?? "",
          originator,
          surface: CodexAdapter.ORIGINATOR_TO_SURFACE[originator] ?? "cli",
          timestamp: Date.parse(meta.payload.timestamp ?? meta.timestamp ?? new Date().toISOString()),
        });

        // Scan head for firstPrompt + messageCount
        const { firstPrompt, messageCount } = await this.scanSessionHead(filePath);
        const cached = this.sessionMetaCache.get(sessionId);
        if (cached) {
          cached.firstPrompt = firstPrompt;
          cached.messageCount = messageCount;
        }
      } catch { /* skip malformed */ }
    }
  }

  addToFileIndex(sessionId: string, filePath: string): void {
    this.fileIndex.set(sessionId, filePath);
    this.reverseFileIndex.set(filePath, sessionId);
  }

  private removeSessionFromCache(sessionId: string): void {
    const filePath = this.fileIndex.get(sessionId);
    if (filePath) {
      this.reverseFileIndex.delete(filePath);
    }
    this.fileIndex.delete(sessionId);
    this.sessionIndex.delete(sessionId);
    this.sessionMetaCache.delete(sessionId);
    this.historyCache = null;
  }

  private async removeSessionIndexEntry(sessionId: string): Promise<boolean> {
    const indexPath = join(this.codexDir, "session_index.jsonl");

    try {
      const content = await readFile(indexPath, "utf-8");
      const lines = content.split("\n").filter(Boolean);
      const filteredLines = lines.filter((line) => {
        try {
          const entry = JSON.parse(line);
          return entry.id !== sessionId;
        } catch {
          return true;
        }
      });

      if (filteredLines.length === lines.length) {
        return false;
      }

      const tempPath = `${indexPath}.tmp`;
      const nextContent = filteredLines.length > 0
        ? `${filteredLines.join("\n")}\n`
        : "";
      await writeFile(tempPath, nextContent, "utf-8");
      await rename(tempPath, indexPath);
      return true;
    } catch {
      return false;
    }
  }

  private async removeSessionFile(filePath?: string): Promise<boolean> {
    if (!filePath) {
      return false;
    }

    try {
      await unlink(filePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return true;
      }
      return false;
    }
  }

  private async removeShellSnapshots(sessionId: string): Promise<void> {
    const snapshotsDir = join(this.codexDir, "shell_snapshots");

    try {
      const entries = await readdir(snapshotsDir, { withFileTypes: true });
      const targets = entries.filter(
        (entry) =>
          entry.isFile()
          && entry.name.startsWith(`${sessionId}.`)
          && entry.name.endsWith(".sh"),
      );

      await Promise.all(
        targets.map((entry) =>
          unlink(join(snapshotsDir, entry.name)).catch(() => {}),
        ),
      );
    } catch {
      // shell snapshots are best-effort cleanup
    }
  }
}
