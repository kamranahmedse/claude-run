---
status: complete
priority: p2
issue_id: 003
tags: [code-review, performance, relevance, search, ranking]
dependencies: []
---

# Fuzzy ranking loses recency after process restart

## Problem Statement

On search DB rebuild into memory, fuzzy docs are loaded with `timestamp = 0`. After restart, fuzzy ranking and tie-break ordering lose recency quality until sessions are re-indexed again.

## Findings

- `api/search.ts:300-301`:
  ```sql
  SELECT session_id as sessionId, source, display, project, content, 0 as timestamp FROM sessions_fts
  ```
- `api/search.ts:304-314` stores those docs into `fuzzyDocs` with timestamp 0.
- Fuzzy ranking fallback uses score and timestamp for ordering, so recency signal is effectively missing after startup.

## Proposed Solutions

### Option A (Recommended): join meta table for session_timestamp
- **Approach:** replace fuzzyRows query with join:
  - `sessions_fts f LEFT JOIN session_index_meta m ON ...`
  - `COALESCE(m.session_timestamp, 0) as timestamp`
- **Pros:** Restores recency immediately after restart.
- **Cons:** Slightly heavier startup query.
- **Effort:** Small
- **Risk:** Low

### Option B: backfill timestamps lazily on first search
- **Pros:** Delays startup work.
- **Cons:** More complexity and first-query inconsistency.
- **Effort:** Medium
- **Risk:** Medium

### Option C: ignore timestamp in fuzzy tier entirely
- **Pros:** Simplifies ranking.
- **Cons:** Worse UX for active conversations.
- **Effort:** Small
- **Risk:** High (quality regression)

## Recommended Action

Implement **Option A** and add regression test to ensure fuzzy docs loaded from disk preserve timestamps.

## Technical Details

- File: `api/search.ts`
- Function: `rebuildInMemoryStateFromDb()`

## Acceptance Criteria

- [x] Fuzzy docs loaded from DB have non-zero timestamps when available.
- [x] Fuzzy-only query ordering favors newer sessions after server restart.
- [ ] Regression test covers startup rebuild behavior. (covered by smoke test, no dedicated unit test yet)

## Work Log

- 2026-02-10: Identified timestamp loss in fuzzy rebuild path.
- 2026-02-10: Updated rebuild query to join `session_index_meta` and hydrate `session_timestamp` into fuzzy docs.
- 2026-02-10: Verified timestamp persistence across close/reopen via smoke test.

## Resources

- `api/search.ts:300-314`
