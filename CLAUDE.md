# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Agents Run is a web UI for browsing AI coding tool conversation history. It reads from `~/.claude/`, `~/.codex/`, and `~/.gemini/` to present conversations from Claude Code, Codex CLI/Desktop, and Gemini CLI in a unified real-time streaming interface.

## Tech Stack

- **Backend**: Node.js 20+, Hono web framework, TypeScript (ES modules)
- **Frontend**: React 19, Vite 6, Tailwind CSS 4
- **Package Manager**: pnpm (required)

## Development Commands

```bash
pnpm install             # Install dependencies
pnpm dev                 # Web on port 12000, API on port 12001
pnpm dev:web             # Vite dev server only (port 12000)
pnpm dev:server          # API server with watch mode (port 12001)
pnpm build               # Build both server and web
pnpm build:web           # Vite production build -> dist/web/
pnpm build:server        # tsup build -> dist/index.js
pnpm start               # node dist/index.js
```

No test suite exists. Use `pnpm build` to verify changes compile.

## Architecture

### Multi-Provider System

The backend uses a provider adapter pattern to support multiple AI tool data sources:

- **`api/provider-types.ts`** — `ProviderAdapter` interface and `ProviderName` type (`"claude" | "codex" | "gemini"`)
- **`api/providers.ts`** — `ProviderManager` singleton that auto-detects available providers at startup and delegates all operations. Exported as `providerManager`.
- **`api/storage.ts`** — Claude Code adapter (also defines shared types: `Session`, `ConversationMessage`, `ContentBlock`, `StreamResult`, `SessionMeta`, `SearchResult`)
- **`api/codex-adapter.ts`** — Codex CLI/Desktop adapter (reads `~/.codex/sessions/` JSONL files)
- **`api/gemini-adapter.ts`** — Gemini CLI adapter (reads `~/.gemini/tmp/*/chats/session-*.json` JSON files)
- **`api/pricing.ts`** — Token pricing data for all providers (Claude, OpenAI/Codex, Gemini). `findPricing(modelId)` for lookup, `ModelPricing` interface for per-model prices (input, output, cacheWrite5m, cacheWrite1h, cacheRead, longContext).

Each adapter implements: `init()`, `getSessions()`, `getConversation()`, `getConversationStream()`, `getSessionMeta()`, `searchConversations()`, `ownsSession()`, `resolveSessionId()`, and cache invalidation methods.

**Session routing**: `providerManager.findAdapter(sessionId)` checks each adapter's `ownsSession()` (file index lookup) to route requests to the correct provider.

### Data Source Differences

| | Claude | Codex | Gemini |
|---|---|---|---|
| **Directory** | `~/.claude/` | `~/.codex/` | `~/.gemini/` |
| **File format** | JSONL | JSONL | JSON (not JSONL) |
| **Session index** | `history.jsonl` | `session_index.jsonl` | None (scan `tmp/*/chats/`) |
| **Stream offset** | byte offset | byte offset | message index |
| **Token data** | per-message usage | `token_count` events (cumulative) | per-message tokens |
| **Rename/Delete** | supported | not supported (returns 400) | not supported (returns 400) |
| **Resume** | `claude --resume` | `codex resume` | `gemini resume` |

### Server Layer (`api/server.ts`)

Hono HTTP server. All data routes go through `providerManager` except subagent endpoints (Claude-only).

**Init sequence** (in `start()`, strictly ordered):
1. `providerManager.init()` — initializes all adapters, builds file indexes
2. `initWatcher()` + `startWatcher()` — Claude file watcher
3. `onHistoryChange/onSessionChange` — Claude watcher listeners
4. `addWatchTarget()` for each non-Claude adapter — separate chokidar instances
5. HTTP `serve()`

Key endpoints:
- `GET /api/providers` — list available providers with session counts
- `GET /api/sessions?provider=` — all sessions, optional provider filter
- `GET /api/sessions/stream?provider=` — SSE with `sessions`, `sessionsUpdate`, `sessionsRemove` events
- `GET /api/conversation/:id/stream?offset=` — SSE with `{messages, nextOffset}` payload
- `GET /api/conversation/:id/meta` — combined token usage, model ID, and subagent info
- `POST /api/search` — body: `{query, provider?}`
- `DELETE /api/sessions/:id` — Claude only (400 for others)
- `POST /api/sessions/:id/rename` — Claude only (400 for others)

### File Watching (`api/watcher.ts`)

- Claude uses the built-in watcher (`startWatcher()`)
- Non-Claude providers use `addWatchTarget(paths, depth, callback)`
- Callbacks call `emitSessionChange()` / `emitHistoryChange()` to trigger SSE
- `resolveSessionId(filePath)` maps file paths back to session IDs; returns null for index files (triggers list refresh instead)

### Frontend (`web/`)

- **`web/app.tsx`** — Main layout, provider filter dropdown (shown when >1 provider), session header with provider-aware rename/resume
- **`web/components/session-list.tsx`** — Virtualized list with title/content search, CLI provider badges for non-Claude sessions, delete button Claude-only
- **`web/components/session-view.tsx`** — Conversation viewer with SSE streaming, `TokenUsageBar` (Claude, model-aware pricing), `GenericTokenUsageBar` (Gemini/Codex, with costs when pricing available). Uses `findPricing()` from `api/pricing.ts` to dynamically resolve per-model token prices.
- **`web/components/message-block.tsx`** — Message rendering with tool icons/previews for Claude, Codex (`exec_command`), and Gemini (`read_file`, `replace`, `write_file`) tool names
- **`web/utils.ts`** — `getProviderInfo(model)` for model badges, `getCliProviderInfo(provider)` for CLI tool badges

### Key Implementation Details

- **ES modules only** (`"type": "module"` in package.json)
- **Path alias**: `@agents-run/api` resolves to `api/storage.ts` (configured in `web/vite.config.ts`). Frontend imports types from this alias.
- **CLI entry**: `api/index.ts` uses commander.js
- **Production**: Web assets built to `dist/web/`, served by Hono's serveStatic
- **SSE heartbeat**: 30 seconds on all SSE connections
- **Session deduplication**: Frontend uses `message.uuid` to deduplicate streamed messages
- **Codex UUIDs**: Deterministic `codex-${sessionId}-${lineIndex}` since Codex messages lack native UUIDs
- **Gemini `displayContent`**: Preferred over `content` for user messages (avoids showing embedded file contents)
- **Lazy rescan**: Non-Claude adapters set `rescanPending` flag on cache invalidation; actual disk rescan happens on next `getSessions()` call
