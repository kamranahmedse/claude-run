import { memo, useCallback, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Session } from "@claude-run/api";
import { formatTime } from "../utils";

type RecencyFilter = "all" | "today" | "week";
type SortMode = "newest" | "oldest";

type SessionRow = {
  type: "session";
  id: string;
  session: Session;
};

type GroupRow = {
  type: "group";
  id: string;
  label: string;
};

type ListRow = SessionRow | GroupRow;

interface SessionListProps {
  sessions: Session[];
  selectedSession: string | null;
  onSelectSession: (sessionId: string) => void;
  loading?: boolean;
}

const RECENCY_FILTER_OPTIONS: Array<{ value: RecencyFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
];

const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
];

function startOfDay(input: Date): Date {
  const date = new Date(input);
  date.setHours(0, 0, 0, 0);
  return date;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightMatches(text: string, query: string) {
  const trimmed = query.trim();
  if (!trimmed) {
    return text;
  }

  const regex = new RegExp(`(${escapeRegex(trimmed)})`, "ig");
  const parts = text.split(regex);

  return parts.map((part, index) => {
    const isMatch = part.toLowerCase() === trimmed.toLowerCase();
    if (!isMatch) {
      return <span key={index}>{part}</span>;
    }

    return (
      <mark
        key={index}
        className="rounded-sm bg-cyan-500/30 px-0.5 text-cyan-100"
      >
        {part}
      </mark>
    );
  });
}

function getRecencyLabel(timestamp: number, now: Date): string {
  const dayStart = startOfDay(now);
  const yesterdayStart = new Date(dayStart);
  yesterdayStart.setDate(dayStart.getDate() - 1);
  const weekStart = new Date(dayStart);
  weekStart.setDate(dayStart.getDate() - 6);
  const value = new Date(timestamp);

  if (value >= dayStart) {
    return "Today";
  }

  if (value >= yesterdayStart) {
    return "Yesterday";
  }

  if (value >= weekStart) {
    return "This Week";
  }

  return "Older";
}

const SessionList = memo(function SessionList(props: SessionListProps) {
  const { sessions, selectedSession, onSelectSession, loading } = props;
  const [search, setSearch] = useState("");
  const [recencyFilter, setRecencyFilter] = useState<RecencyFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const parentRef = useRef<HTMLDivElement>(null);

  const filteredSessions = useMemo(() => {
    const query = search.trim().toLowerCase();
    const now = new Date();
    const todayStart = startOfDay(now);
    const weekStart = new Date(todayStart);
    weekStart.setDate(todayStart.getDate() - 6);

    const recencyFiltered = sessions.filter((session) => {
      if (recencyFilter === "all") {
        return true;
      }

      const value = new Date(session.timestamp);
      if (recencyFilter === "today") {
        return value >= todayStart;
      }

      return value >= weekStart;
    });

    const searched = recencyFiltered.filter((session) => {
      if (!query) {
        return true;
      }

      return (
        session.display.toLowerCase().includes(query) ||
        session.projectName.toLowerCase().includes(query)
      );
    });

    const sorted = [...searched].sort((a, b) => {
      if (sortMode === "oldest") {
        return a.timestamp - b.timestamp;
      }
      return b.timestamp - a.timestamp;
    });

    return sorted;
  }, [sessions, search, recencyFilter, sortMode]);

  const rows = useMemo<ListRow[]>(() => {
    const list: ListRow[] = [];
    let groupCounter = 0;
    let lastGroupLabel = "";
    const now = new Date();

    for (const session of filteredSessions) {
      const label = getRecencyLabel(session.timestamp, now);
      if (label !== lastGroupLabel) {
        list.push({
          type: "group",
          id: `group-${label.toLowerCase().replace(/\s+/g, "-")}-${groupCounter}`,
          label,
        });
        groupCounter += 1;
        lastGroupLabel = label;
      }

      list.push({
        type: "session",
        id: session.id,
        session,
      });
    }

    return list;
  }, [filteredSessions]);

  const rowIndexBySessionId = useMemo(() => {
    const indexMap = new Map<string, number>();
    rows.forEach((row, index) => {
      if (row.type === "session") {
        indexMap.set(row.session.id, index);
      }
    });
    return indexMap;
  }, [rows]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (rows[index]?.type === "group" ? 30 : 76),
    overscan: 10,
    measureElement: (element) => element.getBoundingClientRect().height,
  });

  const moveSelection = useCallback(
    (targetIndex: number) => {
      const boundedIndex = Math.max(0, Math.min(targetIndex, filteredSessions.length - 1));
      const targetSession = filteredSessions[boundedIndex];
      if (!targetSession) {
        return;
      }

      onSelectSession(targetSession.id);
      const rowIndex = rowIndexBySessionId.get(targetSession.id);
      if (rowIndex !== undefined) {
        virtualizer.scrollToIndex(rowIndex, { align: "center" });
      }
    },
    [filteredSessions, onSelectSession, rowIndexBySessionId, virtualizer],
  );

  const handleListKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }

      if (filteredSessions.length === 0) {
        return;
      }

      const selectedIndex = selectedSession
        ? filteredSessions.findIndex((session) => session.id === selectedSession)
        : -1;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveSelection(selectedIndex + 1);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        if (selectedIndex <= 0) {
          moveSelection(filteredSessions.length - 1);
          return;
        }
        moveSelection(selectedIndex - 1);
        return;
      }

      if (event.key === "Enter" && selectedIndex >= 0) {
        event.preventDefault();
        moveSelection(selectedIndex);
      }
    },
    [filteredSessions, selectedSession, moveSelection],
  );

  const emptyMessage = useMemo(() => {
    if (search.trim()) {
      return "No sessions match the current search.";
    }

    if (recencyFilter === "today") {
      return "No sessions from today.";
    }

    if (recencyFilter === "week") {
      return "No sessions from this week.";
    }

    return "No sessions found.";
  }, [search, recencyFilter]);

  return (
    <div
      className="h-full overflow-hidden bg-zinc-950 flex flex-col"
      onKeyDown={handleListKeyDown}
    >
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
            onChange={(event) => setSearch(event.target.value)}
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

        <div className="mt-2 flex items-center gap-2">
          <div
            className="inline-flex rounded-md border border-zinc-700/70 overflow-hidden"
            role="group"
            aria-label="Session recency filter"
          >
            {RECENCY_FILTER_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setRecencyFilter(option.value)}
                className={`px-2 py-1 text-[11px] transition-colors ${
                  recencyFilter === option.value
                    ? "bg-cyan-600/35 text-cyan-50"
                    : "bg-zinc-900/80 text-zinc-300 hover:bg-zinc-800"
                }`}
                aria-pressed={recencyFilter === option.value}
              >
                {option.label}
              </button>
            ))}
          </div>

          <label className="ml-auto flex items-center gap-1 text-[11px] text-zinc-500">
            <span>Sort</span>
            <select
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as SortMode)}
              className="rounded-md border border-zinc-700/70 bg-zinc-900/80 px-1.5 py-1 text-[11px] text-zinc-200"
              aria-label="Sort sessions"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
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
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-xs text-zinc-500">{emptyMessage}</p>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const row = rows[virtualItem.index];
              if (!row) {
                return null;
              }

              if (row.type === "group") {
                return (
                  <div
                    key={row.id}
                    data-index={virtualItem.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                    className="px-3 py-1.5 border-b border-zinc-800/40 bg-zinc-950/95 text-[10px] font-semibold uppercase tracking-wide text-zinc-500"
                  >
                    {row.label}
                  </div>
                );
              }

              const session = row.session;

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
                  }`}
                  aria-current={selectedSession === session.id ? "true" : undefined}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-zinc-400 font-medium">
                      {highlightMatches(session.projectName, search)}
                    </span>
                    <span
                      className="text-[10px] text-zinc-500"
                      title={new Date(session.timestamp).toLocaleString()}
                    >
                      {formatTime(session.timestamp)}
                    </span>
                  </div>
                  <p className="text-[12px] text-zinc-200 leading-snug line-clamp-2 break-words">
                    {highlightMatches(session.display, search)}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-zinc-800/60">
        <div className="text-[10px] text-zinc-500 text-center">
          {filteredSessions.length} shown / {sessions.length} session
          {sessions.length !== 1 ? "s" : ""}
        </div>
        <div className="mt-1 text-[10px] text-zinc-600 text-center">
          Keyboard: ↑ ↓ to move, Enter to open
        </div>
      </div>
    </div>
  );
});

export default SessionList;
