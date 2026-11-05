# review idempotency round 1

## findings

none

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The commit range 51d323b..995b200 changes no file under `server/core/idempotency/`. The changes reviewed for their effect on idempotency are those of the modules it calls and of its callers: `server/core/storage/` (`mark_broken` and `broken_by` in `core.ts`, the `body` and `run_savepoint` handling of a broken transaction and `lock_row` in `tx.ts`, the U+0000 string parameter failure in `db/sqlite.ts`, `get_states`, `get_user_records`, `in_id_list`, the `user_change.ts` phase read failure) and `server/core/routing/http.ts` and `pipeline.ts` (client IP text). None of them changes what `find_response`, `find_committed_response`, `save_response`, `save_withdrawn_response`, `find_withdrawn_response`, `has_response` or `claim_notify` give, which statements they run, or the request ID that routing passes (still UUID v4 checked in `server/core/routing/http.ts:44`, so it cannot hold U+0000)
- `server-time` has no change in the range
- The callers of `claim_notify` (`server/core/iap/notify.ts`, `server/core/ads-reward/callback.ts`, `server/core/ads-reward/index.ts`) and the routing calls in `server/core/routing/pipeline.ts:559`, `:574`, `:637`, `:663`, `:689`-`:690` were read only for how they call idempotency; their own behavior is the review target of those modules
- `ogw core test server idempotency` passed (two module runs reported `pass`); the output does not name the DB of each run, so which DB kinds ran was not checked
