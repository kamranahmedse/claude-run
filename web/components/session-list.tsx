import { useState, useMemo, memo, useRef, useEffect, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Session, SearchResult } from "@agents-run/api";
import {
  formatTime,
  getProviderInfo,
  getCliProviderInfo,
  isSessionIdMatch,
  matchesSessionSearch,
} from "../utils";

interface SessionListProps {
  sessions: Session[];
  selectedSession: string | null;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  loading?: boolean;
  selectedProvider?: string | null;
}

type SearchMode = "title" | "content";

interface SearchState {
  results: SearchResult[];
  loading: boolean;
}

const SessionList = memo(function SessionList(props: SessionListProps) {
  const { sessions, selectedSession, onSelectSession, onDeleteSession, loading: sessionsLoading, selectedProvider } = props;
  const [search, setSearch] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("title");
  const [searchState, setSearchState] = useState<SearchState>({ results: [], loading: false });
  const [orphanSessions, setOrphanSessions] = useState<Session[]>([]);
  const parentRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch orphan sessions (on disk but not in history) when title search looks like a session ID
  useEffect(() => {
    if (searchMode !== "title" || !search.trim() || !/^[0-9a-f-]{4,}$/i.test(search.trim())) {
      setOrphanSessions([]);
      return;
    }
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/sessions/resolve?q=${encodeURIComponent(search.trim())}`);
        if (res.ok) {
          const data = await res.json();
          setOrphanSessions(data.sessions);
        }
      } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(timeout);
  }, [search, searchMode]);

  // Title search filtering
  const filteredSessions = useMemo(() => {
    if (!search.trim() || searchMode === "content") {
      return sessions;
    }
    const filtered = sessions.filter((s) => matchesSessionSearch(s, search));
    const knownIds = new Set(filtered.map((s) => s.id));
    for (const orphan of orphanSessions) {
      if (!knownIds.has(orphan.id)) {
        filtered.push(orphan);
      }
    }
    return filtered;
  }, [sessions, search, searchMode, orphanSessions]);

  // Full-text search API call
  const performContentSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchState({ results: [], loading: false });
      return;
    }

    setSearchState(prev => ({ ...prev, loading: true }));

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, provider: selectedProvider ?? undefined }),
      });

      if (!response.ok) {
        throw new Error("Search failed");
      }

      const data = await response.json();
      setSearchState({ results: data.results, loading: false });
    } catch (err) {
      console.error("Search error:", err);
      setSearchState({ results: [], loading: false });
    }
  }, [selectedProvider]);

  // Debounced search effect
  useEffect(() => {
    if (searchMode === "content") {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }

      searchTimeoutRef.current = setTimeout(() => {
        performContentSearch(search);
      }, 300);
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [search, searchMode, performContentSearch]);

  // Reset search state when mode changes
  useEffect(() => {
    setSearchState({ results: [], loading: false });
  }, [searchMode]);

  const virtualizer = useVirtualizer({
    count: searchMode === "content" ? searchState.results.length : filteredSessions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => searchMode === "content" ? 100 : 76,
    overscan: 10,
    measureElement: (element) => element.getBoundingClientRect().height,
  });

  const handleClearSearch = () => {
    setSearch("");
    setSearchState({ results: [], loading: false });
  };

  const switchMode = (mode: SearchMode) => {
    setSearchMode(mode);
    setSearch("");
  };

  // Highlight matching text
  const highlightMatch = (text: string, query: string) => {
    if (!query.trim()) return text;

    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const index = lowerText.indexOf(lowerQuery);

    if (index === -1) return text;

    const before = text.slice(0, index);
    const match = text.slice(index, index + query.length);
    const after = text.slice(index + query.length);

    return (
      <>
        {before}
        <span className="bg-amber-500/30 text-amber-200">{match}</span>
        {after}
      </>
    );
  };

  const isLoading = sessionsLoading || (searchMode === "content" && searchState.loading);
  const hasResults = searchMode === "content"
    ? searchState.results.length > 0
    : filteredSessions.length > 0;
  const isSearchActive = search.trim().length > 0;

  return (
    <div className="h-full overflow-hidden bg-zinc-950 flex flex-col">
      <div className="px-3 py-2 border-b border-zinc-800/60">
        <div className="flex items-center gap-2 text-zinc-500 mb-2">
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
            placeholder={searchMode === "content" ? "Search all conversations..." : "Search sessions..."}
            className="flex-1 bg-transparent text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none"
          />
          {search && (
            <button
              onClick={handleClearSearch}
              className="text-zinc-600 hover:text-zinc-400 transition-colors"
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
        <div className="flex gap-2">
          <button
            onClick={() => switchMode("title")}
            className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
              searchMode === "title"
                ? "bg-zinc-700 text-zinc-200"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Title
          </button>
          <button
            onClick={() => switchMode("content")}
            className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
              searchMode === "content"
                ? "bg-zinc-700 text-zinc-200"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Content
          </button>
        </div>
      </div>

      <div ref={parentRef} className="flex-1 overflow-y-auto">
        {isLoading ? (
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
        ) : !hasResults ? (
          <p className="py-8 text-center text-xs text-zinc-600">
            {isSearchActive
              ? searchMode === "content"
                ? "No matches found"
                : "No sessions match"
              : "No sessions found"}
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
              if (searchMode === "content") {
                const result = searchState.results[virtualItem.index];
                return (
                  <div
                    key={result.sessionId}
                    data-index={virtualItem.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                    className={`group px-3 py-3 text-left transition-colors overflow-hidden border-b border-zinc-800/40 cursor-pointer ${
                      selectedSession === result.sessionId
                        ? "bg-cyan-700/30"
                        : "hover:bg-zinc-900/60"
                    } ${virtualItem.index === 0 ? "border-t border-t-zinc-800/40" : ""}`}
                    onClick={() => onSelectSession(result.sessionId)}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-zinc-500 font-medium flex items-center gap-1.5">
                        {result.projectName}
                        {(() => {
                          const rp = (result as any).provider;
                          const cli = rp ? getCliProviderInfo(rp) : null;
                          if (cli) {
                            return (
                              <span className={`px-1 py-px rounded text-[9px] font-medium border ${cli.color}`}>
                                {cli.label}
                              </span>
                            );
                          }
                          return null;
                        })()}
                      </span>
                      <span className="text-[10px] text-zinc-600">
                        {result.matchCount} match{result.matchCount !== 1 ? "es" : ""}
                      </span>
                    </div>
                    <p className="text-[12px] text-zinc-300 leading-snug line-clamp-1 break-words mb-1">
                      {result.display}
                    </p>
                    {isSessionIdMatch(result.sessionId, search) && (
                      <p className="text-[10px] text-zinc-600 leading-snug break-all mb-1">
                        {highlightMatch(result.sessionId, search)}
                      </p>
                    )}
                    {result.firstMatch && (
                      <p className="text-[11px] text-zinc-500 leading-snug line-clamp-2 break-words">
                        {highlightMatch(result.firstMatch.snippet, search)}
                      </p>
                    )}
                  </div>
                );
              }

              const session = filteredSessions[virtualItem.index];
              const provider = getProviderInfo(session.model);
              return (
                <div
                  key={session.id}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                  className={`group relative px-3 py-3.5 pr-10 text-left transition-colors overflow-hidden border-b border-zinc-800/40 cursor-pointer ${
                    selectedSession === session.id
                      ? "bg-cyan-700/30"
                      : "hover:bg-zinc-900/60"
                  } ${virtualItem.index === 0 ? "border-t border-t-zinc-800/40" : ""}`}
                  onClick={() => onSelectSession(session.id)}
                >
                  {onDeleteSession && session.capabilities?.delete && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm("Delete this session from history?")) {
                          onDeleteSession(session.id);
                        }
                      }}
                      className="absolute right-3 top-3 flex items-center justify-center h-5 w-5 rounded text-zinc-500 opacity-80 hover:opacity-100 hover:text-red-400 hover:bg-zinc-700/80 transition-colors"
                      title="Delete session"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                  <div className="mb-1 flex items-center">
                    <span className="text-[10px] text-zinc-500 font-medium flex items-center gap-1.5">
                      {session.projectName}
                      {(() => {
                        const sessionProvider = (session as any).provider;
                        const cli = sessionProvider && sessionProvider !== "claude"
                          ? getCliProviderInfo(sessionProvider)
                          : null;
                        if (cli) {
                          return (
                            <span className={`px-1 py-px rounded text-[9px] font-medium border ${cli.color}`}>
                              {cli.label}
                            </span>
                          );
                        }
                        if (provider) {
                          return (
                            <span className={`px-1 py-px rounded text-[9px] font-medium border ${provider.color}`}>
                              {provider.label}
                            </span>
                          );
                        }
                        // Fallback for Claude sessions without model info
                        if (sessionProvider) {
                          const fallback = getCliProviderInfo(sessionProvider);
                          if (fallback) {
                            return (
                              <span className={`px-1 py-px rounded text-[9px] font-medium border ${fallback.color}`}>
                                {fallback.label}
                              </span>
                            );
                          }
                        }
                        return null;
                      })()}
                    </span>
                  </div>
                  <p className="pr-2 text-[12px] text-zinc-300 leading-snug line-clamp-2 break-words">
                    {session.display}
                  </p>
                  {isSessionIdMatch(session.id, search) && (
                    <p className="mt-1 pr-2 text-[10px] text-zinc-600 leading-snug break-all">
                      {highlightMatch(session.id, search)}
                    </p>
                  )}
                  <div className="mt-1 flex items-center gap-1 pr-2 text-[10px] text-zinc-600">
                    <span>{formatTime(session.timestamp)}</span>
                    <span>·</span>
                    <span>{session.messageCount} msgs</span>
                    {session.model && (
                      <>
                        <span>·</span>
                        <span className="truncate">{session.model}</span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-zinc-800/60">
        <div className="text-[10px] text-zinc-600 text-center">
          {searchMode === "content" && isSearchActive
            ? `${searchState.results.length} result${searchState.results.length !== 1 ? "s" : ""}`
            : `${sessions.length} session${sessions.length !== 1 ? "s" : ""}`}
        </div>
      </div>
    </div>
  );
});

export default SessionList;
