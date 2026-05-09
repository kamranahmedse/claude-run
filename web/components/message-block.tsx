import { useState, memo } from "react";
import type { ConversationMessage, ContentBlock } from "@claude-run/api";
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
import { sanitizeText, extractTaskNotifications } from "../utils";
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
  const { message } = props;

  const isUser = message.type === "user";
  const content = message.message?.content;

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

  // Check for task notifications in user string messages
  const taskNotifications = typeof content === "string" && isUser
    ? extractTaskNotifications(content)
    : [];
  const hasTaskNotifications = taskNotifications.length > 0;

  if (!hasText && hasTools) {
    return (
      <div className="flex flex-col gap-1 py-0.5">
        {toolBlocks.map((block, index) => (
          <ContentBlockRenderer key={index} block={block} toolMap={toolMap} />
        ))}
      </div>
    );
  }

  if (!hasText && !hasTools && !hasTaskNotifications) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      {/* Task notifications rendered as assistant bubbles */}
      {hasTaskNotifications && (
        <div className="flex justify-start">
          <div className="max-w-[85%] min-w-0">
            {taskNotifications.map((summary, i) => (
              <div key={i} className="bubble-assistant rounded-bl-md px-3.5 py-2.5 mb-1 inline-flex items-center gap-2">
                <Bot size={14} className="opacity-60 shrink-0" />
                <span className="text-[13px]">{summary}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main message bubble */}
      {hasText && (
        <div className={`flex ${isUser ? "justify-end" : "justify-start"} min-w-0`}>
          <div className="max-w-[85%] min-w-0">
            <div
              className={`px-3.5 py-2.5 rounded-2xl overflow-hidden ${
                isUser
                  ? "bubble-user rounded-br-md"
                  : "bubble-assistant rounded-bl-md"
              }`}
            >
              {typeof content === "string" ? (
                isUser ? (
                  <div className="whitespace-pre-wrap break-words text-[14px] leading-relaxed">
                    {sanitizeText(content)}
                  </div>
                ) : (
                  <MarkdownRenderer content={sanitizeText(content)} />
                )
              ) : (
                <div className="flex flex-col gap-1">
                  {visibleTextBlocks.map((block, index) => (
                    <ContentBlockRenderer key={index} block={block} isUser={isUser} toolMap={toolMap} />
                  ))}
                </div>
              )}
            </div>
            {hasTools && (
              <div className="flex flex-col gap-1 mt-1.5">
                {toolBlocks.map((block, index) => (
                  <ContentBlockRenderer key={index} block={block} toolMap={toolMap} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

interface ContentBlockRendererProps {
  block: ContentBlock;
  isUser?: boolean;
  toolMap?: Map<string, string>;
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
}

function ToolInputRenderer(props: ToolInputRendererProps) {
  const { toolName, input } = props;
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
    return <TaskRenderer input={input as { description: string; prompt: string; subagent_type: string; model?: string; run_in_background?: boolean; resume?: string }} />;
  }

  return (
    <pre className="text-xs theme-text-secondary theme-surface border theme-border-strong rounded-lg p-3 mt-2 overflow-x-auto whitespace-pre-wrap break-all max-h-80 overflow-y-auto">
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
      <div className="flex items-center gap-2 px-3 py-2 success-btn rounded-lg mt-2 border">
        <Check size={14} />
        <span className="text-xs">Completed successfully</span>
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
          ? "error-btn"
          : "success-btn"
      }`}
    >
      {displayContent}
      {truncated && <span className="theme-text-muted">... ({content.length - maxLength} more chars)</span>}
    </pre>
  );
}

function ContentBlockRenderer(props: ContentBlockRendererProps) {
  const { block, isUser, toolMap } = props;
  const [expanded, setExpanded] = useState(false);

  if (block.type === "text" && block.text) {
    const sanitized = sanitizeText(block.text);
    if (!sanitized) {
      return null;
    }
    if (isUser) {
      return (
        <div className="whitespace-pre-wrap break-words text-[14px] leading-relaxed">
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
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg thinking-btn text-[11px] transition-colors border"
        >
          <Lightbulb size={12} className="opacity-70" />
          <span className="font-medium">thinking</span>
          <span className="text-[10px] opacity-50 ml-0.5">
            {expanded ? "▼" : "▶"}
          </span>
        </button>
        {expanded && (
          <pre className="text-xs theme-text-secondary theme-elevated border theme-border rounded-lg p-3 mt-2 whitespace-pre-wrap max-h-80 overflow-y-auto">
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
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg tool-btn text-[11px] transition-colors border"
        >
          <Icon size={12} className="opacity-60" />
          <span className="font-medium">{block.name}</span>
          {preview && (
            <span className="opacity-70 font-normal truncate max-w-[200px]">
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
          <ToolInputRenderer toolName={block.name || ""} input={input} />
        ) : (
          expanded &&
          hasInput && (
            <pre className="text-xs theme-text-secondary theme-surface border theme-border-strong rounded-lg p-3 mt-2 overflow-x-auto whitespace-pre-wrap break-all max-h-80 overflow-y-auto">
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
              ? "error-btn"
              : "success-btn"
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
              className={`font-normal truncate max-w-[200px] opacity-70`}
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
