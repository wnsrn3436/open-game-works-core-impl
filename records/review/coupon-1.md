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

- Commit range 0a740b8b..75e3534 changes coupon only in commit 4cf6c1f: `server/core/coupon/index.ts:401` (the RedeemCoupon audit line moves from `storage.after_commit` to `storage.on_commit`), `CouponStorage` now picks `on_commit` and drops `after_commit`, plus tests in `server/core/coupon/tests/admin.test.ts`, `server/core/coupon/tests/redeem.test.ts` and the new `server/core/coupon/tests/commit-audit.test.ts`. The other files in the range (client modules, ads-reward, guild, records) are not coupon and were not reviewed. `core-spec/storage.json` gains `get_states` and `get_user_records`, which are generated entries for storage operations coupon does not call.
- The on_commit path was checked by reading `server/core/storage/tx.ts:78` (`run_on_commit` runs right after `commit` and before `run_after`, with no stop check) and `server/core/storage/tx.ts:95` (`run_after` returns once phase is `stopped`). The audit is registered after the step 7 hook, as the spec orders. A hook that throws or hands back a value returns `INTERNAL` before the audit is registered, so a failed redeem writes no audit line.
- Whether `commit-audit.test.ts` fails on the old `after_commit` code was worked out from the code path, not run: the gate `after_commit` function holds the after-commit job until `m.stop()` sets storage phase `stopped`, so an audit function queued after the gate would be skipped. No defect was restored in a temporary copy, because round 1 has no `test evidence` finding to judge.
- The test uses the stop() of the module set in `server/core/coupon/tests/modules.ts`, which runs storage `stop()`. It does not use `routing` `stop()`, the name in the spec's test item. `routing` was not read to confirm that its `stop()` reaches storage `stop()` the same way.
- New tests were checked against the code they cover. `max_uses` -1 with the valid code `MINUS1` fails only on `input.max_uses >= 0` (`server/core/coupon/index.ts:446`). A unique `code` of `" - "` fails only because `input.code === ''` checks the code as given. With 7 random 12-character codes, `after_code` `ab` is empty only when the bound is not normalized. The `10_000` timeouts removed from two admin tests now fall back to the 60 s default `testTimeout` of the ogw server test run, which is a longer limit.
- `ogw core test server coupon` was run on this checkout and passed (output `coupon pass` twice). The rest of coupon, which this range did not change, was not reviewed again.
