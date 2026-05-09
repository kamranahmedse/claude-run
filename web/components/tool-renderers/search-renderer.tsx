import { Search, FileText, FolderOpen } from "lucide-react";
import { CopyButton } from "./copy-button";

interface GrepInput {
  pattern: string;
  path?: string;
  glob?: string;
  type?: string;
}

interface GlobInput {
  pattern: string;
  path?: string;
}

interface GrepRendererProps {
  input: GrepInput;
}

interface GlobRendererProps {
  input: GlobInput;
}

interface SearchResultRendererProps {
  content: string;
  isFileList?: boolean;
}

export function GrepRenderer(props: GrepRendererProps) {
  const { input } = props;

  if (!input || !input.pattern) {
    return null;
  }

  return (
    <div className="w-full mt-2">
      <div className="theme-surface border theme-border-strong rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b theme-border-strong bg-[var(--bg-surface-hover)]">
          <Search size={14} className="text-amber-400" />
          <span className="text-xs font-medium theme-text-secondary">Search</span>
        </div>
        <div className="p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs theme-text-muted">Pattern:</span>
            <code className="text-xs font-mono text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
              {input.pattern}
            </code>
          </div>
          {input.path && (
            <div className="flex items-center gap-2">
              <span className="text-xs theme-text-muted">Path:</span>
              <span className="text-xs font-mono theme-text-secondary">{input.path}</span>
            </div>
          )}
          {input.glob && (
            <div className="flex items-center gap-2">
              <span className="text-xs theme-text-muted">Glob:</span>
              <span className="text-xs font-mono theme-text-secondary">{input.glob}</span>
            </div>
          )}
          {input.type && (
            <div className="flex items-center gap-2">
              <span className="text-xs theme-text-muted">Type:</span>
              <span className="text-xs font-mono theme-text-secondary">{input.type}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function GlobRenderer(props: GlobRendererProps) {
  const { input } = props;

  if (!input || !input.pattern) {
    return null;
  }

  return (
    <div className="w-full mt-2">
      <div className="theme-surface border theme-border-strong rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b theme-border-strong bg-[var(--bg-surface-hover)]">
          <FolderOpen size={14} className="text-cyan-400" />
          <span className="text-xs font-medium theme-text-secondary">Find Files</span>
        </div>
        <div className="p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs theme-text-muted">Pattern:</span>
            <code className="text-xs font-mono text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded">
              {input.pattern}
            </code>
          </div>
          {input.path && (
            <div className="flex items-center gap-2">
              <span className="text-xs theme-text-muted">Path:</span>
              <span className="text-xs font-mono theme-text-secondary">{input.path}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function SearchResultRenderer(props: SearchResultRendererProps) {
  const { content, isFileList } = props;

  if (!content || content.trim().length === 0) {
    return (
      <div className="w-full mt-2">
        <div className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-surface-hover)] border theme-border-strong rounded-lg">
          <Search size={14} className="theme-text-muted" />
          <span className="text-xs theme-text-tertiary">No matches found</span>
        </div>
      </div>
    );
  }

  const lines = content.split("\n").filter((l) => l.trim());
  const maxLines = 25;
  const truncated = lines.length > maxLines;
  const displayLines = truncated ? lines.slice(0, maxLines) : lines;

  if (isFileList) {
    return (
      <div className="w-full mt-2">
        <div className="theme-surface border theme-border-strong rounded-lg overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b theme-border-strong bg-[var(--bg-surface-hover)]">
            <FolderOpen size={14} className="text-cyan-400" />
            <span className="text-xs font-medium theme-text-secondary">Files Found</span>
            <span className="text-xs theme-text-muted ml-auto">{lines.length} files</span>
          </div>
          <div className="overflow-y-auto max-h-60">
            <ul className="divide-y divide-[var(--border-subtle)]">
              {displayLines.map((line, index) => (
                <li key={index} className="group flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--bg-surface-hover)]">
                  <FileText size={12} className="theme-text-muted flex-shrink-0" />
                  <span className="text-[13px] font-mono theme-text-secondary truncate flex-1">{line}</span>
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <CopyButton text={line} />
                  </div>
                </li>
              ))}
            </ul>
            {truncated && (
              <div className="px-3 py-2 text-xs theme-text-muted border-t theme-border-strong">
                ... {lines.length - maxLines} more files
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full mt-2">
      <div className="theme-surface border theme-border-strong rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b theme-border-strong bg-[var(--bg-surface-hover)]">
          <Search size={14} className="text-amber-400" />
          <span className="text-xs font-medium theme-text-secondary">Results</span>
          <span className="text-xs theme-text-muted ml-auto">{lines.length} matches</span>
        </div>
        <div className="overflow-x-auto max-h-80 overflow-y-auto">
          <pre className="text-xs font-mono p-3 theme-text-secondary whitespace-pre-wrap">
            {displayLines.join("\n")}
            {truncated && (
              <div className="theme-text-muted mt-2 pt-2 border-t theme-border-strong">
                ... {lines.length - maxLines} more matches
              </div>
            )}
          </pre>
        </div>
      </div>
    </div>
  );
}
