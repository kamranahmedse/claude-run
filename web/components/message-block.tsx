import { useState, memo } from "react";
import type { ConversationMessage, ContentBlock } from "@agents-run/api";
import {
  Lightbulb,
  Wrench,
  Check,
  X,
  Terminal,
  Search,
  Pencil,
  FolderOpen,
  Globe,
  MessageSquare,
  ListTodo,
  FilePlus2,
  FileCode,
  GitBranch,
  Database,
  HardDrive,
  Bot,
} from "lucide-react";
import { sanitizeText, getProviderInfo } from "../utils";
import { MarkdownRenderer } from "./markdown-renderer";
import {
  TodoRenderer,
  EditRenderer,
  WriteRenderer,
  BashRenderer,
  BashResultRenderer,
  GrepRenderer,
  GlobRenderer,
  SearchResultRenderer,
  ReadRenderer,
  FileContentRenderer,
  AskQuestionRenderer,
  TaskRenderer,
} from "./tool-renderers";

interface MessageBlockProps {
  message: ConversationMessage;
  sessionId?: string;
  subagentMap?: Map<string, string>;
}

function buildToolMap(content: ContentBlock[]): Map<string, string> {
  const toolMap = new Map<string, string>();
  for (const block of content) {
    if (block.type === "tool_use" && block.id && block.name) {
      toolMap.set(block.id, block.name);
    }
  }
  return toolMap;
}

const MessageBlock = memo(function MessageBlock(props: MessageBlockProps) {
  const { message, sessionId, subagentMap } = props;

  const isUser = message.type === "user";
  const content = message.message?.content;
  const model = message.message?.model;
  const provider = !isUser ? getProviderInfo(model) : null;

  const getTextBlocks = (): ContentBlock[] => {
    if (!content || typeof content === "string") {
      return [];
    }
    return content.filter((b) => b.type === "text");
  };

  const getToolBlocks = (): ContentBlock[] => {
    if (!content || typeof content === "string") {
      return [];
    }
    return content.filter(
      (b) =>
        b.type === "tool_use" || b.type === "tool_result" || b.type === "thinking"
    );
  };

  const getVisibleTextBlocks = (): ContentBlock[] => {
    return getTextBlocks().filter(
      (b) => b.text && sanitizeText(b.text).length > 0
    );
  };

  const hasVisibleText = (): boolean => {
    if (typeof content === "string") {
      return sanitizeText(content).length > 0;
    }
    return getVisibleTextBlocks().length > 0;
  };

  const toolBlocks = getToolBlocks();
  const visibleTextBlocks = getVisibleTextBlocks();
  const hasText = hasVisibleText();
  const hasTools = toolBlocks.length > 0;

  const toolMap = Array.isArray(content) ? buildToolMap(content) : new Map<string, string>();

  if (!hasText && hasTools) {
    return (
      <div className="flex flex-col gap-1 py-0.5">
        {toolBlocks.map((block, index) => (
          <ContentBlockRenderer key={index} block={block} toolMap={toolMap} sessionId={sessionId} subagentMap={subagentMap} />
        ))}
        {provider && (
          <span className={`text-[9px] ${provider.color} px-1 py-px rounded border w-fit`}>
            {model}
          </span>
        )}
      </div>
    );
  }

  if (!hasText && !hasTools) {
    return null;
  }

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} min-w-0`}>
      <div className="max-w-[85%] min-w-0">
        <div
          className={`px-3.5 py-2.5 rounded-2xl overflow-hidden ${
            isUser
              ? "bg-indigo-600/80 text-indigo-50 rounded-br-md"
              : "bg-cyan-700/50 text-zinc-100 rounded-bl-md"
          }`}
        >
          {typeof content === "string" ? (
            isUser ? (
              <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">
                {sanitizeText(content)}
              </div>
            ) : (
              <MarkdownRenderer content={sanitizeText(content)} />
            )
          ) : (
            <div className="flex flex-col gap-1">
              {visibleTextBlocks.map((block, index) => (
                <ContentBlockRenderer key={index} block={block} isUser={isUser} toolMap={toolMap} sessionId={sessionId} subagentMap={subagentMap} />
              ))}
            </div>
          )}
        </div>

        {hasTools && (
          <div className="flex flex-col gap-1 mt-1.5">
            {toolBlocks.map((block, index) => (
              <ContentBlockRenderer key={index} block={block} toolMap={toolMap} sessionId={sessionId} subagentMap={subagentMap} />
            ))}
          </div>
        )}

        {provider && (
          <div className="mt-1">
            <span className={`text-[9px] ${provider.color} px-1 py-px rounded border`}>
              {model}
            </span>
          </div>
        )}
      </div>
    </div>
  );
});

interface ContentBlockRendererProps {
  block: ContentBlock;
  isUser?: boolean;
  toolMap?: Map<string, string>;
  sessionId?: string;
  subagentMap?: Map<string, string>;
}

const TOOL_ICONS: Record<string, typeof Wrench> = {
  todowrite: ListTodo,
  read: FileCode,
  bash: Terminal,
  grep: Search,
  edit: Pencil,
  write: FilePlus2,
  glob: FolderOpen,
  task: Bot,
  exec_command: Terminal,
  read_file: FileCode,
  replace: Pencil,
  write_file: FilePlus2,
};

const TOOL_ICON_PATTERNS: Array<{ patterns: string[]; icon: typeof Wrench }> = [
  { patterns: ["web", "fetch", "url"], icon: Globe },
  { patterns: ["ask", "question"], icon: MessageSquare },
  { patterns: ["git", "commit"], icon: GitBranch },
  { patterns: ["sql", "database", "query"], icon: Database },
  { patterns: ["file", "disk"], icon: HardDrive },
];

function getToolIcon(toolName: string) {
  const name = toolName.toLowerCase();

  if (TOOL_ICONS[name]) {
    return TOOL_ICONS[name];
  }

  for (const { patterns, icon } of TOOL_ICON_PATTERNS) {
    if (patterns.some((p) => name.includes(p))) {
      return icon;
    }
  }

  return Wrench;
}

function getFilePathPreview(filePath: string): string {
  const parts = filePath.split("/");
  return parts.slice(-2).join("/");
}

type PreviewHandler = (input: Record<string, unknown>) => string | null;

const TOOL_PREVIEW_HANDLERS: Record<string, PreviewHandler> = {
  read: (input) => input.file_path ? getFilePathPreview(String(input.file_path)) : null,
  edit: (input) => input.file_path ? getFilePathPreview(String(input.file_path)) : null,
  write: (input) => input.file_path ? getFilePathPreview(String(input.file_path)) : null,
  bash: (input) => {
    if (!input.command) {
      return null;
    }
    const cmd = String(input.command);
    return cmd.length > 50 ? cmd.slice(0, 50) + "..." : cmd;
  },
  grep: (input) => input.pattern ? `"${String(input.pattern)}"` : null,
  glob: (input) => input.pattern ? String(input.pattern) : null,
  task: (input) => input.description ? String(input.description) : null,
  exec_command: (input) => {
    const cmd = input.cmd || input.command;
    if (!cmd) return null;
    const cmdStr = String(cmd);
    return cmdStr.length > 50 ? cmdStr.slice(0, 50) + "..." : cmdStr;
  },
  read_file: (input) => input.file_path ? getFilePathPreview(String(input.file_path)) : null,
  replace: (input) => input.file_path ? getFilePathPreview(String(input.file_path)) : null,
  write_file: (input) => input.file_path ? getFilePathPreview(String(input.file_path)) : null,
};

function getToolPreview(toolName: string, input: Record<string, unknown> | undefined): string | null {
  if (!input) {
    return null;
  }

  const name = toolName.toLowerCase();
  const handler = TOOL_PREVIEW_HANDLERS[name];

  if (handler) {
    return handler(input);
  }

  if (name.includes("web") && input.url) {
    try {
      const url = new URL(String(input.url));
      return url.hostname;
    } catch {
      return String(input.url).slice(0, 30);
    }
  }

  return null;
}

interface ToolInputRendererProps {
  toolName: string;
  input: Record<string, unknown>;
  sessionId?: string;
  agentId?: string;
}

function ToolInputRenderer(props: ToolInputRendererProps) {
  const { toolName, input, sessionId, agentId } = props;
  const name = toolName.toLowerCase();

  if (name === "todowrite" && input.todos) {
    return <TodoRenderer todos={input.todos as Array<{ content: string; status: "pending" | "in_progress" | "completed" }>} />;
  }

  if (name === "edit" && input.file_path) {
    return <EditRenderer input={input as { file_path: string; old_string: string; new_string: string }} />;
  }

  if (name === "write" && input.file_path) {
    return <WriteRenderer input={input as { file_path: string; content: string }} />;
  }

  if (name === "bash" && input.command) {
    return <BashRenderer input={input as { command: string; description?: string }} />;
  }

  if (name === "grep" && input.pattern) {
    return <GrepRenderer input={input as { pattern: string; path?: string; glob?: string; type?: string }} />;
  }

  if (name === "glob" && input.pattern) {
    return <GlobRenderer input={input as { pattern: string; path?: string }} />;
  }

  if (name === "read" && input.file_path) {
    return <ReadRenderer input={input as { file_path: string; offset?: number; limit?: number }} />;
  }

  if (name === "askuserquestion" && input.questions) {
    return <AskQuestionRenderer input={input as { questions: Array<{ header: string; question: string; options: Array<{ label: string; description: string }>; multiSelect: boolean }> }} />;
  }

  if (name === "task" && input.prompt) {
    return <TaskRenderer input={input as { description: string; prompt: string; subagent_type: string; model?: string; run_in_background?: boolean; resume?: string }} sessionId={sessionId} agentId={agentId} />;
  }

  return (
    <pre className="text-xs text-slate-300 bg-slate-900/50 border border-slate-700/50 rounded-lg p-3 mt-2 overflow-x-auto whitespace-pre-wrap break-all max-h-80 overflow-y-auto">
      {JSON.stringify(input, null, 2)}
    </pre>
  );
}

interface ToolResultRendererProps {
  toolName: string;
  content: string;
  isError?: boolean;
}

function ToolResultRenderer(props: ToolResultRendererProps) {
  const { toolName, content, isError } = props;
  const name = toolName.toLowerCase();

  if (name === "bash") {
    return <BashResultRenderer content={content} isError={isError} />;
  }

  if (name === "glob") {
    return <SearchResultRenderer content={content} isFileList />;
  }

  if (name === "grep") {
    return <SearchResultRenderer content={content} />;
  }

  if (name === "read") {
    return <FileContentRenderer content={content} />;
  }

  if (!content || content.trim().length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-teal-500/10 border border-teal-500/20 rounded-lg mt-2">
        <Check size={14} className="text-teal-400" />
        <span className="text-xs text-teal-300">Completed successfully</span>
      </div>
    );
  }

  const maxLength = 2000;
  const truncated = content.length > maxLength;
  const displayContent = truncated ? content.slice(0, maxLength) : content;

  return (
    <pre
      className={`text-xs rounded-lg p-3 mt-2 overflow-x-auto whitespace-pre-wrap break-all max-h-80 overflow-y-auto border ${
        isError
          ? "bg-rose-950/30 text-rose-200/80 border-rose-900/30"
          : "bg-teal-950/30 text-teal-200/80 border-teal-900/30"
      }`}
    >
      {displayContent}
      {truncated && <span className="text-zinc-500">... ({content.length - maxLength} more chars)</span>}
    </pre>
  );
}

function ContentBlockRenderer(props: ContentBlockRendererProps) {
  const { block, isUser, toolMap, sessionId, subagentMap } = props;
  const [expanded, setExpanded] = useState(false);

  if (block.type === "text" && block.text) {
    const sanitized = sanitizeText(block.text);
    if (!sanitized) {
      return null;
    }
    if (isUser) {
      return (
        <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">
          {sanitized}
        </div>
      );
    }
    return <MarkdownRenderer content={sanitized} />;
  }

  if (block.type === "thinking" && block.thinking) {
    return (
      <div className={expanded ? "w-full" : ""}>
        <button
          onClick={() => setExpanded(!expanded)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/15 text-[11px] text-amber-400/90 transition-colors border border-amber-500/20"
        >
          <Lightbulb size={12} className="opacity-70" />
          <span className="font-medium">thinking</span>
          <span className="text-[10px] opacity-50 ml-0.5">
            {expanded ? "▼" : "▶"}
          </span>
        </button>
        {expanded && (
          <pre className="text-xs text-zinc-400 bg-zinc-900/80 border border-zinc-800 rounded-lg p-3 mt-2 whitespace-pre-wrap max-h-80 overflow-y-auto">
            {block.thinking}
          </pre>
        )}
      </div>
    );
  }

  if (block.type === "tool_use") {
    const input =
      block.input && typeof block.input === "object" ? block.input as Record<string, unknown> : undefined;
    const hasInput = input && Object.keys(input).length > 0;
    const Icon = getToolIcon(block.name || "");
    const preview = getToolPreview(block.name || "", input);
    const toolName = block.name?.toLowerCase() || "";

    const hasSpecialRenderer =
      toolName === "todowrite" ||
      toolName === "edit" ||
      toolName === "write" ||
      toolName === "bash" ||
      toolName === "grep" ||
      toolName === "glob" ||
      toolName === "read" ||
      toolName === "askuserquestion" ||
      toolName === "task";

    const shouldAutoExpand = toolName === "todowrite" || toolName === "askuserquestion" || toolName === "task";
    const isExpanded = expanded || shouldAutoExpand;

    return (
      <div className={isExpanded ? "w-full" : ""}>
        <button
          onClick={() => hasInput && !shouldAutoExpand && setExpanded(!expanded)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-500/10 hover:bg-slate-500/15 text-[11px] text-slate-300 transition-colors border border-slate-500/20"
        >
          <Icon size={12} className="opacity-60" />
          <span className="font-medium text-slate-200">{block.name}</span>
          {preview && (
            <span className="text-slate-500 font-normal truncate max-w-[200px]">
              {preview}
            </span>
          )}
          {hasInput && !shouldAutoExpand && (
            <span className="text-[10px] opacity-40 ml-0.5">
              {expanded ? "▼" : "▶"}
            </span>
          )}
        </button>
        {isExpanded && hasInput && hasSpecialRenderer ? (
          <ToolInputRenderer toolName={block.name || ""} input={input} sessionId={sessionId} agentId={block.id && subagentMap ? subagentMap.get(block.id) : undefined} />
        ) : (
          expanded &&
          hasInput && (
            <pre className="text-xs text-slate-300 bg-slate-900/50 border border-slate-700/50 rounded-lg p-3 mt-2 overflow-x-auto whitespace-pre-wrap break-all max-h-80 overflow-y-auto">
              {JSON.stringify(input, null, 2)}
            </pre>
          )
        )}
      </div>
    );
  }

  if (block.type === "tool_result") {
    const isError = block.is_error;
    const rawContent =
      typeof block.content === "string"
        ? block.content
        : JSON.stringify(block.content, null, 2);
    const resultContent = sanitizeText(rawContent);
    const hasContent = resultContent.length > 0;
    const previewLength = 60;
    const contentPreview =
      hasContent && !expanded
        ? resultContent.slice(0, previewLength) + (resultContent.length > previewLength ? "..." : "")
        : null;

    const toolName = block.tool_use_id && toolMap ? toolMap.get(block.tool_use_id) || "" : "";

    return (
      <div className={expanded ? "w-full" : ""}>
        <button
          onClick={() => hasContent && setExpanded(!expanded)}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] transition-colors border ${
            isError
              ? "bg-rose-500/10 hover:bg-rose-500/15 text-rose-400/90 border-rose-500/20"
              : "bg-teal-500/10 hover:bg-teal-500/15 text-teal-400/90 border-teal-500/20"
          }`}
        >
          {isError ? (
            <X size={12} className="opacity-70" />
          ) : (
            <Check size={12} className="opacity-70" />
          )}
          <span className="font-medium">{isError ? "error" : "result"}</span>
          {contentPreview && !expanded && (
            <span
              className={`font-normal truncate max-w-[200px] ${isError ? "text-rose-500/70" : "text-teal-500/70"}`}
            >
              {contentPreview}
            </span>
          )}
          {hasContent && (
            <span className="text-[10px] opacity-40 ml-0.5">
              {expanded ? "▼" : "▶"}
            </span>
          )}
        </button>
        {expanded && hasContent && (
          <ToolResultRenderer
            toolName={toolName}
            content={resultContent}
            isError={isError}
          />
        )}
      </div>
    );
  }

  return null;
}

export default MessageBlock;
