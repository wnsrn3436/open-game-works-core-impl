# review ranking round 2

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R2-1 | spec | medium | server/core/ranking/tests/withdrawal.test.ts:31 | The spec change of this round (open-game-works-core/skills/server-core/modules/ranking.md:180 "the server instance that ran `remove_user` clears its own cache after the commit", and `## test` ranking.md:306 "After `remove_user`, that user is not in query results of the server instance that ran it") makes the clear of the own instance's `GetRankingTop` cache the behavior that keeps a removed user out of that instance's results within `ranking.topCacheMs`. No test goes through it: the only `remove_user` test (withdrawal.test.ts:13-42) calls `GetRankingTop` for the first time after the removal (withdrawal.test.ts:33-34), so the cache is empty when `remove_user` runs, and server/core/ranking/tests/reward.test.ts:472 checks only reward and retry rows. Restored defect: in a `git worktree add` of HEAD 477d25af, the `core.top_cache.clear()` in the `after_commit` callback of server/core/ranking/index.ts:89-91 was removed; `ogw core test server ranking --file server/core/ranking/tests/withdrawal.test.ts` (job mw807u783a192c) passed, so with that defect a `GetRankingTop` (board `[rk_sum]`, offset 0, limit 10) cached before `remove_user` on the same instance returns the removed user's entry for up to 10000 ms (support.ts:127) and no test fails | In withdrawal.test.ts, call `GetRankingTop` on the board before `remove_user` (with `ranking.topCacheMs` above 0), then after `remove_user` assert within `ranking.topCacheMs` that the same `(board, offset, limit)` query on that instance has no entry of the removed user | no | 95 |
| R2-2 | spec | medium | server/core/ranking/tests/withdrawal.test.ts:13 | The `## test` item that the spec change of this round added (open-game-works-core/skills/server-core/modules/ranking.md:306 "A `GetRankingTop` that another server instance cached before the removal no longer holds that user after `ranking.topCacheMs` from when it was cached") has no test. In server/core/ranking/tests/, `remove_user` is called only at withdrawal.test.ts:31 and reward.test.ts:472, and `start_peer` only at reward.test.ts:329 (a season job test); there is no test that caches a `GetRankingTop` on one server instance, runs `remove_user` on another and reads the first instance again; withdrawal.test.ts runs every request on one instance. The test support already has a peer instance (`start_peer`, server/core/ranking/tests/support.ts:153). Run path not tested: instance B caches `GetRankingTop` with the user, instance A runs `remove_user`, B is read at `ranking.topCacheMs` after its cache put; a defect that keeps B's entry past its time for that case (e.g. a cache that refreshes `expires_at` on hit, query.ts:134) is not caught by a test of the withdrawal item | Add a test that caches `GetRankingTop` on one server instance, runs `remove_user` through another (a peer instance), and asserts that the first instance's result no longer holds that user at `ranking.topCacheMs` after it was cached (and, if wanted, that it may still hold it 1 ms before) | no | 85 |

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | The fix direction "state in the ranking spec that a `GetRankingTop` result cached by another server instance may still hold a removed user until `ranking.topCacheMs` after it was cached (and adjust the `## test` item)" was taken: open-game-works-core/skills/server-core/modules/ranking.md:180 now states that exception (naming the request workers of a server process as server instances with their own caches) and ranking.md:306 limits the `## test` item to the server instance that ran `remove_user` plus expiry on others. The code matches the new definition: `remove_user` clears only its own instance's `top_cache` after the commit (server/core/ranking/index.ts:87-92), and every cache entry expires `ranking.topCacheMs` after its put (server/core/ranking/query.ts:134, 140). The missing tests of the new definitions are R2-1 and R2-2 |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The ranking module code and tests did not change in the commit range fa8bbd7c..477d25af. The review covered the spec diff of this round against the ranking code and tests, and the range changes of the modules that ranking calls: `storage` (server/core/storage/db/sqlite.ts DB meter), `logging` (metrics window), `routing` (front link window and pull, `Connection: close` after an unread body, upgrade answers, `min_version` for every token-less rpc) and the `item-ledger.historyRetentionMs` default in settings/core-settings.json. None of them changes a result of ranking: ranking's season job and `remove_user` use `run_user_transaction`/storage handles whose results the meter does not change, ranking has no upgrade route or token-less rpc, and ranking does not read item-ledger history
- `mailbox`, `item-ledger`, `server-time`, `live-event`, `guild` and `nickname` implementation code did not change in the range and was not reviewed again
- Only withdrawal.test.ts was run (with the restored defect for R2-1); the whole ranking suite was not run in this round
- Whether the PostgreSQL tests of ranking (server/core/ranking/tests/reward.test.ts:294, server/core/ranking/tests/dev.test.ts:116) ran on PostgreSQL or were skipped was not checked
