# review ranking round 3

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R2-1 | fixed | server/core/ranking/tests/withdrawal.test.ts:50-63 caches `GetRankingTop` (board `[rk_sum]`, offset 0, limit 10, `ranking.topCacheMs` 10000) on the test server's instance with both users, runs `remove_user` on that instance, and asserts at the cache time and at `topCacheMs` - 1 ms after it that the same query holds only the remaining user. Restored defect: in a `git worktree add --detach` of HEAD 4bfca911, the `modules.storage.after_commit(ctx, () => { core.top_cache.clear(); })` of server/core/ranking/index.ts:89-91 was removed; `ogw core test server ranking --file server/core/ranking/tests/withdrawal.test.ts` (job mw80hgooa4b7ed) failed this test on SQLite and PostgreSQL (`expected [ Array(2) ] to deeply equal [ <b> ]` at the first read after the removal) and no other test of the file |
| R2-2 | fixed | server/core/ranking/tests/withdrawal.test.ts:65-84 caches the query on a peer instance (`start_peer`) at `cached_at`, runs `remove_user` on the test server's instance, reads the peer at `cached_at + topCacheMs/2` and asserts at `cached_at + topCacheMs` that the peer holds only the remaining user (the test clock is shared with the peer, server/core/testing/dev/index.ts:137). Restored defect: in a `git worktree add --detach` of HEAD 4bfca911, a cache hit in `cached_top` (server/core/ranking/query.ts:134) was made to set `hit.expires_at = now + top_cache_ms`; the same `ogw core test` run (job mw80hh164a85e0) failed this test on SQLite and PostgreSQL (`expected [ Array(2) ] to deeply equal [ <b> ]`) and no other test of the file |

## out of scope

none

## debt

none

## must fix

none

## unknown

- In the commit range the ranking module changed only in server/core/ranking/tests/withdrawal.test.ts; no ranking implementation code changed. The other changes of the range (server/core/routing/tests/process_support.ts, server/core/routing/tests/server-process.test.ts, records of other targets) are routing tests and review records, outside this target, and were not reviewed
- The whole ranking suite was run on unchanged HEAD 4bfca911 (`ogw core test server ranking`, job mw80hhfdaa3598): pass. The core tests of the modules that depend on ranking were not run in this review
- The new tests do not cover a clear of the own instance's cache that runs before the commit instead of after it (ranking.md:180) under a concurrent `GetRankingTop`; no concurrent run path was checked
