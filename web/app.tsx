import { useState, useEffect, useCallback, useMemo } from "react";
import type { Session } from "@claude-run/api";
import { PanelLeft, Copy, Check } from "lucide-react";
import {
  formatTime,
  getSessionIdFromUrl,
  getStoredBoolean,
  getStoredString,
  setSessionIdInUrl,
  setStoredBoolean,
  setStoredString,
} from "./utils";
import SessionList from "./components/session-list";
import SessionView from "./components/session-view";
import { useEventSource } from "./hooks/use-event-source";

const STORAGE_KEYS = {
  selectedProject: "claude-run.selected-project",
  selectedSession: "claude-run.selected-session",
  sidebarCollapsed: "claude-run.sidebar-collapsed",
  uiDensity: "claude-run.ui-density",
};

type ConnectionStatus = "connecting" | "live" | "reconnecting" | "offline";
type UiDensity = "comfortable" | "compact";

interface RetryState {
  attempt: number;
  delayMs: number;
}

function escapeForPosixSingleQuotes(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function escapeForDoubleQuotes(value: string): string {
  return value.replace(/"/g, '\\"');
}

function buildResumeCommand(sessionId: string, projectPath: string): string {
  const isWindowsPath =
    /^[a-zA-Z]:[\\/]/.test(projectPath) || projectPath.includes("\\");

  if (isWindowsPath) {
    const escapedPath = escapeForDoubleQuotes(projectPath);
    return `cd "${escapedPath}"; claude --resume ${sessionId}`;
  }

  return `cd ${escapeForPosixSingleQuotes(projectPath)} && claude --resume ${sessionId}`;
}

interface SessionHeaderProps {
  session: Session;
  copied: boolean;
  onCopyResumeCommand: (sessionId: string, projectPath: string) => void;
}

function SessionHeader(props: SessionHeaderProps) {
  const { session, copied, onCopyResumeCommand } = props;

  return (
    <>
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span className="text-sm text-zinc-300 truncate max-w-xs">
          {session.display}
        </span>
        <span className="text-xs text-zinc-600 shrink-0">
          {session.projectName}
        </span>
        <span
          className="text-xs text-zinc-600 shrink-0"
          title={new Date(session.timestamp).toLocaleString()}
        >
          {formatTime(session.timestamp)}
        </span>
      </div>
      <button
        onClick={() => onCopyResumeCommand(session.id, session.project)}
        className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded transition-colors cursor-pointer shrink-0 focus-visible:ring-2 focus-visible:ring-cyan-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
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

interface ConnectionIndicatorProps {
  status: ConnectionStatus;
}

function ConnectionIndicator(props: ConnectionIndicatorProps) {
  const { status } = props;

  const stylesByStatus: Record<ConnectionStatus, string> = {
    connecting: "text-sky-300 border-sky-500/30 bg-sky-500/10",
    live: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
    reconnecting: "text-amber-300 border-amber-500/30 bg-amber-500/10",
    offline: "text-rose-300 border-rose-500/30 bg-rose-500/10",
  };

  const labelByStatus: Record<ConnectionStatus, string> = {
    connecting: "Connecting",
    live: "Live",
    reconnecting: "Reconnecting",
    offline: "Offline",
  };

  return (
    <div
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-medium ${stylesByStatus[status]}`}
      aria-live="polite"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      <span>{labelByStatus[status]}</span>
    </div>
  );
}

function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting");
  const [retryState, setRetryState] = useState<RetryState | null>(null);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [uiDensity, setUiDensity] = useState<UiDensity>("comfortable");
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const handleCopyResumeCommand = useCallback(
    async (sessionId: string, projectPath: string) => {
      const command = buildResumeCommand(sessionId, projectPath);

      try {
        await navigator.clipboard.writeText(command);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Clipboard API can fail when not served from a secure origin.
      }
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
    setSidebarCollapsed(getStoredBoolean(STORAGE_KEYS.sidebarCollapsed, false));

    const storedDensity = getStoredString(STORAGE_KEYS.uiDensity);
    if (storedDensity === "compact" || storedDensity === "comfortable") {
      setUiDensity(storedDensity);
    }

    const sessionFromUrl = getSessionIdFromUrl();
    if (sessionFromUrl) {
      setSelectedSession(sessionFromUrl);
      setPreferencesLoaded(true);
      return;
    }

    const storedProject = getStoredString(STORAGE_KEYS.selectedProject);
    const storedSession = getStoredString(STORAGE_KEYS.selectedSession);

    if (storedProject) {
      setSelectedProject(storedProject);
    }
    if (storedSession) {
      setSelectedSession(storedSession);
    }

    setPreferencesLoaded(true);
  }, []);

  useEffect(() => {
    if (!preferencesLoaded) {
      return;
    }
    setStoredString(STORAGE_KEYS.selectedProject, selectedProject);
  }, [preferencesLoaded, selectedProject]);

  useEffect(() => {
    if (!preferencesLoaded) {
      return;
    }
    setStoredString(STORAGE_KEYS.selectedSession, selectedSession);
    setSessionIdInUrl(selectedSession);
  }, [preferencesLoaded, selectedSession]);

  useEffect(() => {
    if (!preferencesLoaded) {
      return;
    }
    setStoredBoolean(STORAGE_KEYS.sidebarCollapsed, sidebarCollapsed);
  }, [preferencesLoaded, sidebarCollapsed]);

  useEffect(() => {
    if (!preferencesLoaded) {
      return;
    }
    setStoredString(STORAGE_KEYS.uiDensity, uiDensity);
  }, [preferencesLoaded, uiDensity]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 1023px)");
    const handleViewportChange = () => {
      setIsMobileViewport(mediaQuery.matches);
      if (!mediaQuery.matches) {
        setMobileSidebarOpen(false);
      }
    };

    handleViewportChange();
    mediaQuery.addEventListener("change", handleViewportChange);

    return () => {
      mediaQuery.removeEventListener("change", handleViewportChange);
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-density", uiDensity);
  }, [uiDensity]);

  useEffect(() => {
    if (!mobileSidebarOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileSidebarOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [mobileSidebarOpen]);

  useEffect(() => {
    if (!isMobileViewport) {
      document.body.style.overflow = "";
      return;
    }

    document.body.style.overflow = mobileSidebarOpen ? "hidden" : "";

    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobileViewport, mobileSidebarOpen]);

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
    setConnectionStatus("live");
    setRetryState(null);
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
    setConnectionStatus("live");
    setRetryState(null);
  }, []);

  const handleSessionsOpen = useCallback(() => {
    setConnectionStatus("connecting");
  }, []);

  const handleSessionsRetry = useCallback((attempt: number, delayMs: number) => {
    setConnectionStatus("reconnecting");
    setRetryState({ attempt, delayMs });
  }, []);

  const handleSessionsError = useCallback(() => {
    setLoading(false);
    setConnectionStatus("offline");
  }, []);

  useEventSource("/api/sessions/stream", {
    events: [
      { eventName: "sessions", onMessage: handleSessionsFull },
      { eventName: "sessionsUpdate", onMessage: handleSessionsUpdate },
    ],
    onOpen: handleSessionsOpen,
    onRetry: handleSessionsRetry,
    onError: handleSessionsError,
  });

  useEffect(() => {
    if (loading) {
      return;
    }

    if (sessions.length === 0) {
      if (selectedSession !== null) {
        setSelectedSession(null);
      }
      return;
    }

    if (selectedProject && !sessions.some((s) => s.project === selectedProject)) {
      setSelectedProject(null);
      return;
    }

    const projectScopedSessions = selectedProject
      ? sessions.filter((s) => s.project === selectedProject)
      : sessions;

    if (projectScopedSessions.length === 0) {
      if (selectedSession !== null) {
        setSelectedSession(null);
      }
      return;
    }

    if (
      selectedSession &&
      projectScopedSessions.some((s) => s.id === selectedSession)
    ) {
      return;
    }

    setSelectedSession(projectScopedSessions[0].id);
  }, [loading, sessions, selectedProject, selectedSession]);

  const filteredSessions = useMemo(() => {
    if (!selectedProject) {
      return sessions;
    }
    return sessions.filter((s) => s.project === selectedProject);
  }, [sessions, selectedProject]);

  const handleSelectSession = useCallback((sessionId: string) => {
    setSelectedSession(sessionId);
    if (isMobileViewport) {
      setMobileSidebarOpen(false);
    }
  }, [isMobileViewport]);

  const handleToggleSidebar = useCallback(() => {
    if (isMobileViewport) {
      setMobileSidebarOpen((prev) => !prev);
      return;
    }
    setSidebarCollapsed((prev) => !prev);
  }, [isMobileViewport]);

  const toggleDensity = useCallback(() => {
    setUiDensity((prev) =>
      prev === "comfortable" ? "compact" : "comfortable",
    );
  }, []);

  const connectionNotice = useMemo(() => {
    if (connectionStatus === "live") {
      return null;
    }

    if (connectionStatus === "offline") {
      return "Live updates are offline. Refresh to reconnect.";
    }

    if (connectionStatus === "reconnecting" && retryState) {
      const seconds = Math.ceil(retryState.delayMs / 1000);
      return `Reconnecting in ${seconds}s (attempt ${retryState.attempt}).`;
    }

    return "Connecting to live updates...";
  }, [connectionStatus, retryState]);

  const isSidebarVisible = isMobileViewport
    ? mobileSidebarOpen
    : !sidebarCollapsed;

  const sidebarToggleAriaLabel = isSidebarVisible
    ? "Hide sessions panel"
    : "Show sessions panel";

  return (
    <div className="relative flex h-screen bg-zinc-950 text-zinc-100">
      {isMobileViewport && mobileSidebarOpen && (
        <button
          type="button"
          onClick={() => setMobileSidebarOpen(false)}
          aria-label="Close sessions panel"
          className="fixed inset-0 z-30 bg-zinc-950/75 backdrop-blur-[1px] lg:hidden"
        />
      )}

      {isSidebarVisible && (
        <aside
          id="sessions-sidebar"
          className={`border-r border-zinc-800/60 flex flex-col bg-zinc-950 ${
            isMobileViewport
              ? "fixed inset-y-0 left-0 z-40 w-[min(85vw,20rem)] shadow-2xl"
              : "w-80 shrink-0"
          }`}
          role={isMobileViewport ? "dialog" : undefined}
          aria-modal={isMobileViewport || undefined}
          aria-label="Sessions panel"
        >
          <div className="border-b border-zinc-800/60">
            <label htmlFor={"select-project"} className="block w-full px-1">
              <select
                id={"select-project"}
                value={selectedProject || ""}
                onChange={(e) => setSelectedProject(e.target.value || null)}
                className="w-full h-[50px] bg-transparent text-zinc-200 text-sm focus:outline-none cursor-pointer px-5 py-4 rounded-sm focus-visible:ring-2 focus-visible:ring-cyan-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                aria-label="Filter sessions by project"
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
            loading={loading}
          />
        </aside>
      )}

      <main className="flex-1 overflow-hidden bg-zinc-950 flex flex-col">
        <div className="border-b border-zinc-800/60">
          <div className="h-[50px] flex items-center px-4 gap-4">
            <button
              onClick={handleToggleSidebar}
              className="p-1.5 hover:bg-zinc-800 rounded transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-cyan-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
              aria-label={sidebarToggleAriaLabel}
              aria-controls="sessions-sidebar"
              aria-expanded={isSidebarVisible}
            >
              <PanelLeft className="w-4 h-4 text-zinc-400" />
            </button>
            {selectedSessionData ? (
              <SessionHeader
                session={selectedSessionData}
                copied={copied}
                onCopyResumeCommand={handleCopyResumeCommand}
              />
            ) : (
              <div className="flex-1 min-w-0 text-sm text-zinc-600">
                No session selected
              </div>
            )}
            <button
              type="button"
              onClick={toggleDensity}
              className="hidden sm:inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-700/70 bg-zinc-900/70 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-cyan-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
              aria-label={`Switch to ${
                uiDensity === "comfortable" ? "compact" : "comfortable"
              } density`}
              title={`Density: ${uiDensity}`}
            >
              <span className="font-medium">
                {uiDensity === "comfortable" ? "A-" : "A+"}
              </span>
              <span className="text-zinc-500">
                {uiDensity === "comfortable" ? "Comfort" : "Compact"}
              </span>
            </button>
            <ConnectionIndicator status={connectionStatus} />
          </div>
          {connectionNotice && (
            <div className="px-4 py-1.5 text-[11px] text-amber-300/90 bg-amber-500/5 border-t border-zinc-800/50">
              {connectionNotice}
            </div>
          )}
        </div>
        <div className="flex-1 overflow-hidden">
          {selectedSession ? (
            <SessionView sessionId={selectedSession} />
          ) : (
            <div className="flex h-full items-center justify-center text-zinc-600">
              <div className="text-center">
                <div className="text-base mb-2 text-zinc-500">
                  Select a session
                </div>
                <div className="text-sm text-zinc-600">
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
