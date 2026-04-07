import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { CodexAdapter } from "./codex-adapter";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("CodexAdapter.deleteSession", () => {
  it("removes the session file, index entry, and shell snapshots", async () => {
    const codexDir = await makeTempDir("agents-run-codex-");
    const sessionId = "session-codex-delete";
    const sessionFile = join(
      codexDir,
      "sessions",
      "2026",
      "03",
      "24",
      `rollout-2026-03-24T00-00-00-${sessionId}.jsonl`,
    );
    const snapshotFile = join(codexDir, "shell_snapshots", `${sessionId}.123.sh`);

    await mkdir(join(codexDir, "sessions", "2026", "03", "24"), { recursive: true });
    await mkdir(join(codexDir, "shell_snapshots"), { recursive: true });
    await writeFile(
      join(codexDir, "session_index.jsonl"),
      `${JSON.stringify({
        id: sessionId,
        thread_name: "Delete me",
        updated_at: "2026-03-24T00:00:00.000Z",
      })}\n`,
      "utf-8",
    );
    await writeFile(
      sessionFile,
      [
        JSON.stringify({
          timestamp: "2026-03-24T00:00:00.000Z",
          type: "session_meta",
          payload: {
            id: sessionId,
            cwd: "/tmp/project",
            originator: "codex_cli_rs",
            timestamp: "2026-03-24T00:00:00.000Z",
          },
        }),
        JSON.stringify({
          type: "response_item",
          payload: {
            role: "user",
            content: [{ type: "input_text", text: "hello" }],
          },
        }),
      ].join("\n") + "\n",
      "utf-8",
    );
    await writeFile(snapshotFile, "echo test\n", "utf-8");

    const adapter = new CodexAdapter(codexDir);
    await adapter.init();

    await expect(adapter.deleteSession(sessionId)).resolves.toBe(true);
    expect(adapter.ownsSession(sessionId)).toBe(false);
    await expect(readFile(sessionFile, "utf-8")).rejects.toThrow();
    await expect(readFile(snapshotFile, "utf-8")).rejects.toThrow();

    const sessionIndex = await readFile(join(codexDir, "session_index.jsonl"), "utf-8");
    expect(sessionIndex).not.toContain(sessionId);
    await expect(adapter.getSessions()).resolves.toEqual([]);
  });
});
