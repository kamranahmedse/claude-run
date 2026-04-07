import type { Session } from "@agents-run/api";

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${h}:${min}`;
}

const SANITIZE_PATTERNS = [
  /<command-name>[^<]*<\/command-name>/g,
  /<command-message>[^<]*<\/command-message>/g,
  /<command-args>[^<]*<\/command-args>/g,
  /<local-command-stdout>[^<]*<\/local-command-stdout>/g,
  /<system-reminder>[\s\S]*?<\/system-reminder>/g,
  /^\s*Caveat:.*?unless the user explicitly asks you to\./s,
];

export interface ProviderInfo {
  label: string;
  color: string;
}

const PROVIDER_RULES: Array<{ test: (model: string) => boolean; info: ProviderInfo }> = [
  { test: (m) => m.startsWith("kimi"), info: { label: "Kimi", color: "text-purple-400 bg-purple-500/15 border-purple-500/25" } },
  { test: (m) => m.startsWith("glm"), info: { label: "GLM", color: "text-green-400 bg-green-500/15 border-green-500/25" } },
  { test: (m) => m.startsWith("claude"), info: { label: "Claude", color: "text-orange-400 bg-orange-500/15 border-orange-500/25" } },
  { test: (m) => /^(gpt|o[1-9]|codex)/.test(m), info: { label: "OpenAI", color: "text-emerald-400 bg-emerald-500/15 border-emerald-500/25" } },
  { test: (m) => m.startsWith("gemini"), info: { label: "Gemini", color: "text-blue-400 bg-blue-500/15 border-blue-500/25" } },
];

export function getProviderInfo(model?: string): ProviderInfo | null {
  if (!model || model === "<synthetic>") return null;
  for (const rule of PROVIDER_RULES) {
    if (rule.test(model)) return rule.info;
  }
  return { label: model, color: "text-zinc-400 bg-zinc-500/15 border-zinc-500/25" };
}

export function getCliProviderInfo(
  provider?: string
): { label: string; color: string } | null {
  switch (provider) {
    case "claude":
      return { label: "Claude Code", color: "text-orange-400 bg-orange-500/15 border-orange-500/25" };
    case "codex":
      return { label: "Codex", color: "text-emerald-400 bg-emerald-500/15 border-emerald-500/25" };
    case "gemini":
      return { label: "Gemini", color: "text-blue-400 bg-blue-500/15 border-blue-500/25" };
    default:
      return null;
  }
}

export function sanitizeText(text: string): string {
  let result = text;
  for (const pattern of SANITIZE_PATTERNS) {
    result = result.replace(pattern, "");
  }
  return result.trim();
}

export function matchesSessionSearch(session: Session, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;

  return (
    session.display.toLowerCase().includes(trimmed) ||
    session.projectName.toLowerCase().includes(trimmed) ||
    session.id.toLowerCase().includes(trimmed)
  );
}

export function isSessionIdMatch(sessionId: string, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return false;
  return sessionId.toLowerCase().includes(trimmed);
}
