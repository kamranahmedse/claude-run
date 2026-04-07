import { watch, type FSWatcher } from "chokidar";
import { basename, join } from "path";
import type { ProviderName } from "./provider-types";

type HistoryChangeCallback = () => void;
export interface SessionChangeEvent {
  sessionId: string;
  filePath: string;
  provider: ProviderName;
}

type SessionChangeCallback = (event: SessionChangeEvent) => void;

let watcher: FSWatcher | null = null;
let claudeDir = "";
const debounceTimers = new Map<string, NodeJS.Timeout>();
const debounceMs = 20;

const historyChangeListeners = new Set<HistoryChangeCallback>();
const sessionChangeListeners = new Set<SessionChangeCallback>();

export function initWatcher(dir: string): void {
  claudeDir = dir;
}

function emitChange(filePath: string): void {
  if (filePath.endsWith("history.jsonl")) {
    for (const callback of historyChangeListeners) {
      callback();
    }
  } else if (filePath.endsWith(".jsonl")) {
    emitSessionChange({
      sessionId: basename(filePath, ".jsonl"),
      filePath,
      provider: "claude",
    });
  }
}

function handleChange(path: string): void {
  const existing = debounceTimers.get(path);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    debounceTimers.delete(path);
    emitChange(path);
  }, debounceMs);

  debounceTimers.set(path, timer);
}

export function startWatcher(): void {
  if (watcher) {
    return;
  }

  const historyPath = join(claudeDir, "history.jsonl");
  const projectsDir = join(claudeDir, "projects");
  const usePolling = process.env.CLAUDE_RUN_USE_POLLING === "1";

  watcher = watch([historyPath, projectsDir], {
    persistent: true,
    ignoreInitial: true,
    usePolling,
    ...(usePolling && { interval: 100 }),
    depth: 2,
  });

  watcher.on("change", handleChange);
  watcher.on("add", handleChange);
  watcher.on("error", (error) => {
    console.error("Watcher error:", error);
  });
}

const extraWatchers: FSWatcher[] = [];

export function addWatchTarget(
  paths: string[],
  depth: number,
  onChangeCallback: (filePath: string) => void,
): void {
  const usePolling = process.env.CLAUDE_RUN_USE_POLLING === "1";

  const w = watch(paths, {
    persistent: true,
    ignoreInitial: true,
    usePolling,
    ...(usePolling && { interval: 100 }),
    depth,
  });

  const debouncedCallback = (path: string) => {
    const existing = debounceTimers.get(path);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      debounceTimers.delete(path);
      onChangeCallback(path);
    }, debounceMs);
    debounceTimers.set(path, timer);
  };

  w.on("change", debouncedCallback);
  w.on("add", debouncedCallback);
  w.on("error", (error) => console.error("Watcher error:", error));

  extraWatchers.push(w);
}

export function emitHistoryChange(): void {
  for (const callback of historyChangeListeners) {
    callback();
  }
}

export function emitSessionChange(event: SessionChangeEvent): void {
  for (const callback of sessionChangeListeners) {
    callback(event);
  }
}

export function stopWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  for (const w of extraWatchers) {
    w.close();
  }
  extraWatchers.length = 0;

  for (const timer of debounceTimers.values()) {
    clearTimeout(timer);
  }
  debounceTimers.clear();
}

export function onHistoryChange(callback: HistoryChangeCallback): void {
  historyChangeListeners.add(callback);
}

export function offHistoryChange(callback: HistoryChangeCallback): void {
  historyChangeListeners.delete(callback);
}

export function onSessionChange(callback: SessionChangeCallback): void {
  sessionChangeListeners.add(callback);
}

export function offSessionChange(callback: SessionChangeCallback): void {
  sessionChangeListeners.delete(callback);
}
