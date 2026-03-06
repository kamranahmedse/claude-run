import { FileText, FileCode } from "lucide-react";
import { CopyButton } from "./copy-button";
import { useState } from "react";

interface ReadInput {
  file_path: string;
  offset?: number;
  limit?: number;
}

interface ReadRendererProps {
  input: ReadInput;
}

interface FileContentRendererProps {
  content: string;
  fileName?: string;
}

function getFileName(filePath: string) {
  const parts = filePath.split("/");
  return parts.slice(-2).join("/");
}

function getFileExtension(filePath: string) {
  const parts = filePath.split(".");
  return parts.length > 1 ? parts.pop()?.toLowerCase() : "";
}

function getLanguageFromExt(ext: string) {
  const languageMap: Record<string, string> = {
    ts: "TypeScript",
    tsx: "TypeScript React",
    js: "JavaScript",
    jsx: "JavaScript React",
    py: "Python",
    rb: "Ruby",
    go: "Go",
    rs: "Rust",
    java: "Java",
    cpp: "C++",
    c: "C",
    css: "CSS",
    scss: "SCSS",
    html: "HTML",
    json: "JSON",
    yaml: "YAML",
    yml: "YAML",
    md: "Markdown",
    sql: "SQL",
    sh: "Shell",
    bash: "Bash",
  };
  return languageMap[ext] || null;
}

export function ReadRenderer(props: ReadRendererProps) {
  const { input } = props;

  if (!input || !input.file_path) {
    return null;
  }

  const fileName = getFileName(input.file_path);
  const ext = getFileExtension(input.file_path);
  const language = ext ? getLanguageFromExt(ext) : null;

  return (
    <div className="w-full mt-2">
      <div className="bg-zinc-900/70 border border-zinc-700/50 rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-700/50 bg-zinc-800/30">
          <FileCode size={14} className="text-sky-400" />
          <span className="text-xs font-mono text-zinc-300">{fileName}</span>
          {language && (
            <span className="text-xs text-zinc-500 bg-zinc-700/50 px-1.5 py-0.5 rounded">
              {language}
            </span>
          )}
          <div className="flex items-center gap-1 ml-auto">
            {(input.offset || input.limit) && (
              <span className="text-xs text-zinc-500 mr-1">
                {input.offset && `from line ${input.offset}`}
                {input.offset && input.limit && ", "}
                {input.limit && `${input.limit} lines`}
              </span>
            )}
            <CopyButton text={input.file_path} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function FileContentRenderer(props: FileContentRendererProps) {
  const { content, fileName } = props;
  const [expanded, setExpanded] = useState(false);

  if (!content) {
    return null;
  }

  const lines = content.split("\n");
  const maxLines = 50;
  const truncated = lines.length > maxLines;
  const displayLines = !truncated || expanded ? lines : lines.slice(0, maxLines);

  const ext = fileName ? getFileExtension(fileName) : "";
  const language = ext ? getLanguageFromExt(ext) : null;

  return (
    <div className="w-full mt-2">
      <div className="bg-zinc-900/70 border border-zinc-700/50 rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-700/50 bg-zinc-800/30">
          <FileText size={14} className="text-sky-400" />
          <span className="text-xs font-medium text-zinc-300">File Content</span>
          {language && (
            <span className="text-xs text-zinc-500 bg-zinc-700/50 px-1.5 py-0.5 rounded">
              {language}
            </span>
          )}
          <span className="text-xs text-zinc-500 ml-auto">{lines.length} lines</span>
        </div>
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-xs font-mono">
            <tbody>
              {displayLines.map((line, index) => (
                <tr key={index} className="hover:bg-zinc-800/30">
                  <td className="select-none text-right pr-3 pl-3 py-0.5 text-zinc-600 border-r border-zinc-800 w-10 sticky left-0 bg-zinc-900/70">
                    {index + 1}
                  </td>
                  <td className="pl-3 pr-3 py-0.5 text-zinc-300 whitespace-pre">
                    {line || " "}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {truncated && (
            <div className="px-3 py-2 text-xs text-zinc-500 border-t border-zinc-700/50">
              {!expanded ? `... ${lines.length - maxLines} more lines` : "Showing full file output"}
              <button
                type="button"
                onClick={() => setExpanded((prev) => !prev)}
                className="ml-2 text-[11px] text-cyan-400 hover:text-cyan-300"
              >
                {expanded ? "Show less" : "Show all"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
