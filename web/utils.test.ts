import { describe, expect, it } from "vitest";
import { isSessionIdMatch, matchesSessionSearch } from "./utils";

const session = {
  id: "019d1a7b-921a-7131-b429-770e02b804e8",
  display: "Fix Codex WebUI session rendering",
  timestamp: 1,
  project: "/tmp/project",
  projectName: "project",
  messageCount: 10,
  provider: "codex" as const,
};

describe("web session search helpers", () => {
  it("matches title search against session IDs", () => {
    expect(matchesSessionSearch(session, "019d1a7b-921a")).toBe(true);
    expect(matchesSessionSearch(session, "rendering")).toBe(true);
    expect(matchesSessionSearch(session, "project")).toBe(true);
    expect(matchesSessionSearch(session, "missing")).toBe(false);
  });

  it("detects session ID matches for UI hints", () => {
    expect(isSessionIdMatch(session.id, "770e02b804e8")).toBe(true);
    expect(isSessionIdMatch(session.id, "missing")).toBe(false);
  });
});
