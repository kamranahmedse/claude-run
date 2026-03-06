# Claude Run UX/UI Implementation Plan

## Objectives
- Deliver UX wins quickly without destabilizing real-time streaming behavior.
- Parallelize implementation across isolated worktrees and branches.
- Minimize merge conflicts via strict file ownership and staged integration.

## Worktree Topology
- `main` repo: `D:\github\claude-run`
- Integration branch: `codex/ux-integration`
  - `D:\github\claude-run-worktrees\integration`
- Stream branches:
  - `codex/ux-foundation-shell`
    - `D:\github\claude-run-worktrees\foundation-shell`
  - `codex/ux-session-list`
    - `D:\github\claude-run-worktrees\session-list`
  - `codex/ux-conversation-view`
    - `D:\github\claude-run-worktrees\conversation-view`
  - `codex/ux-a11y-mobile`
    - `D:\github\claude-run-worktrees\a11y-mobile`
  - `codex/ux-backend-platform`
    - `D:\github\claude-run-worktrees\backend-platform`

## Stream Ownership (Conflict-Minimizing)
### Stream A: Foundation + Shell (`codex/ux-foundation-shell`)
Scope:
- Session auto-select on first load.
- Persisted state (`selected session/project`, sidebar collapse).
- URL deep-linking for selected session.
- Header/status scaffolding for connection and errors.

Primary files:
- `web/app.tsx`
- `web/hooks/use-event-source.ts`
- `web/utils.ts`

Do not edit:
- `web/components/session-list.tsx`
- `web/components/session-view.tsx`
- `api/*`

### Stream B: Session List UX (`codex/ux-session-list`)
Scope:
- Search highlight.
- Time grouping labels (Today/Yesterday/This Week).
- Quick filters and sort controls.
- Keyboard navigation in session list (up/down/enter).

Primary files:
- `web/components/session-list.tsx`
- Optional helper extraction:
  - `web/utils.ts` (only if coordinated and rebased after Stream A)

Do not edit:
- `web/app.tsx` (except minimal prop wiring if strictly required)
- `api/*`

### Stream C: Conversation UX (`codex/ux-conversation-view`)
Scope:
- Find in conversation.
- Better truncation UX (Show more/Show all).
- Auto-expand tool errors, keep success concise.
- Message metadata (timestamp/model/usage where available).

Primary files:
- `web/components/session-view.tsx`
- `web/components/message-block.tsx`
- `web/components/markdown-renderer.tsx`
- `web/components/tool-renderers/*` (as needed)

Do not edit:
- `web/components/session-list.tsx`
- `api/*` unless blocked by metadata availability

### Stream D: A11y + Mobile (`codex/ux-a11y-mobile`)
Scope:
- Responsive mobile sidebar (drawer behavior).
- Keyboard focus states and ARIA labels.
- Contrast and typography readability improvements.
- Density/font-size toggles.

Primary files:
- `web/index.css`
- `web/app.tsx` (layout behavior only)
- `web/components/*` for ARIA/focus hooks

Do not edit:
- `api/*`

### Stream E: Backend + Platform (`codex/ux-backend-platform`)
Scope:
- Windows path handling for project names.
- API support for stronger UI states where needed.
- Optional session metadata shaping for frontend consumption.
- Any non-breaking backend quality improvements required by streams.

Primary files:
- `api/storage.ts`
- `api/server.ts`
- `api/watcher.ts` (only if required)

Do not edit:
- Visual/UI component styling

## Delivery Phases
### Phase 1 (Quick Wins)
- Auto-select latest session.
- Persist selected state.
- API/SSE error state with reconnect indicator.
- Absolute timestamp tooltip.
- Mobile-safe sidebar behavior.
- Resume command shell-safe copy variants.

### Phase 2 (Medium)
- Search highlight in session list.
- Conversation in-view search.
- Tool result expand/collapse improvements.
- Keyboard shortcuts and navigation.
- URL deep-linking and restore behavior.

### Phase 3 (Advanced)
- Session grouping and richer filtering.
- Density controls.
- Optional metadata insights (model/usage).
- Performance hardening for long conversations.

## Merge Strategy
Merge everything into `codex/ux-integration` in this order:
1. Stream E (`backend-platform`)
2. Stream A (`foundation-shell`)
3. Stream D (`a11y-mobile`)
4. Stream B (`session-list`)
5. Stream C (`conversation-view`)

Rationale:
- Backend contracts first.
- App shell state and routing before component-level UX.
- Styling/accessibility before feature-level list/conversation changes.

## Agent Instructions Template
Use this exact protocol per stream:
1. `git fetch origin`
2. `git rebase origin/main`
3. Implement only owned files for your stream.
4. Run:
   - `pnpm install` (if needed)
   - `pnpm build`
5. Commit with stream-scoped message, for example:
   - `feat(ux/session-list): add grouped list and search highlighting`
6. Push branch.
7. Open PR to `codex/ux-integration`.

## Integration Gates
For each merge into `codex/ux-integration`:
1. Rebase branch on latest `codex/ux-integration`.
2. Run `pnpm build`.
3. Smoke test:
   - Session load
   - Stream updates
   - Search/filter
   - Conversation rendering
   - Mobile viewport
4. Merge only if all checks pass.

## Conflict Rules
- Any branch needing cross-stream edits must first request integration approval.
- Shared file hot spots:
  - `web/app.tsx`
  - `web/utils.ts`
  - `web/index.css`
- If two streams need a hotspot file, assign one owner and require others to expose props/hooks instead of editing directly.
