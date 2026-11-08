# review ranking round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | correctness | medium | server/core/ranking/index.ts:89 | `remove_user` clears `core.top_cache` with `storage.after_commit` only in the server instance that ran the withdrawal (`top_cache` is a per-instance `Map`, server/core/ranking/index.ts:75, server/core/ranking/core.ts:57). Commit 6ac30088 of the range makes every server process run `routing.requestWorkers` request workers, each a server instance with its own caches (routing spec `### server process`: "each worker thread has its own caches"), and settings/core-settings.json:527 sets `routing.requestWorkers` to 2. Run path: user U is in the top 10 of a board; a `GetRankingTop` (offset 0, limit 10) handled by request worker B fills B's cache; U withdraws (`auth` `Withdraw` → `ranking.remove_user`) on request worker A, which clears only A's cache; a `GetRankingTop` with the same offset and limit within `ranking.topCacheMs` (10000 ms by default) that the front hands to B returns the cached list with U's entry, user ID and nickname (server/core/ranking/query.ts:133-134). This differs from ranking spec `## behavior` withdrawal "A deleted user is not in query results" and `## test` "After `remove_user`, that user is not in query results", and from routing spec `### server process` "the request worker that handles a request does not change its result": whether the deleted user is shown now depends on the request worker. Before the range this happened only across several server processes; now it happens inside one default server process | State in the ranking spec that a `GetRankingTop` result cached by another server instance may still hold a removed user until `ranking.topCacheMs` after it was cached (and adjust the `## test` item), or make the cache invalidation reach every server instance (e.g. a cache key that includes a value read from saved state that `remove_user` changes) | yes | 80 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The ranking module code and tests did not change in the commit range 85f6b36d..fa8bbd7c. The review covered the range changes of the modules that ranking calls or that call it: `storage` (seed provider called in `open_user` before the ctx, `make_seed`, DB meter, SQLite WAL retry at open), `item-ledger` (append-only history with a history counter, `item-ledger.onceKeyRetentionMs`), `logging` (metrics, `read_metrics`), `routing` (server process with request workers, front link, settings check at `create_server`, `min_version`), `testing` test server. Apart from R1-1, none of them changes a result of ranking: ranking's out-of-request `run_user_transaction` passes no request fields, so the seed provider is not called; the mailbox `once_key` that keeps season rewards to one mail per user is the `mailbox_once_key` table, not the `item_ledger_once_key` table whose retention changed; the ranking settings keys exist in settings/core-settings.schema.json with the minimums of the spec (`ranking.seasonCheckIntervalMs` minimum 1); the ranking core rpc requests have no string field, so the validation `nul` rule does not reach them; several request workers running job `ranking_season` on one DB are covered by the season lease, the same as several server processes
- `ogw core test server ranking` (job mw7wvy2tac48ed) passed. Whether its PostgreSQL tests (`testing.hold_db` of the `ranking_season` row, server/core/ranking/tests/reward.test.ts:294, server/core/ranking/tests/dev.test.ts:116) ran on PostgreSQL in that run, or were skipped for lack of a PostgreSQL server, was not checked
- R1-1 was checked by reading the code paths; it was not reproduced with a server process of two request workers, because the review writes no test file
- `mailbox`, `server-time`, `live-event`, `guild` and `nickname` implementation code did not change in the range (only server/core/guild/tests/query.test.ts) and was not reviewed again
