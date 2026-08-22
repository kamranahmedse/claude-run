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
      <div className="bg-zinc-900/70 border border-zinc-700/50 rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-700/50 bg-zinc-800/30">
          <Terminal size={14} className="text-green-400" />
          <span className="text-xs font-medium text-zinc-300">Command</span>
          {description && (
            <span className="text-xs text-zinc-500 truncate ml-1">— {description}</span>
          )}
          <button
            onClick={handleCopy}
            className="ml-auto p-1 hover:bg-zinc-700/50 rounded transition-colors"
            title="Copy command"
          >
            {copied ? (
              <Check size={12} className="text-green-400" />
            ) : (
              <Copy size={12} className="text-zinc-500" />
            )}
          </button>
        </div>
        <div className="p-3 overflow-x-auto">
          <div className="flex items-start gap-2">
            <pre className="text-xs font-mono m-0 p-0 bg-transparent! text-zinc-200 whitespace-pre-wrap break-all">
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
        <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800/30 border border-zinc-700/50 rounded-lg">
          <CheckCircle2 size={14} className="text-teal-400" />
          <span className="text-xs text-zinc-400">Command completed successfully (no output)</span>
        </div>
      </div>
    );
  }

  const lines = content.split("\n");

  return (
    <div className="w-full mt-2">
      <div
        className={`border rounded-lg overflow-hidden ${
          isError
            ? "bg-rose-950/20 border-rose-900/30"
            : "bg-zinc-900/70 border-zinc-700/50"
        }`}
      >
        <div
          className={`flex items-center gap-2 px-3 py-2 border-b ${
            isError ? "border-rose-900/30 bg-rose-900/20" : "border-zinc-700/50 bg-zinc-800/30"
          }`}
        >
          {isError ? (
            <>
              <AlertTriangle size={14} className="text-rose-400" />
              <span className="text-xs font-medium text-rose-300">Error Output</span>
            </>
          ) : (
            <>
              <Play size={14} className="text-teal-400" />
              <span className="text-xs font-medium text-zinc-300">Output</span>
            </>
          )}
          <span className="text-xs text-zinc-500 ml-auto">{lines.length} lines</span>
        </div>
        <div className="overflow-x-auto">
          <pre
            className={`text-xs font-mono p-3 whitespace-pre-wrap break-all ${
              isError ? "text-rose-200/80" : "text-zinc-300"
            }`}
          >
            {content}
          </pre>
        </div>
      </div>
    </div>
  );
}
