import { createTwoFilesPatch } from "diff";
import { FileEdit, Plus, Minus, FilePlus2 } from "lucide-react";
import { CopyButton } from "./copy-button";

interface EditInput {
  file_path: string;
  old_string: string;
  new_string: string;
}

interface WriteInput {
  file_path: string;
  content: string;
}

interface EditRendererProps {
  input: EditInput;
}

interface WriteRendererProps {
  input: WriteInput;
}

function getFileName(filePath: string) {
  const parts = filePath.split("/");
  return parts.slice(-2).join("/");
}

function parseDiff(diffText: string) {
  const lines = diffText.split("\n");
  const result: Array<{ type: "add" | "remove" | "context" | "header"; content: string }> = [];

  for (const line of lines) {
    if (line.startsWith("@@")) {
      result.push({ type: "header", content: line });
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      result.push({ type: "add", content: line.slice(1) });
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      result.push({ type: "remove", content: line.slice(1) });
    } else if (line.startsWith(" ")) {
      result.push({ type: "context", content: line.slice(1) });
    }
  }

  return result;
}

export function EditRenderer(props: EditRendererProps) {
  const { input } = props;

  if (!input || !input.file_path) {
    return null;
  }

  const oldStr = input.old_string || "";
  const newStr = input.new_string || "";
  const fileName = getFileName(input.file_path);

  const diff = createTwoFilesPatch("a/" + fileName, "b/" + fileName, oldStr, newStr, "", "", {
    context: 3,
  });

  const parsedLines = parseDiff(diff);
  const addedLines = parsedLines.filter((l) => l.type === "add").length;
  const removedLines = parsedLines.filter((l) => l.type === "remove").length;

  return (
    <div className="w-full mt-2">
      <div className="bg-zinc-900/70 border border-zinc-700/50 rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-700/50 bg-zinc-800/30">
          <FileEdit size={14} className="text-blue-400" />
          <span className="text-xs font-mono text-zinc-300">{fileName}</span>
          <div className="flex items-center gap-2 ml-auto text-xs">
            {addedLines > 0 && (
              <span className="flex items-center gap-0.5 text-emerald-400">
                <Plus size={12} />
                {addedLines}
              </span>
            )}
            {removedLines > 0 && (
              <span className="flex items-center gap-0.5 text-rose-400">
                <Minus size={12} />
                {removedLines}
              </span>
            )}
            <CopyButton text={input.file_path} />
          </div>
        </div>
        <div className="overflow-x-auto">
          <pre className="text-xs font-mono p-0">
            {parsedLines.map((line, index) => {
              if (line.type === "header") {
                return (
                  <div
                    key={index}
                    className="px-3 py-1 bg-blue-900/20 text-blue-300 border-y border-blue-900/30"
                  >
                    {line.content}
                  </div>
                );
              }
              if (line.type === "add") {
                return (
                  <div
                    key={index}
                    className="px-3 py-0.5 bg-emerald-900/20 text-emerald-300 border-l-2 border-emerald-500"
                  >
                    <span className="select-none text-emerald-600 mr-2">+</span>
                    {line.content || " "}
                  </div>
                );
              }
              if (line.type === "remove") {
                return (
                  <div
                    key={index}
                    className="px-3 py-0.5 bg-rose-900/20 text-rose-300 border-l-2 border-rose-500"
                  >
                    <span className="select-none text-rose-600 mr-2">-</span>
                    {line.content || " "}
                  </div>
                );
              }
              return (
                <div key={index} className="px-3 py-0.5 text-zinc-400">
                  <span className="select-none text-zinc-600 mr-2"> </span>
                  {line.content || " "}
                </div>
              );
            })}
          </pre>
        </div>
      </div>
    </div>
  );
}

export function WriteRenderer(props: WriteRendererProps) {
  const { input } = props;

  if (!input || !input.file_path) {
    return null;
  }

  const content = input.content || "";
  const fileName = getFileName(input.file_path);
  const lineCount = content.split("\n").length;
  const preview = content.slice(0, 500);
  const isTruncated = content.length > 500;

  return (
    <div className="w-full mt-2">
      <div className="bg-zinc-900/70 border border-zinc-700/50 rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-700/50 bg-zinc-800/30">
          <FilePlus2 size={14} className="text-emerald-400" />
          <span className="text-xs font-mono text-zinc-300">{fileName}</span>
          <div className="flex items-center gap-1 ml-auto">
            <span className="text-xs text-zinc-500">{lineCount} lines</span>
            <CopyButton text={input.file_path} />
          </div>
        </div>
        <div className="overflow-x-auto">
          <pre className="text-xs font-mono p-3 text-zinc-300">
            {preview}
            {isTruncated && (
              <span className="text-zinc-500">... ({content.length - 500} more chars)</span>
            )}
          </pre>
        </div>
      </div>
    </div>
  );
}
