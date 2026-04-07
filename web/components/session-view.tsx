import { useEffect, useState, useRef, useCallback } from "react";
import type { ConversationMessage, Session, SubagentInfo, SessionTokenUsage, SessionMeta, SessionCosts } from "@agents-run/api";
import MessageBlock from "./message-block";
import ScrollToBottomButton from "./scroll-to-bottom-button";
import { MarkdownExportButton } from "./markdown-export";

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

function effectiveRate(cost: number, count: number): string {
  if (count <= 0) return "$0";
  return "$" + ((cost / count) * 1_000_000).toFixed(2);
}

function TokenUsageBar({ usage, costs }: { usage: SessionTokenUsage; costs: SessionCosts }) {
  const items = [
    { label: "Base Input", count: usage.input_tokens, cost: costs.input },
    { label: "5m Cache Write", count: usage.cache_write_5m_tokens, cost: costs.cache_write_5m },
    { label: "1h Cache Write", count: usage.cache_write_1h_tokens, cost: costs.cache_write_1h },
    { label: "Cache Read", count: usage.cache_read_tokens, cost: costs.cache_read },
    { label: "Output", count: usage.output_tokens, cost: costs.output },
  ];

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Token Usage</h3>
        <span className="text-sm font-medium text-amber-400">${costs.total.toFixed(4)}</span>
      </div>
      <div className="grid grid-cols-5 gap-3">
        {items.map(({ label, count, cost }) => (
          <div key={label} className="text-center">
            <div className="text-[11px] text-zinc-500 mb-1">{label}</div>
            <div className="text-sm text-zinc-200 font-mono">{formatTokenCount(count)}</div>
            <div className="text-[11px] text-zinc-500 mt-0.5">
              ${cost.toFixed(4)}
            </div>
            <div className="text-[10px] text-zinc-600">{effectiveRate(cost, count)}/MTok</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GenericTokenUsageBar({ usage, costs }: { usage: SessionTokenUsage; costs: SessionCosts }) {
  const items = [
    { label: "Input", count: usage.input_tokens, cost: costs.input },
    { label: "Cache Read", count: usage.cache_read_tokens, cost: costs.cache_read },
    { label: "Output", count: usage.output_tokens, cost: costs.output },
  ].filter(item => item.count > 0);

  if (items.length === 0) return null;

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Token Usage</h3>
        <span className="text-sm font-medium text-amber-400">${costs.total.toFixed(4)}</span>
      </div>
      <div className="flex justify-center gap-8">
        {items.map(({ label, count, cost }) => (
          <div key={label} className="text-center">
            <div className="text-[11px] text-zinc-500 mb-1">{label}</div>
            <div className="text-sm text-zinc-200 font-mono">{formatTokenCount(count)}</div>
            <div className="text-[11px] text-zinc-500 mt-0.5">${cost.toFixed(4)}</div>
            <div className="text-[10px] text-zinc-600">{effectiveRate(cost, count)}/MTok</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function hasNonZeroUsage(usage: SessionTokenUsage): boolean {
  return usage.input_tokens > 0 || usage.output_tokens > 0 || usage.cache_read_tokens > 0;
}

const MAX_RETRIES = 10;
const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30000;
const SCROLL_THRESHOLD_PX = 100;

interface SessionViewProps {
  sessionId: string;
  session: Session;
}

function SessionView(props: SessionViewProps) {
  const { sessionId, session } = props;

  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [subagentMap, setSubagentMap] = useState<Map<string, string>>(new Map());
  const [tokenUsage, setTokenUsage] = useState<SessionTokenUsage | null>(null);
  const [sessionCosts, setSessionCosts] = useState<SessionCosts | null>(null);
  const [metaModel, setMetaModel] = useState<string | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastMessageRef = useRef<HTMLDivElement>(null);
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
      const payload = JSON.parse(event.data);
      const newMessages: ConversationMessage[] = payload.messages;
      const nextOffset: number = payload.nextOffset;
      setLoading(false);
      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.uuid).filter(Boolean));
        const unique = newMessages.filter((m) => !existingIds.has(m.uuid));
        if (unique.length === 0) {
          return prev;
        }
        offsetRef.current = nextOffset;
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
    setSubagentMap(new Map());
    setTokenUsage(null);
    setSessionCosts(null);
    setMetaModel(undefined);
    offsetRef.current = 0;
    retryCountRef.current = 0;

    fetch(`/api/conversation/${sessionId}/meta`)
      .then((r) => r.json())
      .then((data: SessionMeta) => {
        if (!mountedRef.current) return;
        setTokenUsage(data.usage);
        setSessionCosts(data.costs);
        setMetaModel(data.model);
        const map = new Map<string, string>();
        for (const info of data.subagents) {
          map.set(info.toolUseId, info.agentId);
        }
        setSubagentMap(map);
      })
      .catch(() => {});

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
          <div className="flex items-center justify-between mb-4">
            {summary ? (
              <div className="flex-1 rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-4">
                <h2 className="text-sm font-medium text-zinc-200 leading-relaxed">
                  {summary.summary}
                </h2>
                <p className="mt-2 text-[11px] text-zinc-500">
                  {conversationMessages.length} messages
                </p>
              </div>
            ) : (
              <div className="flex-1" />
            )}
            <div className="ml-4">
              <MarkdownExportButton session={session} messages={messages} />
            </div>
          </div>
          {tokenUsage && hasNonZeroUsage(tokenUsage) && sessionCosts && (() => {
            const provider = session.provider || "claude";
            if (provider === "claude") {
              return (
                <div className="mb-6">
                  <TokenUsageBar usage={tokenUsage} costs={sessionCosts} />
                </div>
              );
            }
            return (
              <div className="mb-6">
                <GenericTokenUsageBar usage={tokenUsage} costs={sessionCosts} />
              </div>
            );
          })()}

          <div className="flex flex-col gap-2">
            {conversationMessages.map((message, index) => (
              <div
                key={message.uuid || index}
                ref={
                  index === conversationMessages.length - 1
                    ? lastMessageRef
                    : undefined
                }
              >
                <MessageBlock message={message} sessionId={sessionId} subagentMap={subagentMap} />
              </div>
            ))}
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
