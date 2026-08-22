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
      <div className="bg-zinc-900/70 border border-zinc-700/50 rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-700/50 bg-zinc-800/30">
          <Search size={14} className="text-amber-400" />
          <span className="text-xs font-medium text-zinc-300">Search</span>
        </div>
        <div className="p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">Pattern:</span>
            <code className="text-xs font-mono text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded">
              {input.pattern}
            </code>
          </div>
          {input.path && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">Path:</span>
              <span className="text-xs font-mono text-zinc-300">{input.path}</span>
            </div>
          )}
          {input.glob && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">Glob:</span>
              <span className="text-xs font-mono text-zinc-300">{input.glob}</span>
            </div>
          )}
          {input.type && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">Type:</span>
              <span className="text-xs font-mono text-zinc-300">{input.type}</span>
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
      <div className="bg-zinc-900/70 border border-zinc-700/50 rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-700/50 bg-zinc-800/30">
          <FolderOpen size={14} className="text-cyan-400" />
          <span className="text-xs font-medium text-zinc-300">Find Files</span>
        </div>
        <div className="p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">Pattern:</span>
            <code className="text-xs font-mono text-cyan-300 bg-cyan-500/10 px-1.5 py-0.5 rounded">
              {input.pattern}
            </code>
          </div>
          {input.path && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">Path:</span>
              <span className="text-xs font-mono text-zinc-300">{input.path}</span>
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
        <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800/30 border border-zinc-700/50 rounded-lg">
          <Search size={14} className="text-zinc-500" />
          <span className="text-xs text-zinc-400">No matches found</span>
        </div>
      </div>
    );
  }

  const lines = content.split("\n").filter((l) => l.trim());

  if (isFileList) {
    return (
      <div className="w-full mt-2">
        <div className="bg-zinc-900/70 border border-zinc-700/50 rounded-lg overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-700/50 bg-zinc-800/30">
            <FolderOpen size={14} className="text-cyan-400" />
            <span className="text-xs font-medium text-zinc-300">Files Found</span>
            <span className="text-xs text-zinc-500 ml-auto">{lines.length} files</span>
          </div>
          <div>
            <ul className="divide-y divide-zinc-800/50">
              {lines.map((line, index) => (
                <li key={index} className="group flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800/30">
                  <FileText size={12} className="text-zinc-500 flex-shrink-0" />
                  <span className="text-xs font-mono text-zinc-300 truncate flex-1">{line}</span>
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <CopyButton text={line} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full mt-2">
      <div className="bg-zinc-900/70 border border-zinc-700/50 rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-700/50 bg-zinc-800/30">
          <Search size={14} className="text-amber-400" />
          <span className="text-xs font-medium text-zinc-300">Results</span>
          <span className="text-xs text-zinc-500 ml-auto">{lines.length} matches</span>
        </div>
        <div className="overflow-x-auto">
          <pre className="text-xs font-mono p-3 text-zinc-300 whitespace-pre-wrap">
            {content}
          </pre>
        </div>
      </div>
    </div>
  );
}
