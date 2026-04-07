import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import {
  getClaudeDir,
  getSubagentMap,
  getSubagentConversation,
  renameSession,
  findOrphanSessions,
} from "./storage";
import type { ProviderAdapter, ProviderName } from "./provider-types";
import { providerManager } from "./providers";
import {
  initWatcher,
  startWatcher,
  stopWatcher,
  addWatchTarget,
  emitHistoryChange,
  emitSessionChange,
  onHistoryChange,
  offHistoryChange,
  onSessionChange,
  offSessionChange,
  type SessionChangeEvent,
} from "./watcher";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "fs";
import open from "open";
import type { Session } from "./storage";
import { demoManager } from "./demo-data";


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getWebDistPath(): string {
  const prodPath = join(__dirname, "web");
  if (existsSync(prodPath)) {
    return prodPath;
  }
  return join(__dirname, "..", "dist", "web");
}

export interface ServerOptions {
  port: number;
  claudeDir?: string;
  dev?: boolean;
  open?: boolean;
}

export function applyClaudeSessionChange(
  claudeAdapter: Pick<ProviderAdapter, "addToFileIndex" | "invalidateSessionMeta">,
  event: SessionChangeEvent,
): void {
  if (event.provider !== "claude") {
    return;
  }

  claudeAdapter.addToFileIndex(event.sessionId, event.filePath);
  claudeAdapter.invalidateSessionMeta(event.sessionId);
}

export function createServer(options: ServerOptions) {
  const { port, claudeDir, dev = false, open: shouldOpen = true } = options;
  const isDemo = process.env.AGENTS_RUN_DEMO === "1";
  const dataSource = isDemo ? demoManager : providerManager;

  const app = new Hono();

  if (dev) {
    app.use(
      "*",
      cors({
        origin: ["http://localhost:12000"],
        allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
        allowHeaders: ["Content-Type"],
      }),
    );
  }

  // === API Routes ===

  app.get("/api/providers", async (c) => {
    const providers = dataSource.getAvailableProviders();
    const sessions = await dataSource.getSessions();

    const result = providers.map((name) => ({
      name,
      sessionCount: sessions.filter((s) => s.provider === name).length,
    }));

    return c.json(result);
  });

  app.get("/api/sessions", async (c) => {
    const provider = c.req.query("provider") as ProviderName | undefined;
    const sessions = await dataSource.getSessions(provider);
    return c.json(sessions);
  });

  app.delete("/api/sessions/:id", async (c) => {
    if (isDemo) {
      return c.json({ error: "Delete not supported in demo mode" }, 400);
    }
    const sessionId = c.req.param("id");
    const result = await dataSource.deleteSession(sessionId);
    if (result === "unsupported") {
      return c.json({ error: "Delete not supported for this provider" }, 400);
    }
    if (result === "deleted") {
      emitHistoryChange();
      return c.json({ success: true });
    }
    return c.json({ error: "Session not found" }, 404);
  });

  app.post("/api/sessions/:id/rename", async (c) => {
    if (isDemo) {
      return c.json({ error: "Rename not supported in demo mode" }, 400);
    }
    const sessionId = c.req.param("id");
    const sessionProvider = dataSource.getProviderForSession(sessionId);
    if (sessionProvider && sessionProvider !== "claude") {
      return c.json({ error: "Rename not supported for this provider" }, 400);
    }
    try {
      const body = await c.req.json<{ name: string }>();
      const name = body?.name?.trim() ?? "";

      if (!name) {
        return c.json({ error: "Name cannot be empty" }, 400);
      }
      if (name.length > 200) {
        return c.json({ error: "Name too long (max 200 characters)" }, 400);
      }

      const success = await renameSession(sessionId, name);
      if (success) {
        return c.json({ success: true });
      }
      return c.json({ error: "Session not found" }, 404);
    } catch {
      return c.json({ error: "Invalid request body" }, 400);
    }
  });

  app.get("/api/sessions/resolve", async (c) => {
    const query = c.req.query("q")?.trim() ?? "";
    if (!query) return c.json({ sessions: [] });
    const sessions = await findOrphanSessions(query);
    return c.json({ sessions });
  });

  app.get("/api/projects", async (c) => {
    const projects = await dataSource.getProjects();
    return c.json(projects);
  });

  app.get("/api/sessions/stream", async (c) => {
    const provider = c.req.query("provider") as ProviderName | undefined;

    if (isDemo) {
      return streamSSE(c, async (stream) => {
        let isConnected = true;
        const cleanup = () => {
          isConnected = false;
        };

        c.req.raw.signal.addEventListener("abort", cleanup);

        try {
          const sessions = await dataSource.getSessions(provider);
          await stream.writeSSE({
            event: "sessions",
            data: JSON.stringify(sessions),
          });

          while (isConnected) {
            await stream.writeSSE({
              event: "heartbeat",
              data: JSON.stringify({ timestamp: Date.now() }),
            });
            await stream.sleep(30000);
          }
        } catch {
          // Connection closed
        } finally {
          cleanup();
        }
      });
    }

    return streamSSE(c, async (stream) => {
      let isConnected = true;
      const knownSessions = new Map<string, string>();

      const sessionSignature = (session: Session): string =>
        JSON.stringify({
          display: session.display,
          timestamp: session.timestamp,
          project: session.project,
          projectName: session.projectName,
          messageCount: session.messageCount,
          model: session.model ?? null,
          provider: session.provider,
          surface: session.surface ?? null,
          canDelete: session.capabilities?.delete ?? false,
        });

      const cleanup = () => {
        isConnected = false;
        offHistoryChange(handleHistoryChange);
        offSessionChange(handleSessionListChange);
      };

      const syncSessions = async () => {
        if (!isConnected) {
          return;
        }
        try {
          const sessions = await dataSource.getSessions(provider);
          const nextKnownSessions = new Map<string, string>();
          const newOrUpdated = sessions.filter((s) => {
            const signature = sessionSignature(s);
            nextKnownSessions.set(s.id, signature);
            return knownSessions.get(s.id) !== signature;
          });
          const removedSessionIds = [...knownSessions.keys()].filter(
            (sessionId) => !nextKnownSessions.has(sessionId),
          );

          knownSessions.clear();
          for (const [sessionId, signature] of nextKnownSessions) {
            knownSessions.set(sessionId, signature);
          }

          if (newOrUpdated.length > 0) {
            await stream.writeSSE({
              event: "sessionsUpdate",
              data: JSON.stringify(newOrUpdated),
            });
          }
          if (removedSessionIds.length > 0) {
            await stream.writeSSE({
              event: "sessionsRemove",
              data: JSON.stringify(removedSessionIds),
            });
          }
        } catch {
          cleanup();
        }
      };

      const handleHistoryChange = async () => {
        await syncSessions();
      };

      const handleSessionListChange = async (_event: SessionChangeEvent) => {
        await syncSessions();
      };

      onHistoryChange(handleHistoryChange);
      onSessionChange(handleSessionListChange);
      c.req.raw.signal.addEventListener("abort", cleanup);

      try {
        const sessions = await dataSource.getSessions(provider);
        for (const s of sessions) {
          knownSessions.set(s.id, sessionSignature(s));
        }

        await stream.writeSSE({
          event: "sessions",
          data: JSON.stringify(sessions),
        });

        while (isConnected) {
          await stream.writeSSE({
            event: "heartbeat",
            data: JSON.stringify({ timestamp: Date.now() }),
          });
          await stream.sleep(30000);
        }
      } catch {
        // Connection closed
      } finally {
        cleanup();
      }
    });
  });

  app.get("/api/conversation/:id", async (c) => {
    const sessionId = c.req.param("id");
    const messages = await dataSource.getConversation(sessionId);
    return c.json(messages);
  });

  app.get("/api/conversation/:id/subagents", async (c) => {
    if (isDemo) {
      return c.json([]);
    }
    const sessionId = c.req.param("id");
    const sessionProvider = dataSource.getProviderForSession(sessionId);
    if (sessionProvider && sessionProvider !== "claude") {
      return c.json([]);
    }
    const infos = await getSubagentMap(sessionId);
    return c.json(infos);
  });

  app.get("/api/conversation/:id/subagent/:agentId", async (c) => {
    if (isDemo) {
      return c.json([]);
    }
    const sessionId = c.req.param("id");
    const sessionProvider = dataSource.getProviderForSession(sessionId);
    if (sessionProvider && sessionProvider !== "claude") {
      return c.json([]);
    }
    const agentId = c.req.param("agentId");
    const messages = await getSubagentConversation(sessionId, agentId);
    return c.json(messages);
  });

  app.get("/api/conversation/:id/meta", async (c) => {
    const sessionId = c.req.param("id");
    const meta = await dataSource.getSessionMeta(sessionId);
    return c.json(meta);
  });

  app.get("/api/conversation/:id/usage", async (c) => {
    const sessionId = c.req.param("id");
    const meta = await dataSource.getSessionMeta(sessionId);
    return c.json(meta.usage);
  });

  app.get("/api/conversation/:id/stream", async (c) => {
    const sessionId = c.req.param("id");
    const offsetParam = c.req.query("offset");
    let offset = offsetParam ? parseInt(offsetParam, 10) : 0;

    if (isDemo) {
      return streamSSE(c, async (stream) => {
        let isConnected = true;
        const cleanup = () => {
          isConnected = false;
        };

        c.req.raw.signal.addEventListener("abort", cleanup);

        try {
          const { messages, nextOffset } = await dataSource.getConversationStream(
            sessionId,
            offset,
          );
          offset = nextOffset;

          await stream.writeSSE({
            event: "messages",
            data: JSON.stringify({ messages, nextOffset }),
          });

          while (isConnected) {
            await stream.writeSSE({
              event: "heartbeat",
              data: JSON.stringify({ timestamp: Date.now() }),
            });
            await stream.sleep(30000);
          }
        } catch {
          // Connection closed
        } finally {
          cleanup();
        }
      });
    }

    return streamSSE(c, async (stream) => {
      let isConnected = true;
      const expectedProvider = dataSource.getProviderForSession(sessionId);

      const cleanup = () => {
        isConnected = false;
        offSessionChange(handleSessionChange);
      };

      const handleSessionChange = async (event: SessionChangeEvent) => {
        if (event.sessionId !== sessionId || !isConnected) {
          return;
        }

        if (expectedProvider && event.provider !== expectedProvider) {
          return;
        }

        const { messages: newMessages, nextOffset: newOffset } =
          await dataSource.getConversationStream(sessionId, offset);
        offset = newOffset;

        if (newMessages.length > 0) {
          try {
            await stream.writeSSE({
              event: "messages",
              data: JSON.stringify({ messages: newMessages, nextOffset: newOffset }),
            });
          } catch {
            cleanup();
          }
        }
      };

      onSessionChange(handleSessionChange);
      c.req.raw.signal.addEventListener("abort", cleanup);

      try {
        const { messages, nextOffset } = await dataSource.getConversationStream(
          sessionId,
          offset,
        );
        offset = nextOffset;

        await stream.writeSSE({
          event: "messages",
          data: JSON.stringify({ messages, nextOffset }),
        });

        while (isConnected) {
          await stream.writeSSE({
            event: "heartbeat",
            data: JSON.stringify({ timestamp: Date.now() }),
          });
          await stream.sleep(30000);
        }
      } catch {
        // Connection closed
      } finally {
        cleanup();
      }
    });
  });

  app.post("/api/search", async (c) => {
    const body = await c.req.json<{ query: string; provider?: ProviderName }>();
    const query = body?.query?.trim() ?? "";

    if (!query) {
      return c.json({ results: [] });
    }

    const results = await dataSource.searchConversations(query, body?.provider);
    return c.json({ results });
  });

  // === Static files ===

  const webDistPath = getWebDistPath();

  app.use("/*", serveStatic({ root: webDistPath }));

  app.get("/*", async (c) => {
    const indexPath = join(webDistPath, "index.html");
    try {
      const html = readFileSync(indexPath, "utf-8");
      return c.html(html);
    } catch {
      return c.text("UI not found. Run 'pnpm build' first.", 404);
    }
  });

  let httpServer: ServerType | null = null;

  return {
    app,
    port,
    start: async () => {
      const openUrl = `http://localhost:${dev ? 12000 : port}/`;

      if (isDemo) {
        console.log(`\n  Agents Run demo server is running at ${openUrl}\n`);
        if (!dev && shouldOpen) {
          open(openUrl).catch(console.error);
        }

        httpServer = serve({
          fetch: app.fetch,
          port,
        });

        return httpServer;
      }

      // 1. Initialize all providers (includes Claude storage)
      await dataSource.init(claudeDir);

      // 2. Setup Claude watcher (existing logic)
      initWatcher(getClaudeDir());
      startWatcher();

      const claudeAdapter = providerManager.getAdapters().find((a) => a.name === "claude")!;

      onHistoryChange(() => {
        claudeAdapter.invalidateHistoryCache();
      });

      onSessionChange((event) => {
        applyClaudeSessionChange(claudeAdapter, event);
      });

      // 3. Setup watchers for non-Claude providers
      for (const adapter of providerManager.getAdapters()) {
        if (adapter.name === "claude") continue;

        const { paths, depth } = adapter.getWatchPaths();
        addWatchTarget(paths, depth, (filePath) => {
          const sessionId = adapter.resolveSessionId(filePath);

          if (sessionId) {
            adapter.addToFileIndex(sessionId, filePath);
            adapter.invalidateSessionMeta(sessionId);
            emitSessionChange({
              sessionId,
              filePath,
              provider: adapter.name,
            });
          } else {
            adapter.invalidateHistoryCache();
            emitHistoryChange();
          }
        });
      }

      // 4. Start HTTP server
      console.log(`\n  Agents Run is running at ${openUrl}\n`);
      if (!dev && shouldOpen) {
        open(openUrl).catch(console.error);
      }

      httpServer = serve({
        fetch: app.fetch,
        port,
      });

      return httpServer;
    },
    stop: () => {
      stopWatcher();
      if (httpServer) {
        httpServer.close();
      }
    },
  };
}
