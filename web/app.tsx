import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { Session } from "@agents-run/api";
import { PanelLeft, Copy, Check, Pencil, X, Loader2 } from "lucide-react";
import { formatTime, getCliProviderInfo } from "./utils";
import SessionList from "./components/session-list";
import SessionView from "./components/session-view";
import ProjectPicker from "./components/project-picker";
import { useEventSource } from "./hooks/use-event-source";


interface SessionHeaderProps {
  session: Session;
  copied: boolean;
  onCopyResumeCommand: (sessionId: string, projectPath: string, provider?: string) => void;
  onRenameSession?: (sessionId: string, newName: string) => Promise<boolean>;
}

function SessionHeader(props: SessionHeaderProps) {
  const { session, copied, onCopyResumeCommand, onRenameSession } = props;
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(session.display);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset edit value when session changes
  useEffect(() => {
    setEditValue(session.display);
    setIsEditing(false);
  }, [session.id, session.display]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleStartEdit = useCallback(() => {
    setEditValue(session.display);
    setIsEditing(true);
  }, [session.display]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setEditValue(session.display);
  }, [session.display]);

  const handleSave = useCallback(async () => {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === session.display) {
      setIsEditing(false);
      setEditValue(session.display);
      return;
    }

    if (!onRenameSession) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      const success = await onRenameSession(session.id, trimmed);
      if (success) {
        setIsEditing(false);
      }
    } finally {
      setIsSaving(false);
    }
  }, [editValue, session.display, session.id, onRenameSession]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSave();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      }
    },
    [handleSave, handleCancel]
  );

  return (
    <>
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {isEditing ? (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isSaving}
              className="flex-1 min-w-0 px-2 py-1 text-sm bg-zinc-900 border border-zinc-700 rounded text-zinc-100 focus:outline-none focus:border-zinc-500 disabled:opacity-50"
              placeholder="Session name"
            />
            <button
              onClick={handleSave}
              disabled={isSaving || !editValue.trim()}
              className="p-1 hover:bg-zinc-800 rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title="Save (Enter)"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 text-zinc-400 animate-spin" />
              ) : (
                <Check className="w-4 h-4 text-green-500" />
              )}
            </button>
            <button
              onClick={handleCancel}
              disabled={isSaving}
              className="p-1 hover:bg-zinc-800 rounded transition-colors cursor-pointer disabled:opacity-50"
              title="Cancel (Escape)"
            >
              <X className="w-4 h-4 text-zinc-400" />
            </button>
          </div>
        ) : (
          <>
            {(!(session as any).provider || (session as any).provider === "claude") ? (
              <button
                onClick={handleStartEdit}
                className="group flex items-center gap-2 min-w-0"
                title="Click to rename"
              >
                <span className="text-sm text-zinc-300 truncate max-w-xs group-hover:text-zinc-200">
                  {session.display}
                </span>
                <Pencil className="w-3 h-3 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            ) : (
              <span className="text-sm text-zinc-300 truncate max-w-xs">
                {session.display}
              </span>
            )}
            <span className="text-xs text-zinc-600 shrink-0">
              {session.projectName}
            </span>
            <span className="text-xs text-zinc-600 shrink-0">
              {formatTime(session.timestamp)}
            </span>
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onCopyResumeCommand(session.id, session.project, (session as any).provider)}
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
      </div>
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
  const [copied, setCopied] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [providers, setProviders] = useState<{ name: string; sessionCount: number }[]>([]);
  const [orphanSession, setOrphanSession] = useState<Session | null>(null);

  useEffect(() => {
    let attempt = 0;
    const maxRetries = 3;
    const fetchProviders = () => {
      fetch("/api/providers")
        .then((res) => res.json())
        .then(setProviders)
        .catch(() => {
          if (++attempt < maxRetries) {
            setTimeout(fetchProviders, 2000);
          }
        });
    };
    fetchProviders();
  }, []);

  const handleCopyResumeCommand = useCallback(
    (sessionId: string, projectPath: string, provider?: string) => {
      let command: string;
      switch (provider) {
        case "codex":
          command = `cd ${projectPath} && codex resume ${sessionId}`;
          break;
        case "gemini":
          command = `cd ${projectPath} && gemini resume ${sessionId}`;
          break;
        default:
          command = `cd ${projectPath} && claude --resume ${sessionId}`;
      }
      navigator.clipboard.writeText(command).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    },
    [],
  );

  const handleRenameSession = useCallback(
    async (sessionId: string, newName: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/rename`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newName }),
        });
        if (res.ok) {
          // Update local state immediately for better UX
          setSessions((prev) =>
            prev.map((s) =>
              s.id === sessionId ? { ...s, display: newName } : s
            )
          );
          return true;
        }
        console.error("Failed to rename session:", await res.text());
        return false;
      } catch (err) {
        console.error("Error renaming session:", err);
        return false;
      }
    },
    []
  );

  const selectedSessionData = useMemo(() => {
    if (!selectedSession) {
      return null;
    }

    return sessions.find((s) => s.id === selectedSession) || orphanSession || null;
  }, [sessions, selectedSession, orphanSession]);

  // Fetch orphan session data when selected session is not in the main list
  useEffect(() => {
    if (!selectedSession || sessions.find((s) => s.id === selectedSession)) {
      setOrphanSession(null);
      return;
    }
    fetch(`/api/sessions/resolve?q=${encodeURIComponent(selectedSession)}`)
      .then((res) => res.json())
      .then((data) => {
        const match = data.sessions?.find((s: Session) => s.id === selectedSession);
        setOrphanSession(match || null);
      })
      .catch(() => setOrphanSession(null));
  }, [selectedSession, sessions]);

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

  const handleSessionsRemove = useCallback((event: MessageEvent) => {
    const removedIds: string[] = JSON.parse(event.data);
    const removedSet = new Set(removedIds);
    setSessions((prev) => prev.filter((session) => !removedSet.has(session.id)));
    if (selectedSession && removedSet.has(selectedSession)) {
      setSelectedSession(null);
    }
  }, [selectedSession]);

  const handleSessionsError = useCallback(() => {
    setLoading(false);
  }, []);

  useEventSource("/api/sessions/stream", {
    events: [
      { eventName: "sessions", onMessage: handleSessionsFull },
      { eventName: "sessionsUpdate", onMessage: handleSessionsUpdate },
      { eventName: "sessionsRemove", onMessage: handleSessionsRemove },
    ],
    onError: handleSessionsError,
  });

  const sessionCountByProject = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sessions) {
      if (selectedProvider && (s as any).provider !== selectedProvider) continue;
      counts.set(s.project, (counts.get(s.project) ?? 0) + 1);
    }
    return counts;
  }, [sessions, selectedProvider]);

  const filteredSessions = useMemo(() => {
    let result = sessions;
    if (selectedProject) {
      result = result.filter((s) => s.project === selectedProject);
    }
    if (selectedProvider) {
      result = result.filter((s) => (s as any).provider === selectedProvider);
    }
    return result;
  }, [sessions, selectedProject, selectedProvider]);

  const handleSelectSession = useCallback((sessionId: string) => {
    setSelectedSession(sessionId);
  }, []);

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}`, {
          method: "DELETE",
        });
        if (res.ok) {
          setSessions((prev) => prev.filter((s) => s.id !== sessionId));
          if (selectedSession === sessionId) {
            setSelectedSession(null);
          }
        }
      } catch (err) {
        console.error("Failed to delete session:", err);
      }
    },
    [selectedSession],
  );

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100">
      {!sidebarCollapsed && (
        <aside className="w-80 border-r border-zinc-800/60 flex flex-col bg-zinc-950">
          <div className="border-b border-zinc-800/60">
            <ProjectPicker
              projects={projects}
              sessionCountByProject={sessionCountByProject}
              selectedProject={selectedProject}
              onSelectProject={setSelectedProject}
            />
            {providers.length > 1 && (
              <label htmlFor="select-provider" className="block w-full px-1">
                <select
                  id="select-provider"
                  value={selectedProvider || ""}
                  onChange={(e) => setSelectedProvider(e.target.value || null)}
                  className="w-full h-[36px] bg-transparent text-zinc-300 text-sm focus:outline-none cursor-pointer px-5 py-2"
                >
                  <option value="">All Providers</option>
                  {providers.map((p) => (
                    <option key={p.name} value={p.name}>
                      {getCliProviderInfo(p.name)?.label ?? p.name} ({p.sessionCount})
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <SessionList
            sessions={filteredSessions}
            selectedSession={selectedSession}
            onSelectSession={handleSelectSession}
            onDeleteSession={handleDeleteSession}
            loading={loading}
            selectedProvider={selectedProvider}
          />
        </aside>
      )}

      <main className="flex-1 overflow-hidden bg-zinc-950 flex flex-col">
        <div className="h-[50px] border-b border-zinc-800/60 flex items-center px-4 gap-4">
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-1.5 hover:bg-zinc-800 rounded transition-colors cursor-pointer"
            aria-label={
              sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
            }
          >
            <PanelLeft className="w-4 h-4 text-zinc-400" />
          </button>
          {selectedSessionData && (
            <SessionHeader
              session={selectedSessionData}
              copied={copied}
              onCopyResumeCommand={handleCopyResumeCommand}
              onRenameSession={handleRenameSession}
            />
          )}
        </div>
        <div className="flex-1 overflow-hidden">
          {selectedSession && selectedSessionData ? (
            <SessionView sessionId={selectedSession} session={selectedSessionData} />
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
