import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { GeminiAdapter } from "./gemini-adapter";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("GeminiAdapter.deleteSession", () => {
  it("removes the cached session and backing chat file", async () => {
    const geminiDir = await makeTempDir("agents-run-gemini-");
    const sessionId = "session-gemini-delete";
    const projectSlug = "project-slug";
    const sessionFile = join(
      geminiDir,
      "tmp",
      projectSlug,
      "chats",
      "session-delete.json",
    );

    await mkdir(join(geminiDir, "tmp", projectSlug, "chats"), { recursive: true });
    await writeFile(
      join(geminiDir, "projects.json"),
      JSON.stringify({
        projects: {
          "/tmp/project": projectSlug,
        },
      }),
      "utf-8",
    );
    await writeFile(
      sessionFile,
      JSON.stringify({
        sessionId,
        startTime: "2026-03-24T00:00:00.000Z",
        lastUpdated: "2026-03-24T00:00:00.000Z",
        summary: "Delete me",
        messages: [
          {
            id: "msg-1",
            type: "user",
            timestamp: "2026-03-24T00:00:00.000Z",
            content: "hello",
          },
        ],
      }),
      "utf-8",
    );

    const adapter = new GeminiAdapter(geminiDir);
    await adapter.init();

    await expect(adapter.deleteSession(sessionId)).resolves.toBe(true);
    expect(adapter.ownsSession(sessionId)).toBe(false);
    await expect(readFile(sessionFile, "utf-8")).rejects.toThrow();
    await expect(adapter.getSessions()).resolves.toEqual([]);
  });
});
