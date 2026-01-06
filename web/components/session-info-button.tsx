import { useState } from "react";
import { Info } from "lucide-react";
import type { Session } from "@claude-run/api";

interface SessionInfoButtonProps {
  session: Session | null;
}

function SessionInfoButton(props: SessionInfoButtonProps) {
  const { session } = props;
  const [expanded, setExpanded] = useState(false);

  if (!session) {
    return null;
  }

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  return (
    <div className="mb-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-500/10 hover:bg-slate-500/15 text-[11px] text-slate-300 transition-colors border border-slate-500/20"
      >
        <Info size={12} className="opacity-60" aria-hidden="true" />
        <span className="font-medium text-slate-200">Session Details</span>
        <span className="text-[10px] opacity-40 ml-0.5">
          {expanded ? "▼" : "▶"}
        </span>
      </button>
      {expanded && (
        <div className="mt-2 bg-zinc-900/70 border border-zinc-700/50 rounded-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-zinc-700/50 bg-zinc-800/30">
            <span className="text-xs font-medium text-zinc-300">Session Information</span>
          </div>
          <div className="p-3">
            <div className="space-y-2 text-xs">
              <div className="flex">
                <span className="text-zinc-500 w-24 shrink-0">Session ID:</span>
                <span className="text-zinc-300 font-mono break-all">{session.id}</span>
              </div>
              <div className="flex">
                <span className="text-zinc-500 w-24 shrink-0">Display:</span>
                <span className="text-zinc-300">{session.display}</span>
              </div>
              <div className="flex">
                <span className="text-zinc-500 w-24 shrink-0">Project:</span>
                <span className="text-zinc-300 font-mono break-all">{session.project}</span>
              </div>
              <div className="flex">
                <span className="text-zinc-500 w-24 shrink-0">Project Name:</span>
                <span className="text-zinc-300">{session.projectName}</span>
              </div>
              <div className="flex">
                <span className="text-zinc-500 w-24 shrink-0">Timestamp:</span>
                <span className="text-zinc-300">{formatDate(session.timestamp)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SessionInfoButton;
