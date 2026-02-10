---
status: complete
priority: p1
issue_id: 001
tags: [code-review, runtime, streaming, regression, multi-source]
dependencies: []
---

# Non-Claude conversation streaming drops live updates after initial load

## Problem Statement

Live updates for `factory`, `codex`, and `pi` sessions stop after the first payload. The UI receives the initial messages, but subsequent session updates are empty.

This is a merge-blocking behavior regression for active non-Claude sessions.

## Findings

- `api/storage.ts:1272-1276`:
  - non-Claude stream path returns all messages once with `nextOffset: 1`
  - any follow-up call with `fromOffset > 0` returns empty payload immediately
- Evidence:
  ```ts
  // For non-Claude sources, return all messages at once (no streaming optimization)
  if (entry && entry.source !== "claude") {
    if (fromOffset > 0) return { messages: [], nextOffset: fromOffset };
    const messages = await getConversation(sessionId);
    return { messages, nextOffset: 1 };
  }
  ```

## Proposed Solutions

### Option A (Recommended): message-count offset for non-Claude
- **Approach:** Treat `fromOffset` as count of already-sent messages for non-Claude sources.
- **Behavior:** on each update, reload conversation, return `messages.slice(fromOffset)`, set `nextOffset = totalCount`.
- **Pros:** Correct incremental behavior; simple mental model.
- **Cons:** Re-reads full file per update.
- **Effort:** Small
- **Risk:** Low

### Option B: byte offset streaming for all sources
- **Approach:** Implement low-level file offset streaming for factory/codex/pi formats too.
- **Pros:** Potentially better large-file efficiency.
- **Cons:** More complex parser/state handling.
- **Effort:** Large
- **Risk:** Medium

### Option C: disable streaming for non-Claude explicitly
- **Approach:** Keep polling fallback and disable stream updates for these sources.
- **Pros:** Fast patch.
- **Cons:** UX regression remains (not acceptable for current product goals).
- **Effort:** Small
- **Risk:** High (functional degradation)

## Recommended Action

Use **Option A** immediately and add tests for incremental non-Claude updates.

## Technical Details

- Affected file: `api/storage.ts`
- Affected route flow: `/api/conversation/:id/stream` via `getConversationStream()`
- Sources impacted: `factory`, `codex`, `pi`

## Acceptance Criteria

- [x] Non-Claude sessions receive new messages after initial stream payload.
- [x] No duplicate messages on reconnection.
- [x] Streaming still works for Claude sessions unchanged.
- [ ] Regression test added for non-Claude incremental updates. (deferred)

## Work Log

- 2026-02-10: Identified regression in non-Claude offset branch during code review.
- 2026-02-10: Implemented message-count offset incremental streaming for non-Claude sources (`slice(fromOffset)` + `nextOffset = messages.length`).
- 2026-02-10: Verified behavior with live smoke checks for incremental retrieval.

## Resources

- `api/storage.ts:1272-1276`
- Related user symptom: “session updates / streaming stuck for active sessions”
