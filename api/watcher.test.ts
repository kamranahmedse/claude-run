import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emitSessionChange,
  offSessionChange,
  onSessionChange,
  type SessionChangeEvent,
} from "./watcher";

describe("watcher session change events", () => {
  const listeners: Array<(event: SessionChangeEvent) => void> = [];

  afterEach(() => {
    for (const listener of listeners.splice(0)) {
      offSessionChange(listener);
    }
  });

  it("includes the provider in emitted session change events", () => {
    const listener = vi.fn();
    listeners.push(listener);
    onSessionChange(listener);

    const event: SessionChangeEvent = {
      sessionId: "session-1",
      filePath: "/tmp/codex-session.jsonl",
      provider: "codex",
    };

    emitSessionChange(event);

    expect(listener).toHaveBeenCalledWith(event);
  });
});
