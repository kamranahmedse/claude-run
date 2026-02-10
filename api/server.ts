import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import {
  initStorage,
  loadStorage,
  getClaudeDir,
  getFactoryDir,
  getCodexDir,
  getPiDir,
  getSessions,
  getProjects,
  getConversation,
  getConversationStream,
  invalidateHistoryCache,
  addToFileIndex,
  getAllSessionContent,
  deleteSession,
} from "./storage";
import type { SessionSource } from "./storage";
import {
  initWatcher,
  startWatcher,
  stopWatcher,
  onHistoryChange,
  offHistoryChange,
  onSessionChange,
  offSessionChange,
} from "./watcher";
import {
  initSearchDb,
  searchSessions,
  indexSession,
  isSessionIndexed,
  closeSearchDb,
  markSessionDirty,
  getDirtySessions,
  setExpectedSessions,
  removeIndexedSession,
} from "./search";
import { join } from "path";
import { existsSync } from "fs";
import open from "open";

function getWebDistPath(): string {
  const prodPath = join(import.meta.dir, "web");
  if (existsSync(prodPath)) {
    return prodPath;
  }
  return join(import.meta.dir, "..", "dist", "web");
}

export interface ServerOptions {
  port: number;
  claudeDir?: string;
  dev?: boolean;
  open?: boolean;
}

export function createServer(options: ServerOptions) {
  const { port, claudeDir, dev = false, open: shouldOpen = true } = options;

  initStorage(claudeDir);
  initWatcher(getClaudeDir(), getFactoryDir(), getCodexDir(), getPiDir());

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

  app.get("/api/sessions", async (c) => {
    const sessions = await getSessions();
    return c.json(sessions);
  });

  app.delete("/api/sessions/:id", async (c) => {
    const sessionId = c.req.param("id");
    const sourceQuery = c.req.query("source");

    let source: SessionSource | undefined;
    if (sourceQuery) {
      if (sourceQuery !== "claude" && sourceQuery !== "factory" && sourceQuery !== "codex" && sourceQuery !== "pi") {
        return c.json({ ok: false, error: "Invalid source" }, 400);
      }
      source = sourceQuery;
    }

    const deleted = await deleteSession(sessionId, source);
    if (!deleted) {
      return c.json({ ok: false, error: "Session not found" }, 404);
    }

    removeIndexedSession(sessionId, source);
    invalidateHistoryCache();

    try {
      const sessions = await getSessions();
      setExpectedSessions(sessions);
    } catch {
      // ignore refresh errors
    }

    return c.json({ ok: true, id: sessionId });
  });

  app.get("/api/projects", async (c) => {
    const projects = await getProjects();
    return c.json(projects);
  });

  app.get("/api/sessions/stream", async (c) => {
    return streamSSE(c, async (stream) => {
      let isConnected = true;
      const knownSessions = new Map<string, number>();

      const cleanup = () => {
        isConnected = false;
        offHistoryChange(handleHistoryChange);
        offSessionChange(handleContentChange);
      };

      const handleHistoryChange = async () => {
        if (!isConnected) {
          return;
        }
        try {
          const sessions = await getSessions();
          setExpectedSessions(sessions);
          const newOrUpdated = sessions.filter((s) => {
            const known = knownSessions.get(s.id);
            return known === undefined || known !== s.timestamp;
          });

          for (const s of sessions) {
            knownSessions.set(s.id, s.timestamp);
          }

          if (newOrUpdated.length > 0) {
            await stream.writeSSE({
              event: "sessionsUpdate",
              data: JSON.stringify(newOrUpdated),
            });
          }
        } catch {
          cleanup();
        }
      };

      const handleContentChange = async (sessionId: string, _filePath: string, source: SessionSource) => {
        if (!isConnected) return;
        try {
          const content = await getAllSessionContent(sessionId);
          const sessions = await getSessions();
          const session = sessions.find((s) => s.id === sessionId);
          if (session) {
            await stream.writeSSE({
              event: "contentUpdate",
              data: JSON.stringify({
                id: sessionId,
                source,
                display: session.display,
                project: session.project,
                content,
                timestamp: session.timestamp,
              }),
            });
          }
        } catch { /* ignore */ }
      };

      onHistoryChange(handleHistoryChange);
      onSessionChange(handleContentChange);
      c.req.raw.signal.addEventListener("abort", cleanup);

      try {
        const sessions = await getSessions();
        for (const s of sessions) {
          knownSessions.set(s.id, s.timestamp);
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
    const messages = await getConversation(sessionId);
    return c.json(messages);
  });

  app.get("/api/conversation/:id/stream", async (c) => {
    const sessionId = c.req.param("id");
    const offsetParam = c.req.query("offset");
    let offset = offsetParam ? parseInt(offsetParam, 10) : 0;

    return streamSSE(c, async (stream) => {
      let isConnected = true;

      const cleanup = () => {
        isConnected = false;
        offSessionChange(handleSessionChange);
      };

      const handleSessionChange = async (changedSessionId: string, _filePath: string, _source: SessionSource) => {
        if (changedSessionId !== sessionId || !isConnected) {
          return;
        }

        const { messages: newMessages, nextOffset: newOffset } =
          await getConversationStream(sessionId, offset);
        offset = newOffset;

        if (newMessages.length > 0) {
          try {
            await stream.writeSSE({
              event: "messages",
              data: JSON.stringify(newMessages),
            });
          } catch {
            cleanup();
          }
        }
      };

      onSessionChange(handleSessionChange);
      c.req.raw.signal.addEventListener("abort", cleanup);

      try {
        const { messages, nextOffset } = await getConversationStream(
          sessionId,
          offset,
        );
        offset = nextOffset;

        await stream.writeSSE({
          event: "messages",
          data: JSON.stringify(messages),
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

  app.get("/api/search", async (c) => {
    const query = c.req.query("q") || "";
    const source = c.req.query("source") || undefined;
    const limit = Math.max(1, Math.min(100, parseInt(c.req.query("limit") || "50", 10) || 50));
    const fuzzy = c.req.query("fuzzy") !== "0";
    const requireComplete = c.req.query("requireComplete") === "1";

    const response = searchSessions(query, source, { limit, fuzzy });

    if (requireComplete && response.partial) {
      return c.json(response, 409);
    }

    return c.json(response);
  });

  app.get("/api/search-index", async (c) => {
    const sessions = await getSessions();
    const entries = await Promise.all(
      sessions.map(async (s) => {
        try {
          const content = await getAllSessionContent(s.id);
          return { id: s.id, source: s.source, display: s.display, project: s.project, content, timestamp: s.timestamp };
        } catch {
          return { id: s.id, source: s.source, display: s.display, project: s.project, content: "", timestamp: s.timestamp };
        }
      })
    );
    return c.json(entries);
  });

  const webDistPath = getWebDistPath();

  app.get("/*", async (c) => {
    const reqPath = c.req.path === "/" ? "/index.html" : c.req.path;
    const filePath = join(webDistPath, reqPath);
    const file = Bun.file(filePath);
    if (await file.exists()) {
      return new Response(file);
    }
    const indexFile = Bun.file(join(webDistPath, "index.html"));
    if (await indexFile.exists()) {
      return new Response(indexFile, { headers: { "content-type": "text/html" } });
    }
    return c.text("UI not found. Run 'bun run build' first.", 404);
  });

  onHistoryChange(() => {
    invalidateHistoryCache();
    (async () => {
      try {
        const sessions = await getSessions();
        setExpectedSessions(sessions);
      } catch {
        // ignore
      }
    })();
  });

  onSessionChange(async (sessionId: string, filePath: string, source: SessionSource) => {
    addToFileIndex(sessionId, filePath, source);
    markSessionDirty(sessionId);
    try {
      const content = await getAllSessionContent(sessionId);
      const sessions = await getSessions();
      const session = sessions.find((s) => s.id === sessionId);
      if (session) {
        indexSession(sessionId, source, session.display, session.project, content, session.timestamp);
      }
    } catch { /* ignore indexing errors */ }
  });

  startWatcher();

  let httpServer: ReturnType<typeof Bun.serve> | null = null;
  let reindexInterval: ReturnType<typeof setInterval> | null = null;

  async function reindexDirtySessions(): Promise<void> {
    const dirtyIds = getDirtySessions();
    if (dirtyIds.length === 0) return;

    const sessions = await getSessions();
    const sessionMap = new Map(sessions.map((s) => [s.id, s]));

    for (const id of dirtyIds) {
      try {
        const session = sessionMap.get(id);
        if (!session) continue;
        const content = await getAllSessionContent(id);
        indexSession(id, session.source, session.display, session.project, content, session.timestamp);
      } catch { /* skip */ }
    }
  }

  return {
    app,
    port,
    start: async () => {
      await loadStorage();
      initSearchDb();

      const initialSessions = await getSessions();
      setExpectedSessions(initialSessions);

      const apiUrl = `http://localhost:${port}/`;
      if (dev) {
        console.log(`\n  claude-run-plus API is running at ${apiUrl}`);
        console.log("  Frontend: run Vite at http://localhost:12000 (or next available port)\n");
      } else {
        console.log(`\n  claude-run-plus is running at ${apiUrl}\n`);
        if (shouldOpen) {
          open(apiUrl).catch(console.error);
        }
      }

      httpServer = Bun.serve({
        port,
        fetch: app.fetch,
        idleTimeout: 255,
      });

      // Background indexing
      (async () => {
        try {
          const sessions = await getSessions();
          setExpectedSessions(sessions);
          let indexed = 0;
          for (const session of sessions) {
            if (isSessionIndexed(session.id, session.source)) continue;
            try {
              const content = await getAllSessionContent(session.id);
              indexSession(session.id, session.source, session.display, session.project, content, session.timestamp);
              indexed++;
              if (indexed % 50 === 0) {
                console.log(`  Indexed ${indexed}/${sessions.length} sessions...`);
              }
            } catch { /* skip individual errors */ }
          }
          if (indexed > 0) {
            console.log(`  Search index: ${indexed} new sessions indexed\n`);
          }
        } catch (err) {
          console.error("Search indexing error:", err);
        }
      })();

      reindexInterval = setInterval(() => {
        reindexDirtySessions().catch(() => {});
      }, 30_000);

      return httpServer;
    },
    stop: () => {
      if (reindexInterval) {
        clearInterval(reindexInterval);
        reindexInterval = null;
      }
      stopWatcher();
      closeSearchDb();
      if (httpServer) {
        httpServer.stop();
      }
    },
  };
}
