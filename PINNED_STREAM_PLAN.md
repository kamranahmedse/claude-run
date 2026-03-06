# Pinned Conversations Stream Plan

## Stream
- Branch: `codex/ux-pinned-conversations`
- Worktree: `D:\github\claude-run-worktrees\pinned-conversations`
- Base: `codex/ux-integration`

## Goal
Add first-class pinned conversations in the session list so users can keep key threads at the top without breaking chronology sorting.

## Scope
- Add pin/unpin action on each session row.
- Persist pinned session IDs in local storage.
- Render a dedicated `Pinned` section at the top of the list.
- Keep all current sort/filter/search behavior for non-pinned sessions.
- Ensure keyboard and screen-reader accessibility for pin actions.

## Out of Scope
- Server-side synced pins.
- Multi-device pin state sharing.
- Complex pin metadata (notes/tags/colors).

## Primary Files
- `web/components/session-list.tsx`
- `web/app.tsx` (only for optional wiring if needed)
- `web/utils.ts` (if storage helpers are needed)

## Conflict Guardrails
- Do not edit `api/*` in this stream.
- Do not alter conversation rendering components.
- Keep chronology logic (`lastUpdatedAt`) intact.

## Validation
- `pnpm build`
- Manual checks:
  - Pin/unpin persists after refresh.
  - Pinned sessions stay topmost across sort modes.
  - Search/filter applies to pinned and unpinned sections consistently.
  - Keyboard navigation still works with pinned section present.
