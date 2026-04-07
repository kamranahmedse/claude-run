#!/usr/bin/env node
import { program } from "commander";
import { createServer } from "./server";
import { homedir } from "os";
import { join } from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getVersion(): string {
  try {
    const pkgPath = join(__dirname, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version;
  } catch {
    return "0.1.0";
  }
}

program
  .name("agents-run")
  .description(
    "A multi-provider web UI for browsing AI coding session history"
  )
  .version(getVersion())
  .option("-p, --port <number>", "Port to listen on", "12001")
  .option(
    "-d, --dir <path>",
    "Claude directory path",
    join(homedir(), ".claude")
  )
  .option("--dev", "Enable CORS for development")
  .option("--no-open", "Do not open browser automatically")
  .parse();

const opts = program.opts<{
  port: string;
  dir: string;
  dev: boolean;
  open: boolean;
}>();

const server = createServer({
  port: parseInt(opts.port, 10),
  claudeDir: opts.dir,
  dev: opts.dev,
  open: opts.open,
});

process.on("SIGINT", () => {
  console.log("\nShutting down...");
  server.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  server.stop();
  process.exit(0);
});

server.start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
