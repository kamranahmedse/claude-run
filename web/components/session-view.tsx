import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import type { ConversationMessage, ContentBlock } from "@claude-run/api";
import MessageBlock from "./message-block";
import ScrollToBottomButton from "./scroll-to-bottom-button";

const MAX_RETRIES = 10;
const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30000;
const SCROLL_THRESHOLD_PX = 100;

interface SessionViewProps {
  sessionId: string;
}

function extractBlockText(block: ContentBlock): string {
  if (block.type === "text" && block.text) {
    return block.text;
  }

  if (block.type === "thinking" && block.thinking) {
    return block.thinking;
  }

  if (block.type === "tool_use") {
    const name = block.name || "tool";
    const input =
      block.input && typeof block.input === "object"
        ? JSON.stringify(block.input)
        : "";
    return `${name} ${input}`;
  }

  if (block.type === "tool_result") {
    if (typeof block.content === "string") {
      return block.content;
    }
    return JSON.stringify(block.content);
  }

  return "";
}

function extractMessageText(message: ConversationMessage): string {
  const content = message.message?.content;
  if (!content) {
    return "";
  }

  if (typeof content === "string") {
    return content;
  }

  return content.map((block) => extractBlockText(block)).join("\n");
}

function SessionView(props: SessionViewProps) {
  const { sessionId } = props;

  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [findQuery, setFindQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastMessageRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef(new Map<number, HTMLDivElement>());
  const offsetRef = useRef(0);
  const isScrollingProgrammaticallyRef = useRef(false);
  const retryCountRef = useRef(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) {
      return;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource(
      `/api/conversation/${sessionId}/stream?offset=${offsetRef.current}`
    );
    eventSourceRef.current = eventSource;

    eventSource.addEventListener("messages", (event) => {
      retryCountRef.current = 0;
      const newMessages: ConversationMessage[] = JSON.parse(event.data);
      setLoading(false);
      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.uuid).filter(Boolean));
        const unique = newMessages.filter((m) => !existingIds.has(m.uuid));
        if (unique.length === 0) {
          return prev;
        }
        offsetRef.current += unique.length;
        return [...prev, ...unique];
      });
    });

    eventSource.onerror = () => {
      eventSource.close();
      setLoading(false);

      if (!mountedRef.current) {
        return;
      }

      if (retryCountRef.current < MAX_RETRIES) {
        const delay = Math.min(BASE_RETRY_DELAY_MS * Math.pow(2, retryCountRef.current), MAX_RETRY_DELAY_MS);
        retryCountRef.current++;
        retryTimeoutRef.current = setTimeout(() => connect(), delay);
      }
    };
  }, [sessionId]);

  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    setMessages([]);
    setFindQuery("");
    setActiveMatchIndex(0);
    offsetRef.current = 0;
    retryCountRef.current = 0;

    connect();

    return () => {
      mountedRef.current = false;
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [connect]);

  const scrollToBottom = useCallback(() => {
    if (!lastMessageRef.current) {
      return;
    }
    isScrollingProgrammaticallyRef.current = true;
    lastMessageRef.current.scrollIntoView({ behavior: "instant", block: "end" });
    requestAnimationFrame(() => {
      isScrollingProgrammaticallyRef.current = false;
    });
  }, []);

  useEffect(() => {
    if (autoScroll) {
      scrollToBottom();
    }
  }, [messages, autoScroll, scrollToBottom]);

  const handleScroll = () => {
    if (!containerRef.current || isScrollingProgrammaticallyRef.current) {
      return;
    }

    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < SCROLL_THRESHOLD_PX;
    setAutoScroll(isAtBottom);
  };

  const summary = messages.find((m) => m.type === "summary");
  const conversationMessages = messages.filter(
    (m) => m.type === "user" || m.type === "assistant"
  );
  const normalizedFindQuery = findQuery.trim().toLowerCase();
  const matchingMessageIndexes = useMemo(() => {
    if (!normalizedFindQuery) {
      return [];
    }

    const matches: number[] = [];
    conversationMessages.forEach((message, index) => {
      const haystack = extractMessageText(message).toLowerCase();
      if (haystack.includes(normalizedFindQuery)) {
        matches.push(index);
      }
    });
    return matches;
  }, [conversationMessages, normalizedFindQuery]);

  const matchPositionByMessageIndex = useMemo(() => {
    const positions = new Map<number, number>();
    matchingMessageIndexes.forEach((messageIndex, position) => {
      positions.set(messageIndex, position);
    });
    return positions;
  }, [matchingMessageIndexes]);

  useEffect(() => {
    if (matchingMessageIndexes.length === 0) {
      setActiveMatchIndex(0);
      return;
    }

    setActiveMatchIndex((prev) => Math.min(prev, matchingMessageIndexes.length - 1));
  }, [matchingMessageIndexes]);

  useEffect(() => {
    if (!normalizedFindQuery || matchingMessageIndexes.length === 0) {
      return;
    }

    const messageIndex = matchingMessageIndexes[activeMatchIndex];
    const node = messageRefs.current.get(messageIndex);
    if (!node) {
      return;
    }

    isScrollingProgrammaticallyRef.current = true;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    requestAnimationFrame(() => {
      isScrollingProgrammaticallyRef.current = false;
    });
  }, [normalizedFindQuery, matchingMessageIndexes, activeMatchIndex]);

  const navigateToMatch = useCallback(
    (direction: -1 | 1) => {
      if (matchingMessageIndexes.length === 0) {
        return;
      }
      setAutoScroll(false);
      setActiveMatchIndex((prev) => {
        if (direction === 1) {
          return (prev + 1) % matchingMessageIndexes.length;
        }
        return (prev - 1 + matchingMessageIndexes.length) % matchingMessageIndexes.length;
      });
    },
    [matchingMessageIndexes.length],
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">
        Loading...
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto bg-zinc-950"
      >
        <div className="mx-auto max-w-3xl px-4 py-4">
          <div className="mb-4 rounded-lg border border-zinc-800/70 bg-zinc-900/50 p-2.5">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={findQuery}
                onChange={(event) => {
                  const value = event.target.value;
                  setFindQuery(value);
                  setActiveMatchIndex(0);
                  if (value.trim()) {
                    setAutoScroll(false);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    navigateToMatch(event.shiftKey ? -1 : 1);
                  }
                }}
                className="flex-1 rounded-md border border-zinc-700/70 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus-visible:ring-2 focus-visible:ring-cyan-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                placeholder="Find in conversation..."
                aria-label="Find in conversation"
              />

              {findQuery.trim() && (
                <button
                  type="button"
                  onClick={() => {
                    setFindQuery("");
                    setActiveMatchIndex(0);
                    setAutoScroll(true);
                  }}
                  className="rounded-md border border-zinc-700/70 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-cyan-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                  aria-label="Clear find query"
                >
                  Clear
                </button>
              )}

              <span className="text-[11px] text-zinc-500 min-w-[62px] text-right">
                {matchingMessageIndexes.length > 0
                  ? `${activeMatchIndex + 1} / ${matchingMessageIndexes.length}`
                  : "0 matches"}
              </span>

              <button
                type="button"
                onClick={() => navigateToMatch(-1)}
                disabled={matchingMessageIndexes.length === 0}
                className="rounded-md border border-zinc-700/70 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 enabled:hover:bg-zinc-800 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-cyan-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                aria-label="Previous match"
              >
                Prev
              </button>

              <button
                type="button"
                onClick={() => navigateToMatch(1)}
                disabled={matchingMessageIndexes.length === 0}
                className="rounded-md border border-zinc-700/70 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 enabled:hover:bg-zinc-800 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-cyan-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                aria-label="Next match"
              >
                Next
              </button>
            </div>
          </div>

          {summary && (
            <div className="mb-6 rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-4">
              <h2 className="text-sm font-medium text-zinc-200 leading-relaxed">
                {summary.summary}
              </h2>
              <p className="mt-2 text-[11px] text-zinc-500">
                {conversationMessages.length} messages
              </p>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {conversationMessages.map((message, index) => {
              const matchPosition = matchPositionByMessageIndex.get(index);
              const isMatched = matchPosition !== undefined;
              const isActiveMatch =
                isMatched &&
                matchPosition === activeMatchIndex &&
                normalizedFindQuery.length > 0;

              return (
                <div
                  key={message.uuid || index}
                  ref={(element) => {
                    if (index === conversationMessages.length - 1) {
                      lastMessageRef.current = element;
                    }

                    if (element) {
                      messageRefs.current.set(index, element);
                    } else {
                      messageRefs.current.delete(index);
                    }
                  }}
                  className={`rounded-xl transition-shadow ${
                    isActiveMatch
                      ? "ring-1 ring-cyan-400/70 shadow-[0_0_0_1px_rgba(34,211,238,0.35)]"
                      : isMatched
                        ? "ring-1 ring-cyan-600/40"
                        : ""
                  }`}
                >
                  <MessageBlock message={message} />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {!autoScroll && (
        <ScrollToBottomButton
          onClick={() => {
            setAutoScroll(true);
            scrollToBottom();
          }}
        />
      )}
    </div>
  );
}

export default SessionView;
