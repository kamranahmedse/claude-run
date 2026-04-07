import type { SearchResult, Session } from "./storage";

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createSnippet(
  text: string,
  query: string,
  contextLength: number = 60,
): string {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);

  if (index === -1) {
    return text.slice(0, contextLength * 2);
  }

  const start = Math.max(0, index - contextLength);
  const end = Math.min(text.length, index + query.length + contextLength);

  let snippet = text.slice(start, end);
  if (start > 0) snippet = "..." + snippet;
  if (end < text.length) snippet = snippet + "...";

  return snippet;
}

export function matchesSessionId(sessionId: string, query: string): boolean {
  return sessionId.toLowerCase().includes(query.trim().toLowerCase());
}

export function createSessionIdSearchResult(
  session: Session,
  query: string,
): SearchResult {
  const text = `Session ID: ${session.id}`;

  return {
    sessionId: session.id,
    display: session.display,
    projectName: session.projectName,
    timestamp: session.timestamp,
    matchCount: 1,
    firstMatch: {
      messageIndex: 0,
      text,
      snippet: createSnippet(text, query),
    },
  };
}
