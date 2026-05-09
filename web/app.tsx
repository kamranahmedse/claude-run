import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { Session } from "@claude-run/api";
import { PanelLeft, Copy, Check, Sun, Moon, Pencil } from "lucide-react";
import { formatTime } from "./utils";
import SessionList from "./components/session-list";
import SessionView from "./components/session-view";
import { useEventSource } from "./hooks/use-event-source";

interface SessionHeaderProps {
  session: Session;
  copied: boolean;
  onCopyResumeCommand: (sessionId: string, projectPath: string) => void;
  onRenameSession: (sessionId: string, newName: string) => void;
}

function SessionHeader(props: SessionHeaderProps) {
  const { session, copied, onCopyResumeCommand, onRenameSession } = props;
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const startRename = useCallback(() => {
    setRenameValue(session.display);
    setRenaming(true);
  }, [session.display]);

  useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renaming]);

  const handleRenameSave = useCallback(() => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== session.display) {
      onRenameSession(session.id, trimmed);
    }
    setRenaming(false);
  }, [renameValue, session.id, session.display, onRenameSession]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleRenameSave();
    } else if (e.key === "Escape") {
      setRenaming(false);
    }
  }, [handleRenameSave]);

  return (
    <>
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {renaming ? (
          <input
            ref={inputRef}
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameSave}
            onKeyDown={handleKeyDown}
            className="text-sm theme-text-primary bg-transparent border border-blue-500/50 rounded px-2 py-0.5 outline-none flex-1 min-w-0"
          />
        ) : (
          <span
            className="text-sm theme-text-primary truncate max-w-xs cursor-pointer hover:underline decoration-dotted underline-offset-2"
            onClick={startRename}
            title="Click to rename"
          >
            {session.display}
          </span>
        )}
        <span className="text-xs theme-text-tertiary shrink-0">
          {session.projectName}
        </span>
        <span className="text-xs theme-text-tertiary shrink-0">
          {formatTime(session.timestamp)}
        </span>
      </div>
      <button
        onClick={startRename}
        className="flex items-center gap-2 px-2.5 py-1.5 text-xs theme-text-secondary theme-btn rounded transition-colors cursor-pointer shrink-0"
        title="Rename session"
      >
        <Pencil className="w-3.5 h-3.5" />
        <span>Rename</span>
      </button>
      <button
        onClick={() => onCopyResumeCommand(session.id, session.project)}
        className="flex items-center gap-2 px-2.5 py-1.5 text-xs theme-text-secondary theme-btn rounded transition-colors cursor-pointer shrink-0"
        title="Copy resume command to clipboard"
      >
        {copied ? (
          <>
            <Check className="w-3.5 h-3.5 text-green-500" />
            <span className="text-green-500">Copied!</span>
          </>
        ) : (
          <>
            <Copy className="w-3.5 h-3.5" />
            <span>Copy Resume Command</span>
          </>
        )}
      </button>
    </>
  );
}

function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem("claude-run-sidebar-width");
    return saved ? Number(saved) : 320;
  });
  const [isResizing, setIsResizing] = useState(false);
  const sidebarWidthRef = useRef(sidebarWidth);
  const sidebarRef = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = localStorage.getItem("claude-run-theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("claude-run-theme", theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(200, Math.min(600, e.clientX));
      sidebarWidthRef.current = newWidth;
      setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => {
      setIsResizing(false);
      localStorage.setItem("claude-run-sidebar-width", String(sidebarWidthRef.current));
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing]);

  const handleCopyResumeCommand = useCallback(
    (sessionId: string, projectPath: string) => {
      const command = `cd ${projectPath} && claude --resume ${sessionId}`;
      navigator.clipboard.writeText(command).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    },
    [],
  );

  const selectedSessionData = useMemo(() => {
    if (!selectedSession) {
      return null;
    }

    return sessions.find((s) => s.id === selectedSession) || null;
  }, [sessions, selectedSession]);

  useEffect(() => {
    fetch("/api/projects")
      .then((res) => res.json())
      .then(setProjects)
      .catch(console.error);
  }, []);

  const handleSessionsFull = useCallback((event: MessageEvent) => {
    const data: Session[] = JSON.parse(event.data);
    setSessions(data);
    setLoading(false);
  }, []);

  const handleSessionsUpdate = useCallback((event: MessageEvent) => {
    const updates: Session[] = JSON.parse(event.data);
    setSessions((prev) => {
      const sessionMap = new Map(prev.map((s) => [s.id, s]));
      for (const update of updates) {
        sessionMap.set(update.id, update);
      }
      return Array.from(sessionMap.values()).sort(
        (a, b) => b.timestamp - a.timestamp,
      );
    });
  }, []);

  const handleSessionsError = useCallback(() => {
    setLoading(false);
  }, []);

  useEventSource("/api/sessions/stream", {
    events: [
      { eventName: "sessions", onMessage: handleSessionsFull },
      { eventName: "sessionsUpdate", onMessage: handleSessionsUpdate },
    ],
    onError: handleSessionsError,
  });

  const filteredSessions = useMemo(() => {
    if (!selectedProject) {
      return sessions;
    }
    return sessions.filter((s) => s.project === selectedProject);
  }, [sessions, selectedProject]);

  const handleSelectSession = useCallback((sessionId: string) => {
    setSelectedSession(sessionId);
  }, []);

  const handleDeleteSession = useCallback((sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    setSelectedSession((prev) => (prev === sessionId ? null : prev));
  }, []);

  const handleRenameSession = useCallback((sessionId: string, newName: string) => {
    fetch(`/api/sessions/${sessionId}/rename`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setSessions((prev) =>
            prev.map((s) => (s.id === sessionId ? { ...s, display: newName } : s))
          );
        }
      })
      .catch(console.error);
  }, []);

  return (
    <div className="flex h-screen theme-page">
      <aside
        ref={sidebarRef}
        className={`border-r theme-border flex flex-col theme-page ${sidebarCollapsed ? "hidden" : "flex"}`}
        style={{ width: sidebarCollapsed ? undefined : sidebarWidth, flexShrink: 0 }}
      >
        <div className="border-b theme-border">
          <label htmlFor={"select-project"} className="block w-full px-1">
            <select
              id={"select-project"}
              value={selectedProject || ""}
              onChange={(e) => setSelectedProject(e.target.value || null)}
              className="w-full h-[50px] bg-transparent theme-text-secondary text-sm focus:outline-none cursor-pointer px-5 py-4"
            >
              <option value="">All Projects</option>
              {projects.map((project) => {
                const name = project.split("/").pop() || project;
                return (
                  <option key={project} value={project}>
                    {name}
                  </option>
                );
              })}
            </select>
          </label>
        </div>
        <SessionList
          sessions={filteredSessions}
          selectedSession={selectedSession}
          onSelectSession={handleSelectSession}
          onDeleteSession={handleDeleteSession}
          loading={loading}
        />
      </aside>

      {!sidebarCollapsed && (
        <div
          className={`w-1 cursor-col-resize shrink-0 transition-colors ${
            isResizing
              ? "bg-blue-500/50"
              : "hover:bg-blue-500/30 active:bg-blue-500/50"
          }`}
          onMouseDown={handleResizeStart}
        />
      )}

      <main className="flex-1 overflow-hidden theme-page flex flex-col">
        <div className="h-[50px] border-b theme-border flex items-center px-4 gap-4">
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-1.5 theme-surface-hover rounded transition-colors cursor-pointer"
            aria-label={
              sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
            }
          >
            <PanelLeft className="w-4 h-4 theme-text-secondary" />
          </button>
          {selectedSessionData && (
            <SessionHeader
              session={selectedSessionData}
              copied={copied}
              onCopyResumeCommand={handleCopyResumeCommand}
              onRenameSession={handleRenameSession}
            />
          )}
          <button
            onClick={toggleTheme}
            className="p-1.5 theme-surface-hover rounded transition-colors cursor-pointer ml-auto"
            aria-label={
              theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
            }
            title={theme === "dark" ? "Light mode" : "Dark mode"}
          >
            {theme === "dark" ? (
              <Sun className="w-4 h-4 theme-text-secondary" />
            ) : (
              <Moon className="w-4 h-4 theme-text-secondary" />
            )}
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          {selectedSession ? (
            <SessionView sessionId={selectedSession} />
          ) : (
            <div className="flex h-full items-center justify-center theme-text-muted">
              <div className="text-center">
                <div className="text-base mb-2 theme-text-tertiary">
                  Select a session
                </div>
                <div className="text-sm theme-text-muted">
                  Choose a session from the list to view the conversation
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
