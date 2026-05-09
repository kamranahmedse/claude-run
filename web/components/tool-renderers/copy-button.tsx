import { useState } from "react";
import { Copy, Check } from "lucide-react";

interface CopyButtonProps {
  text: string;
  className?: string;
}

export function CopyButton(props: CopyButtonProps) {
  const { text, className = "" } = props;
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={`p-1 rounded theme-surface-hover transition-colors ${className}`}
      title={copied ? "Copied!" : "Copy path"}
    >
      {copied ? (
        <Check size={12} className="text-emerald-400" />
      ) : (
        <Copy size={12} className="theme-text-muted hover:theme-text-secondary" />
      )}
    </button>
  );
}
