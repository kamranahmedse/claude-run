import { useState, useMemo, memo, useRef, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Session } from "@claude-run/api";
import { formatTimeAbsolute } from "../utils";
import { Trash2, Check, X } from "lucide-react";

interface SessionListProps {
  sessions: Session[];
  selectedSession: string | null;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  loading?: boolean;
}

const SessionList = memo(function SessionList(props: SessionListProps) {
  const { sessions, selectedSession, onSelectSession, onDeleteSession, loading } = props;
  const [search, setSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  const filteredSessions = useMemo(() => {
    if (!search.trim()) {
      return sessions;
    }
    const query = search.toLowerCase();
    return sessions.filter(
      (s) =>
        s.id.toLowerCase().includes(query) ||
        s.display.toLowerCase().includes(query) ||
        s.projectName.toLowerCase().includes(query)
    );
  }, [sessions, search]);

  const virtualizer = useVirtualizer({
    count: filteredSessions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 76,
    overscan: 10,
    measureElement: (element) => element.getBoundingClientRect().height,
  });

  const handleDelete = useCallback((sessionId: string) => {
    fetch(`/api/sessions/${sessionId}`, { method: "DELETE" })
      .then((res) => res.json())
      .then(() => {
        setConfirmDelete(null);
        onDeleteSession(sessionId);
      })
      .catch(console.error);
  }, [onDeleteSession]);

  return (
    <div className="h-full overflow-hidden theme-page flex flex-col">
      <div className="px-3 py-2 border-b theme-border">
        <div className="flex items-center gap-2 theme-text-muted">
          <svg
            className="w-4 h-4 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="flex-1 bg-transparent text-sm theme-text-primary placeholder:text-[var(--text-muted)] focus:outline-none"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="theme-text-muted hover:theme-text-secondary transition-colors"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div ref={parentRef} className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <svg
              className="w-5 h-5 theme-text-muted animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          </div>
        ) : filteredSessions.length === 0 ? (
          <p className="py-8 text-center text-xs theme-text-muted">
            {search ? "No sessions match" : "No sessions found"}
          </p>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const session = filteredSessions[virtualItem.index];
              return (
                <button
                  key={session.id}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  onClick={() => onSelectSession(session.id)}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                  className={`group px-3 py-3.5 text-left transition-colors overflow-hidden border-b theme-border-subtle ${
                    selectedSession === session.id
                      ? "theme-selected"
                      : "hover:theme-surface-hover"
                  } ${virtualItem.index === 0 ? "border-t theme-border-subtle" : ""}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] theme-text-tertiary font-medium">
                      {session.projectName}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[11px] theme-text-muted">
                        {formatTimeAbsolute(session.timestamp)}
                      </span>
                      {confirmDelete === session.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(session.id);
                            }}
                            className="p-0.5 rounded hover:bg-red-500/20 text-red-400 transition-colors cursor-pointer"
                            title="确认删除"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDelete(null);
                            }}
                            className="p-0.5 rounded hover:bg-white/10 theme-text-muted transition-colors cursor-pointer"
                            title="取消"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDelete(session.id);
                          }}
                          className="p-0.5 rounded hover:bg-red-500/20 theme-text-muted hover:text-red-400 transition-colors cursor-pointer"
                          title="删除此对话"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-[13px] theme-text-secondary leading-snug line-clamp-2 break-words">
                    {session.display}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t theme-border">
        <div className="text-[11px] theme-text-muted text-center">
          {sessions.length} session{sessions.length !== 1 ? "s" : ""}
        </div>
      </div>
    </div>
  );
});

export default SessionList;
