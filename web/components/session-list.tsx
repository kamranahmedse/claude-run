import { useState, useMemo, memo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Session } from "@claude-run/api";
import { formatTime } from "../utils";

interface SessionListProps {
  sessions: Session[];
  selectedSession: string | null;
  onSelectSession: (sessionId: string) => void;
  loading?: boolean;
}

const SessionList = memo(function SessionList(props: SessionListProps) {
  const { sessions, selectedSession, onSelectSession, loading } = props;
  const [search, setSearch] = useState("");
  const parentRef = useRef<HTMLDivElement>(null);

  const filteredSessions = useMemo(() => {
    if (!search.trim()) {
      return sessions;
    }
    const query = search.toLowerCase();
    return sessions.filter(
      (s) =>
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

  return (
    <div className="h-full overflow-hidden bg-zinc-950 flex flex-col">
      <div className="px-3 py-2 border-b border-zinc-800/60">
        <div className="flex items-center gap-2 text-zinc-500">
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
            className="flex-1 bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none"
            aria-label="Search sessions"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="text-zinc-500 hover:text-zinc-300 transition-colors rounded-sm focus-visible:ring-2 focus-visible:ring-cyan-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
              aria-label="Clear session search"
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
              className="w-5 h-5 text-zinc-600 animate-spin"
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
          <p className="py-8 text-center text-xs text-zinc-600">
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
                  className={`px-3 py-3.5 text-left transition-colors overflow-hidden border-b border-zinc-800/40 focus-visible:ring-2 focus-visible:ring-cyan-400/70 focus-visible:ring-inset ${
                    selectedSession === session.id
                      ? "bg-cyan-700/30 text-zinc-50"
                      : "hover:bg-zinc-900/60"
                  } ${virtualItem.index === 0 ? "border-t border-t-zinc-800/40" : ""}`}
                  aria-current={selectedSession === session.id ? "true" : undefined}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-zinc-400 font-medium">
                      {session.projectName}
                    </span>
                    <span
                      className="text-[10px] text-zinc-500"
                      title={new Date(session.timestamp).toLocaleString()}
                    >
                      {formatTime(session.timestamp)}
                    </span>
                  </div>
                  <p className="text-[12px] text-zinc-200 leading-snug line-clamp-2 break-words">
                    {session.display}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-zinc-800/60">
        <div className="text-[10px] text-zinc-600 text-center">
          {sessions.length} session{sessions.length !== 1 ? "s" : ""}
        </div>
      </div>
    </div>
  );
});

export default SessionList;
