import { useState, useCallback } from "react";
import type { ConversationMessage } from "@agents-run/api";
import { Bot, Play, Pause, ArrowRight, RefreshCw, ChevronDown, ChevronRight, MessageSquareText } from "lucide-react";
import MessageBlock from "../message-block";

interface TaskInput {
  description: string;
  prompt: string;
  subagent_type: string;
  model?: string;
  run_in_background?: boolean;
  resume?: string;
}

interface TaskRendererProps {
  input: TaskInput;
  sessionId?: string;
  agentId?: string;
}

function getAgentColor(agentType: string): string {
  const type = agentType.toLowerCase();
  if (type === "explore") {
    return "text-cyan-400";
  }
  if (type === "plan") {
    return "text-violet-400";
  }
  if (type === "claude-code-guide") {
    return "text-amber-400";
  }
  if (type === "general-purpose") {
    return "text-emerald-400";
  }
  return "text-blue-400";
}

function getAgentBgColor(agentType: string): string {
  const type = agentType.toLowerCase();
  if (type === "explore") {
    return "bg-cyan-500/10 border-cyan-500/20";
  }
  if (type === "plan") {
    return "bg-violet-500/10 border-violet-500/20";
  }
  if (type === "claude-code-guide") {
    return "bg-amber-500/10 border-amber-500/20";
  }
  if (type === "general-purpose") {
    return "bg-emerald-500/10 border-emerald-500/20";
  }
  return "bg-blue-500/10 border-blue-500/20";
}

function getAgentBorderColor(agentType: string): string {
  const type = agentType.toLowerCase();
  if (type === "explore") return "border-cyan-500/30";
  if (type === "plan") return "border-violet-500/30";
  if (type === "claude-code-guide") return "border-amber-500/30";
  if (type === "general-purpose") return "border-emerald-500/30";
  return "border-blue-500/30";
}

export function TaskRenderer(props: TaskRendererProps) {
  const { input, sessionId, agentId } = props;
  const [showConversation, setShowConversation] = useState(false);
  const [subMessages, setSubMessages] = useState<ConversationMessage[] | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const toggleConversation = useCallback(() => {
    if (!sessionId || !agentId) return;

    if (showConversation) {
      setShowConversation(false);
      return;
    }

    if (subMessages !== null) {
      setShowConversation(true);
      return;
    }

    setLoadingMessages(true);
    setShowConversation(true);

    fetch(`/api/conversation/${sessionId}/subagent/${agentId}`)
      .then((r) => r.json())
      .then((messages: ConversationMessage[]) => {
        setSubMessages(messages);
        setLoadingMessages(false);
      })
      .catch(() => {
        setSubMessages([]);
        setLoadingMessages(false);
      });
  }, [sessionId, agentId, showConversation, subMessages]);

  if (!input) {
    return null;
  }

  const agentColor = getAgentColor(input.subagent_type);
  const agentBgColor = getAgentBgColor(input.subagent_type);
  const agentBorderColor = getAgentBorderColor(input.subagent_type);
  const hasSubagent = !!(sessionId && agentId);

  return (
    <div className="w-full mt-2">
      <div className="bg-zinc-900/70 border border-zinc-700/50 rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-700/50 bg-zinc-800/30">
          <Bot size={14} className={agentColor} />
          <span className={`text-xs font-medium ${agentColor}`}>
            {input.subagent_type}
          </span>
          {input.description && (
            <>
              <ArrowRight size={10} className="text-zinc-600" />
              <span className="text-xs text-zinc-400">{input.description}</span>
            </>
          )}
          <div className="flex items-center gap-1.5 ml-auto">
            {input.resume && (
              <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500 bg-zinc-700/50 px-1.5 py-0.5 rounded">
                <RefreshCw size={10} />
                resume
              </span>
            )}
            {input.run_in_background && (
              <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500 bg-zinc-700/50 px-1.5 py-0.5 rounded">
                <Pause size={10} />
                background
              </span>
            )}
            {input.model && (
              <span className="text-[10px] text-zinc-500 bg-zinc-700/50 px-1.5 py-0.5 rounded">
                {input.model}
              </span>
            )}
          </div>
        </div>
        <div className="p-3">
          <div
            className={`flex items-start gap-2 px-3 py-2 rounded-lg border ${agentBgColor}`}
          >
            <Play size={12} className={`${agentColor} mt-0.5 flex-shrink-0`} />
            <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap">
              {input.prompt}
            </p>
          </div>
        </div>

        {hasSubagent && (
          <div className="border-t border-zinc-700/50">
            <button
              onClick={toggleConversation}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/30 transition-colors"
            >
              {showConversation ? (
                <ChevronDown size={12} />
              ) : (
                <ChevronRight size={12} />
              )}
              <MessageSquareText size={12} className={agentColor} />
              <span>
                {showConversation ? "Hide" : "View"} sub-agent conversation
              </span>
              {subMessages !== null && (
                <span className="text-[10px] text-zinc-600 ml-1">
                  ({subMessages.filter((m) => m.type === "user" || m.type === "assistant").length} messages)
                </span>
              )}
            </button>

            {showConversation && (
              <div className={`border-l-2 ${agentBorderColor} ml-3 mr-3 mb-3`}>
                {loadingMessages ? (
                  <div className="px-4 py-3 text-xs text-zinc-500">
                    Loading conversation...
                  </div>
                ) : subMessages && subMessages.length > 0 ? (
                  <div className="flex flex-col gap-1.5 pl-3 pt-2">
                    {subMessages
                      .filter((m) => m.type === "user" || m.type === "assistant")
                      .map((msg, index) => (
                        <MessageBlock key={msg.uuid || index} message={msg} />
                      ))}
                  </div>
                ) : (
                  <div className="px-4 py-3 text-xs text-zinc-500">
                    No conversation data available
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
