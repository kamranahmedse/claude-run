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
};

type ConnectionStatus = "connecting" | "live" | "reconnecting" | "offline";

interface RetryState {
  attempt: number;
  delayMs: number;
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
        className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-zinc-300 bg-zinc-800 hover:bg-zinc-700 rounded transition-colors cursor-pointer shrink-0"
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
    setSidebarCollapsed(getStoredBoolean(STORAGE_KEYS.sidebarCollapsed, false));

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

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100">
      {!sidebarCollapsed && (
        <aside className="w-80 border-r border-zinc-800/60 flex flex-col bg-zinc-950">
          <div className="border-b border-zinc-800/60">
            <label htmlFor={"select-project"} className="block w-full px-1">
              <select
                id={"select-project"}
                value={selectedProject || ""}
                onChange={(e) => setSelectedProject(e.target.value || null)}
                className="w-full h-[50px] bg-transparent text-zinc-300 text-sm focus:outline-none cursor-pointer px-5 py-4"
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
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="p-1.5 hover:bg-zinc-800 rounded transition-colors cursor-pointer"
              aria-label={
                sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
              }
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
