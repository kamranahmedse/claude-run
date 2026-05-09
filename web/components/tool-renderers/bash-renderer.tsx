import { Terminal, Play, AlertTriangle, CheckCircle2, Copy, Check } from "lucide-react";
import { useState } from "react";

interface BashInput {
  command: string;
  description?: string;
  timeout?: number;
}

interface BashRendererProps {
  input: BashInput;
}

interface BashResultRendererProps {
  content: string;
  isError?: boolean;
}

export function BashRenderer(props: BashRendererProps) {
  const { input } = props;
  const [copied, setCopied] = useState(false);

  if (!input || !input.command) {
    return null;
  }

  const command = input.command;
  const description = input.description;

  const handleCopy = () => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full mt-2">
      <div className="theme-surface border theme-border-strong rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b theme-border-strong bg-[var(--bg-surface-hover)]">
          <Terminal size={14} className="text-green-400" />
          <span className="text-xs font-medium theme-text-secondary">Command</span>
          {description && (
            <span className="text-xs theme-text-muted truncate ml-1">— {description}</span>
          )}
          <button
            onClick={handleCopy}
            className="ml-auto p-1 theme-surface-hover rounded transition-colors"
            title="Copy command"
          >
            {copied ? (
              <Check size={12} className="text-green-400" />
            ) : (
              <Copy size={12} className="theme-text-muted" />
            )}
          </button>
        </div>
        <div className="p-3 overflow-x-auto">
          <div className="flex items-start gap-2">
            <pre className="text-xs font-mono m-0 p-0 bg-transparent! theme-text-primary whitespace-pre-wrap break-all">
              {command}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

export function BashResultRenderer(props: BashResultRendererProps) {
  const { content, isError } = props;

  if (!content || content.trim().length === 0) {
    return (
      <div className="w-full mt-2">
        <div className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-surface-hover)] border theme-border-strong rounded-lg">
          <CheckCircle2 size={14} className="text-teal-400" />
          <span className="text-xs theme-text-tertiary">Command completed successfully (no output)</span>
        </div>
      </div>
    );
  }

  const lines = content.split("\n");
  const maxLines = 30;
  const truncated = lines.length > maxLines;
  const displayLines = truncated ? lines.slice(0, maxLines) : lines;

  return (
    <div className="w-full mt-2">
      <div
        className={`border rounded-lg overflow-hidden ${
          isError
            ? "error-btn"
            : "theme-surface theme-border-strong"
        }`}
      >
        <div
          className={`flex items-center gap-2 px-3 py-2 border-b ${
            isError ? "" : "theme-border-strong bg-[var(--bg-surface-hover)]"
          }`}
        >
          {isError ? (
            <>
              <AlertTriangle size={14} />
              <span className="text-xs font-medium">Error Output</span>
            </>
          ) : (
            <>
              <Play size={14} className="text-teal-400" />
              <span className="text-xs font-medium theme-text-secondary">Output</span>
            </>
          )}
          <span className="text-xs theme-text-muted ml-auto">{lines.length} lines</span>
        </div>
        <div className="overflow-x-auto max-h-80 overflow-y-auto">
          <pre
            className={`text-xs font-mono p-3 whitespace-pre-wrap break-all ${
              isError ? "" : "theme-text-secondary"
            }`}
          >
            {displayLines.join("\n")}
            {truncated && (
              <div className="theme-text-muted mt-2 pt-2 border-t theme-border-strong">
                ... {lines.length - maxLines} more lines
              </div>
            )}
          </pre>
        </div>
      </div>
    </div>
  );
}
