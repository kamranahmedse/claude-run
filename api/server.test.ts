import { describe, expect, it, vi } from "vitest";
import { applyClaudeSessionChange } from "./server";
import type { SessionChangeEvent } from "./watcher";

describe("applyClaudeSessionChange", () => {
  it("ignores non-Claude session events", () => {
    const adapter = {
      addToFileIndex: vi.fn(),
      invalidateSessionMeta: vi.fn(),
    };
    const event: SessionChangeEvent = {
      sessionId: "session-1",
      filePath: "/tmp/codex-session.jsonl",
      provider: "codex",
    };

    applyClaudeSessionChange(adapter, event);

    expect(adapter.addToFileIndex).not.toHaveBeenCalled();
    expect(adapter.invalidateSessionMeta).not.toHaveBeenCalled();
  });

  it("updates Claude state for Claude session events", () => {
    const adapter = {
      addToFileIndex: vi.fn(),
      invalidateSessionMeta: vi.fn(),
    };
    const event: SessionChangeEvent = {
      sessionId: "session-2",
      filePath: "/tmp/claude-session.jsonl",
      provider: "claude",
    };

    applyClaudeSessionChange(adapter, event);

    expect(adapter.addToFileIndex).toHaveBeenCalledWith(
      "session-2",
      "/tmp/claude-session.jsonl",
    );
    expect(adapter.invalidateSessionMeta).toHaveBeenCalledWith("session-2");
  });
});
