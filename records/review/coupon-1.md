# review coupon round 1

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

- The commit range 85f6b36d..fe9ca1d5 changes no file under `server/core/coupon/`. The review covered the changed code that coupon calls: `storage` (`server/core/storage/tx.ts` seed provider moved before ctx creation in `open_user`, `make_seed`, DB meter and `counting_adapter` wrapping of the adapter), `item-ledger` (`server/core/item-ledger/ledger.ts` once-key expiry now `item-ledger.onceKeyRetentionMs`, which does not change the `coupon:<coupon ID>` once-key use since `coupon_redemption` blocks a second use), `logging` (`server/core/logging/index.ts` metrics counting; `write` still truncates the `ip` of a `security` line that `count_redeem_attempt` passes as the client IP), `routing` (`server/core/routing/pipeline.ts` step detail texts, `duration_ms` from the real clock, the min-version judgement; the call of `count_redeem_attempt` in `server/core/routing/spec_tables.ts:68` is unchanged) and the settings files (no coupon key changed). `server-time` and `mailbox` have no changes in the range. None of these changes alters an observable coupon result
- `ogw core test server coupon` passed (both runs reported `coupon pass`) on this checkout. The new multi-process request handling (`server/core/routing/server_process.ts`, `routing.requestWorkers`) was not run with coupon requests spread over several worker instances; coupon keeps no in-memory state and serializes `create_coupon` and step 4 through `storage.lock_game_row`, so its behavior there rests on the `storage` lock across server instances, which is outside this target
- Code of coupon not changed in the range and not reached by the changes above was read but not re-reviewed as a whole target, as the commit range is not `none`
