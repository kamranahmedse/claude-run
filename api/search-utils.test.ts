import { describe, expect, it } from "vitest";
import {
  createSessionIdSearchResult,
  matchesSessionId,
} from "./search-utils";
import type { Session } from "./storage";

const session: Session = {
  id: "019d1a7b-921a-7131-b429-770e02b804e8",
  display: "Fix Codex WebUI session rendering",
  timestamp: 1,
  project: "/tmp/project",
  projectName: "project",
  messageCount: 10,
  provider: "codex",
};

describe("search-utils", () => {
  it("matches session IDs case-insensitively", () => {
    expect(matchesSessionId(session.id, "019d1a7b-921a")).toBe(true);
    expect(matchesSessionId(session.id, "B429-770E02B804E8")).toBe(true);
    expect(matchesSessionId(session.id, "missing")).toBe(false);
  });

  it("creates a search result for session ID hits", () => {
    const result = createSessionIdSearchResult(session, "019d1a7b");

    expect(result.sessionId).toBe(session.id);
    expect(result.matchCount).toBe(1);
    expect(result.firstMatch.text).toContain(session.id);
    expect(result.firstMatch.snippet).toContain("Session ID:");
  });
});
