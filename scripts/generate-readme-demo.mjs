import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = dirname(__dirname);

const managedBaseUrl = "http://localhost:12011";
const baseUrl = process.env.AGENTS_RUN_URL ?? managedBaseUrl;
const repoName = process.env.DEMO_QUERY ?? "agents-run";
const framesDir = join(rootDir, ".github", ".demo-frames");
const timelinePath = join(framesDir, "timeline.json");
const outputGif = join(rootDir, ".github", "agents-run.gif");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isServerReady() {
  try {
    const response = await fetch(`${baseUrl}/api/providers`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer(timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isServerReady()) return;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for server at ${baseUrl}`);
}

async function ensureServer() {
  if (await isServerReady()) return null;

  if (process.env.AGENTS_RUN_URL) {
    throw new Error(`Demo server is not reachable at ${baseUrl}`);
  }

  await access(join(rootDir, "dist", "index.js"));

  const child = spawn(process.execPath, ["dist/index.js", "--no-open", "--port", "12011"], {
    cwd: rootDir,
    env: {
      ...process.env,
      AGENTS_RUN_DEMO: "1",
    },
    stdio: "ignore",
  });

  await waitForServer();
  return child;
}

async function buildGif() {
  const child = spawn("python3", [join(rootDir, "scripts", "build-readme-gif.py"), timelinePath, outputGif], {
    cwd: rootDir,
    stdio: "inherit",
  });

  await new Promise((resolve, reject) => {
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`GIF build failed with exit code ${code}`));
    });
    child.on("error", reject);
  });
}

async function run() {
  const startedServer = await ensureServer();
  try {
    await rm(framesDir, { recursive: true, force: true });
    await mkdir(framesDir, { recursive: true });

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      colorScheme: "dark",
    });

    const timeline = [];

    async function capture(name, duration) {
      const file = `${String(timeline.length).padStart(2, "0")}-${name}.png`;
      await page.screenshot({
        path: join(framesDir, file),
        fullPage: false,
      });
      timeline.push({ file, duration });
      console.log(`Captured ${file}`);
    }

    async function waitForRows() {
      await page.waitForFunction(() => document.querySelectorAll("[data-index]").length > 0, {
        timeout: 15_000,
      });
    }

    async function scrollConversation(scrollTop) {
      await page.evaluate((top) => {
        const candidates = Array.from(document.querySelectorAll("div.h-full.overflow-y-auto.bg-zinc-950"));
        const target = candidates
          .filter((el) => el.scrollHeight > el.clientHeight + 40)
          .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
        if (target) target.scrollTop = top;
      }, scrollTop);
      await page.waitForTimeout(250);
    }

    function sessionRow(providerLabel) {
      return page
        .locator("[data-index]")
        .filter({ hasText: repoName })
        .filter({ hasText: providerLabel })
        .first();
    }

    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
    await page.waitForSelector("#select-project", { timeout: 15_000 });
    await waitForRows();
    await page.waitForTimeout(800);

    await capture("overview", 900);

    const searchInput = page.locator('input[placeholder="Search sessions..."]');
    const partialQuery = repoName.slice(0, Math.max(4, Math.ceil(repoName.length / 2)));

    await searchInput.fill(partialQuery);
    await page.waitForTimeout(350);
    await capture("search-partial", 260);

    await searchInput.fill(repoName);
    await page.waitForTimeout(500);
    await capture("search-full", 700);

    await sessionRow("Claude").click();
    await page.waitForTimeout(1_200);
    await capture("claude-session", 900);

    await scrollConversation(420);
    await capture("claude-scroll", 260);

    await sessionRow("Codex").click();
    await page.waitForTimeout(1_100);
    await capture("codex-session", 850);

    await scrollConversation(520);
    await capture("codex-scroll", 260);

    await sessionRow("Gemini").click();
    await page.waitForTimeout(1_100);
    await capture("gemini-session", 1_000);

    await browser.close();

    await writeFile(timelinePath, JSON.stringify(timeline, null, 2), "utf-8");
    await buildGif();
  } finally {
    if (!process.env.KEEP_DEMO_FRAMES) {
      await rm(framesDir, { recursive: true, force: true });
    }
    if (startedServer) {
      startedServer.kill("SIGTERM");
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
