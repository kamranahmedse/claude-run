import { readdir, readFile, unlink } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
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
import { findPricing, calculateSessionCosts, type TurnUsage } from "./pricing";
import {
  createSessionIdSearchResult,
  createSnippet,
  escapeRegExp,
  matchesSessionId,
} from "./search-utils";

interface GeminiSessionMeta {
  startTime: string;
  lastUpdated: string;
  summary?: string;
  firstUserMessage?: string;
  messageCount: number;
  model?: string;
}

function getProjectName(projectPath: string): string {
  const parts = projectPath.split("/").filter(Boolean);
  return parts[parts.length - 1] || projectPath;
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

export class GeminiAdapter implements ProviderAdapter {
  readonly name = "gemini" as const;

  private geminiDir: string;
  // slug → absolutePath
  private projectMap = new Map<string, string>();
  // sessionId → filePath
  private fileIndex = new Map<string, string>();
  // filePath → sessionId (for watcher reverse lookup)
  private reverseFileIndex = new Map<string, string>();
  // sessionId → slug
  private fileSlugMap = new Map<string, string>();
  // cached session metadata
  private sessionCache = new Map<string, GeminiSessionMeta>();

  constructor(geminiDir?: string) {
    this.geminiDir = geminiDir ?? join(homedir(), ".gemini");
  }

  async init(): Promise<void> {
    // 1. Parse projects.json (reverse mapping: {"/abs/path": "slug"})
    const projectsPath = join(this.geminiDir, "projects.json");
    try {
      const data = JSON.parse(await readFile(projectsPath, "utf-8"));
      if (data.projects) {
        for (const [absPath, slug] of Object.entries(data.projects)) {
          this.projectMap.set(slug as string, absPath);
        }
      }
    } catch { /* file may not exist */ }

    // 2. Scan tmp/*/chats/session-*.json
    const tmpDir = join(this.geminiDir, "tmp");
    let slugDirs: any[];
    try {
      slugDirs = (await readdir(tmpDir, { withFileTypes: true })).filter(d => d.isDirectory());
    } catch {
      return; // tmp dir doesn't exist
    }

    await parallelMap(slugDirs, 20, async (slugDir: any) => {
      const chatsDir = join(tmpDir, slugDir.name, "chats");
      let chatFiles: string[];
      try {
        chatFiles = (await readdir(chatsDir))
          .filter(f => f.startsWith("session-") && f.endsWith(".json"));
      } catch { return; }

      for (const file of chatFiles) {
        const filePath = join(chatsDir, file);
        try {
          const raw = await readFile(filePath, "utf-8");
          const data = JSON.parse(raw);
          const sessionId = data.sessionId;
          if (!sessionId) continue;

          this.fileIndex.set(sessionId, filePath);
          this.reverseFileIndex.set(filePath, sessionId);
          this.fileSlugMap.set(sessionId, slugDir.name);

          // Cache metadata only (not full messages)
          const messages = data.messages ?? [];
          const firstUser = messages.find((m: any) => m.type === "user");
          const firstGemini = messages.find((m: any) => m.type === "gemini");

          this.sessionCache.set(sessionId, {
            startTime: data.startTime ?? "",
            lastUpdated: data.lastUpdated ?? "",
            summary: data.summary,
            firstUserMessage: this.extractUserDisplayText(firstUser),
            messageCount: messages.filter(
              (m: any) => m.type === "user" || m.type === "gemini"
            ).length,
            model: firstGemini?.model,
          });
        } catch { /* skip malformed */ }
      }
    });
  }

  getWatchPaths(): { paths: string[]; depth: number } {
    return {
      paths: [
        join(this.geminiDir, "projects.json"),
        join(this.geminiDir, "tmp"),
      ],
      depth: 3,
    };
  }

  async getSessions(): Promise<Session[]> {
    if (this.rescanPending) {
      this.rescanPending = false;
      await this.rescanNewSessions();
    }

    const sessions: Session[] = [];

    for (const [sessionId, cached] of this.sessionCache) {
      const slug = this.fileSlugMap.get(sessionId);
      const projectPath = slug ? (this.projectMap.get(slug) ?? "") : "";

      sessions.push({
        id: sessionId,
        display: cached.summary
          ?? cached.firstUserMessage?.slice(0, 100)
          ?? "Untitled",
        timestamp: Date.parse(cached.lastUpdated || cached.startTime) || Date.now(),
        project: projectPath,
        projectName: getProjectName(projectPath || slug || "unknown"),
        messageCount: cached.messageCount,
        model: cached.model,
        provider: "gemini",
      });
    }

    return sessions.sort((a, b) => b.timestamp - a.timestamp);
  }

  async getProjects(): Promise<string[]> {
    const projects = new Set<string>();
    for (const [sessionId] of this.sessionCache) {
      const slug = this.fileSlugMap.get(sessionId);
      const projectPath = slug ? (this.projectMap.get(slug) ?? "") : "";
      if (projectPath) projects.add(projectPath);
    }
    return [...projects].sort();
  }

  async getConversation(sessionId: string): Promise<ConversationMessage[]> {
    const filePath = this.fileIndex.get(sessionId);
    if (!filePath) return [];

    try {
      const raw = await readFile(filePath, "utf-8");
      const data = JSON.parse(raw);
      return this.convertMessages(data.messages ?? []);
    } catch {
      return [];
    }
  }

  private extractUserDisplayText(m: any): string | undefined {
    if (!m) return undefined;
    // Prefer displayContent (short text without embedded file contents)
    const dc = m.displayContent;
    if (dc) {
      if (typeof dc === "string") return dc;
      if (Array.isArray(dc)) {
        const text = dc.map((c: any) => c.text ?? "").join("\n");
        if (text.trim()) return text;
      }
    }
    // Fall back to content
    const c = m.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) return c.map((x: any) => x.text ?? "").join("\n");
    return undefined;
  }

  private convertMessages(messages: any[]): ConversationMessage[] {
    const result: ConversationMessage[] = [];

    for (const m of messages) {
      if (m.type === "user") {
        // User message — prefer displayContent over content
        const textContent = this.extractUserDisplayText(m) ?? "";

        if (!textContent.trim()) continue;

        result.push({
          type: "user",
          uuid: m.id,
          timestamp: m.timestamp,
          message: {
            role: "user",
            content: textContent,
          },
        });
      } else if (m.type === "gemini") {
        // Assistant message
        const blocks: ContentBlock[] = [];

        // 1. Thinking blocks from thoughts
        if (m.thoughts?.length) {
          for (const thought of m.thoughts) {
            blocks.push({
              type: "thinking",
              thinking: `**${thought.subject ?? "Thinking"}**\n${thought.description ?? ""}`,
            });
          }
        }

        // 2. Text content (content is a string in Gemini, not array)
        if (m.content) {
          blocks.push({ type: "text", text: m.content });
        }

        // 3. Tool calls (embedded in the same message)
        if (m.toolCalls?.length) {
          for (const tc of m.toolCalls) {
            blocks.push({
              type: "tool_use",
              id: tc.id,
              name: tc.name ?? tc.displayName,
              input: tc.args,
            });
            if (tc.result !== undefined) {
              blocks.push({
                type: "tool_result",
                tool_use_id: tc.id,
                content: typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result),
              });
            }
          }
        }

        if (blocks.length === 0) continue;

        // Build usage from tokens field
        const usage = m.tokens ? {
          input_tokens: m.tokens.input ?? 0,
          output_tokens: m.tokens.output ?? 0,
          cache_read_input_tokens: m.tokens.cached ?? 0,
        } : undefined;

        result.push({
          type: "assistant",
          uuid: m.id,
          timestamp: m.timestamp,
          message: {
            role: "assistant",
            content: blocks.length === 1 && blocks[0].type === "text"
              ? blocks[0].text!
              : blocks,
            model: m.model,
            usage: usage as any,
          },
        });
      }
      // Skip type: "info" and other types
    }

    return result;
  }

  async getConversationStream(sessionId: string, fromOffset: number = 0): Promise<StreamResult> {
    const filePath = this.fileIndex.get(sessionId);
    if (!filePath) return { messages: [], nextOffset: 0 };

    try {
      const data = JSON.parse(await readFile(filePath, "utf-8"));
      const allMessages = this.convertMessages(data.messages ?? []);
      const newMessages = allMessages.slice(fromOffset);

      return {
        messages: newMessages,
        nextOffset: allMessages.length,
      };
    } catch {
      return { messages: [], nextOffset: fromOffset };
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
    const turns: TurnUsage[] = [];
    let model: string | undefined;

    const cached = this.sessionCache.get(sessionId);
    if (cached?.model) model = cached.model;

    const filePath = this.fileIndex.get(sessionId);
    if (!filePath) return { usage, subagents: [], costs: null };

    try {
      const data = JSON.parse(await readFile(filePath, "utf-8"));
      for (const m of (data.messages ?? [])) {
        if (m.type === "gemini") {
          if (!model && m.model) model = m.model;
          if (m.tokens) {
            const turnInput = m.tokens.input ?? 0;
            const turnOutput = m.tokens.output ?? 0;
            const turnCacheRead = m.tokens.cached ?? 0;

            usage.input_tokens += turnInput;
            usage.output_tokens += turnOutput;
            usage.cache_read_tokens += turnCacheRead;

            turns.push({
              input_tokens: turnInput,
              output_tokens: turnOutput,
              cache_read_tokens: turnCacheRead,
              cache_write_5m_tokens: 0,
              cache_write_1h_tokens: 0,
            });
          }
        }
      }
    } catch { /* file not readable */ }

    const pricing = findPricing(model ?? "");
    const costs = pricing ? calculateSessionCosts(turns, pricing) : null;

    return { usage, subagents: [], model, costs };
  }

  async searchConversations(query: string): Promise<SearchResult[]> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return [];

    const lowerQuery = trimmedQuery.toLowerCase();
    const queryRegex = new RegExp(escapeRegExp(trimmedQuery), "i");
    const results: SearchResult[] = [];
    const sessions = await this.getSessions();

    const BATCH_SIZE = 20;
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
            const raw = await readFile(filePath, "utf-8");
            if (!queryRegex.test(raw)) return null;

            const data = JSON.parse(raw);
            const messages = data.messages ?? [];
            let matchCount = 0;
            let firstMatch: SearchMatch | null = null;
            let messageIndex = 0;

            for (const m of messages) {
              if (m.type !== "user" && m.type !== "gemini") continue;

              let text = "";
              if (m.type === "user") {
                text = this.extractUserDisplayText(m) ?? "";
              } else {
                text = m.content ?? "";
              }

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
          } catch { /* skip */ }

          return null;
        }),
      );

      for (const r of batchResults) {
        if (r) results.push(r);
      }
    }

    return results.sort((a, b) => b.timestamp - a.timestamp);
  }

  ownsSession(sessionId: string): boolean {
    return this.fileIndex.has(sessionId);
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const filePath = this.fileIndex.get(sessionId);
    if (!filePath) {
      return false;
    }

    try {
      await unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        return false;
      }
    }

    this.removeSessionFromCache(sessionId);
    return true;
  }

  resolveSessionId(filePath: string): string | null {
    if (filePath.endsWith("projects.json")) return null;
    return this.reverseFileIndex.get(filePath) ?? null;
  }

  private rescanPending = false;

  invalidateHistoryCache(): void {
    // Schedule a rescan for new session files on next getSessions() call
    this.rescanPending = true;
  }

  private async rescanNewSessions(): Promise<void> {
    // Re-read projects.json
    const projectsPath = join(this.geminiDir, "projects.json");
    try {
      const data = JSON.parse(await readFile(projectsPath, "utf-8"));
      if (data.projects) {
        this.projectMap.clear();
        for (const [absPath, slug] of Object.entries(data.projects)) {
          this.projectMap.set(slug as string, absPath);
        }
      }
    } catch { /* file may not exist */ }

    // Scan for new session files
    const tmpDir = join(this.geminiDir, "tmp");
    let slugDirs: any[];
    try {
      slugDirs = (await readdir(tmpDir, { withFileTypes: true })).filter((d: any) => d.isDirectory());
    } catch { return; }

    for (const slugDir of slugDirs) {
      const chatsDir = join(tmpDir, slugDir.name, "chats");
      let chatFiles: string[];
      try {
        chatFiles = (await readdir(chatsDir))
          .filter((f: string) => f.startsWith("session-") && f.endsWith(".json"));
      } catch { continue; }

      for (const file of chatFiles) {
        const filePath = join(chatsDir, file);
        // Skip files already indexed
        if (this.reverseFileIndex.has(filePath)) continue;

        try {
          const raw = await readFile(filePath, "utf-8");
          const data = JSON.parse(raw);
          const sessionId = data.sessionId;
          if (!sessionId) continue;

          this.fileIndex.set(sessionId, filePath);
          this.reverseFileIndex.set(filePath, sessionId);
          this.fileSlugMap.set(sessionId, slugDir.name);

          const messages = data.messages ?? [];
          const firstUser = messages.find((m: any) => m.type === "user");
          const firstGemini = messages.find((m: any) => m.type === "gemini");

          this.sessionCache.set(sessionId, {
            startTime: data.startTime ?? "",
            lastUpdated: data.lastUpdated ?? "",
            summary: data.summary,
            firstUserMessage: this.extractUserDisplayText(firstUser),
            messageCount: messages.filter(
              (m: any) => m.type === "user" || m.type === "gemini"
            ).length,
            model: firstGemini?.model,
          });
        } catch { /* skip malformed */ }
      }
    }
  }

  invalidateSessionMeta(sessionId: string): void {
    // Re-read the file and refresh the cached metadata (don't delete — getSessions depends on it)
    const filePath = this.fileIndex.get(sessionId);
    if (!filePath) return;
    this.refreshSessionMeta(sessionId, filePath).catch(() => {});
  }

  private async refreshSessionMeta(sessionId: string, filePath: string): Promise<void> {
    try {
      const raw = await readFile(filePath, "utf-8");
      const data = JSON.parse(raw);
      const messages = data.messages ?? [];
      const firstUser = messages.find((m: any) => m.type === "user");
      const firstGemini = messages.find((m: any) => m.type === "gemini");

      this.sessionCache.set(sessionId, {
        startTime: data.startTime ?? "",
        lastUpdated: data.lastUpdated ?? "",
        summary: data.summary,
        firstUserMessage: this.extractUserDisplayText(firstUser),
        messageCount: messages.filter(
          (m: any) => m.type === "user" || m.type === "gemini"
        ).length,
        model: firstGemini?.model,
      });
    } catch { /* file not readable or malformed */ }
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
    this.fileSlugMap.delete(sessionId);
    this.sessionCache.delete(sessionId);
  }
}
