# review block-report round 1

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

- Runs of this review: `ogw core test server block-report` and `ogw core test server auth` pass on SQLite and PostgreSQL. The other modules that depend on `block-report` (`chat`, `friend`, `matchmaker`, `routing`) were not run. `server/core/chat/index.ts:363` was read for the `add_report` call path and has no change in the range
- Restored defects, run on a temporary copy outside the checkout with `server/core/block-report/tests/withdraw.test.ts` on PostgreSQL only: reading `is_active_user` before the lock fails only `an add_report that waits for the lock of remove_user reads its target as withdrawn`, and taking the lock after the `UPDATE` in `remove_user` fails only `an add_report that holds the block_report_sequence lock makes remove_user of its target wait`. No other mutation of the range was run
- `server/core/auth/tests/withdraw.test.ts:200` (`block-report.remove_user` FAILED): its guest cleanup assertion was checked with one probe on SQLite only, in the temporary copy. With the same settings and no lock held, the sweep withdraws the idle guest, so the assertion does not pass for lack of a sweep. The same probe was not run on PostgreSQL
- Lock order: no deadlock was run between `remove_user` and `add_report`. By reading only, `report_chat_message` takes no `chat_channel` lock before `add_report`, and no core module calls `add_report` while it holds a `guild` lock. A content handler can hold a `game_state` lock when it calls `add_report`; that order was not run
- `server/core/routing/tests/settings-minimum.test.ts` and the schema changes in `settings/core-settings.schema.json` were read only for the `block-report` keys, which the range does not change. That test was not run by this review
- The other changes of the range (`iap`, `RealtimeCore`, `routing`, records) are outside this target and were not read for findings, except `server/core/auth/deps.ts`, `server/core/auth/withdraw.ts`, `server/core/auth/guest_sweep.ts`, `server/core/auth/deletion.ts` and `server/core/auth/tests/withdraw.test.ts`, which call or test the changed code
- `records/review-debt/block-report.json` holds items D1 to D8, but input `## debt` is `none`, so they were not judged and are not repeated in `## out of scope`. The range changes the code that D2 names (`add_report` and a withdrawn target). Whether D2 can be closed is left to the review that receives it as input
