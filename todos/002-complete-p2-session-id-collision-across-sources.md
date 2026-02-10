---
status: complete
priority: p2
issue_id: 002
tags: [code-review, architecture, data-integrity, search, multi-source]
dependencies: []
---

# Search index keys are session_id-only, causing cross-source collision risk

## Problem Statement

The search index schema and in-memory merge logic key by `session_id` only, despite supporting multiple sources (`claude`, `factory`, `codex`, `pi`).

If two sources ever share the same session id, one can overwrite the other in DB/index/results.

## Findings

- `api/search.ts:340-343`
  ```sql
  CREATE TABLE IF NOT EXISTS session_index_meta (
    session_id TEXT PRIMARY KEY,
    source TEXT,
    ...
  )
  ```
- `api/search.ts:515` uses `new Map<string, HybridSearchResult>()` keyed by `sessionId`.
- `api/search.ts:533` and `571` call `merged.set(row.sessionId)` / `merged.set(fuzzyId)`.

This makes source dimension non-authoritative in key identity.

## Proposed Solutions

### Option A (Recommended): composite key `(source, session_id)`
- **Approach:**
  - DB: migrate `session_index_meta` primary key to composite unique key (`source`, `session_id`)
  - In-memory: key merged/fuzzy docs by `${source}:${sessionId}`
- **Pros:** Correctness guaranteed; no silent overwrite.
- **Cons:** Requires migration and small refactor.
- **Effort:** Medium
- **Risk:** Medium

### Option B: namespace session ids before storage
- **Approach:** prepend source in all index keys but keep DB schema largely unchanged.
- **Pros:** Lower migration complexity.
- **Cons:** Easy to miss at call sites; less explicit than composite schema.
- **Effort:** Medium
- **Risk:** Medium

### Option C: document assumption that IDs are globally unique
- **Pros:** No code changes.
- **Cons:** Fragile assumption, no enforcement, latent corruption risk.
- **Effort:** Small
- **Risk:** High

## Recommended Action

Implement **Option A** with migration + test coverage for duplicate `session_id` across sources.

## Technical Details

- Files: `api/search.ts` (schema + merge maps)
- Potential impact: missing/overwritten search results, incorrect delete/index behavior.

## Acceptance Criteria

- [x] Index allows same `session_id` in different sources without overwrite.
- [x] Search merge map uses source+id identity.
- [x] Regression test proves both source variants are returned.

## Work Log

- 2026-02-10: Flagged collision risk during architecture/data-integrity review.
- 2026-02-10: Implemented source-qualified identity keys (`source:sessionId`) for merged/fuzzy/index tracking.
- 2026-02-10: Migrated `session_index_meta` to composite primary key (`source`, `session_id`) with compatibility backfill.
- 2026-02-10: Added regression test proving same `session_id` from two sources both survive search results.

## Resources

- `api/search.ts:340-343, 515, 533, 571`
