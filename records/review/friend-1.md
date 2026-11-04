# review: friend, round 1

## findings

none

The range changes nothing in `server/core/friend/`, and input `## spec changes` is `none`. The changes that reach friend are `block-report.remove_user` (locks `block_report_sequence`, returns `FAILED`), `block-report.add_report` (reads `is_active_user` after that lock), the `FallibleRemoveUser` type of `block-report` in `server/core/auth/deps.ts`, and the schema minimums with `server/core/routing/tests/settings-minimum.test.ts`. None of them produces a friend problem:

- Lock order: `server/core/auth/withdraw.ts:16` runs `friend.remove_user` before `block-report.remove_user`, so a withdrawal takes `friend_count` rows (`server/core/friend/index.ts:403`), then `block_report_sequence` (`server/core/block-report/index.ts:477`). After that lock it runs only `logging.request_analytics_deletion` and `storage.delete_user`, and neither calls `lock_game_row`. `add_report` takes `block_report_sequence` (`server/core/block-report/index.ts:339`) and no `friend_count` row, and its only core caller outside `ReportUser` is `server/core/chat/index.ts:370`. `BlockUser` takes `friend_count` rows (`server/core/friend/index.ts:301`) and not the sequence row. Only friend locks `friend_count`, and a content handler or hook can lock only `game_state`, so a hook `on_friend_changed` that calls `add_report` takes the two locks in the same order as the withdrawal. No path takes `friend_count` after `block_report_sequence`
- Rollback: `withdraw` stops at the first `FAILED`, and its callers (`server/core/auth/account.ts:73`, `server/core/auth/account.ts:104`, `server/core/auth/admin.ts:31`, `server/core/auth/guest_sweep.ts:24`, `server/core/auth/deletion.ts:206`) end the transaction as a failure, so a `FAILED` of `block-report.remove_user` also undoes what `friend.remove_user` changed in that transaction
- Type: `remove_user` of friend returns `null | 'FAILED'`, which `FallibleRemoveUser` accepts
- Settings: the friend keys in `settings/core-settings.schema.json` did not change. `friend.*` at minimum 0, `nickname.maxLookupCount` and `public-profile.maxRequestCount` at minimum 1 pass the checks of `create_friend`

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- Rollback with friend rows: no test was run in which `block-report.remove_user` is `FAILED` for a user who has friend rows. `server/core/auth/tests/withdraw.test.ts` checks that rollback with a user who has no friend rows, and `server/core/friend/tests/lock-timeout.test.ts` checks a `FAILED` of `friend.remove_user` itself. No scratch test was written for this case. The rollback above comes from reading the callers and the transaction rule of `storage`
- Lock cycle: checked by reading the core callers, not by a test that runs a withdrawal and a report concurrently with friend rows
- `error` log of a lock wait in a core rpc: `open-game-works-core/skills/server-core/modules/friend.md:163` says `routing` leaves an `error` log. `server/core/friend/index.ts:282`, `:312` and `:350` return `INTERNAL`, and `finish` in `server/core/routing/pipeline.ts` then writes no entry of kind `error`, only the `request` log, whose level `logging` sets to `error` for a request that ended with `INTERNAL`. Whether that `request` log is what the spec means was not settled, so it is not written as a problem. The code is older than the range, and no friend test checks this log
- `records/review-debt/friend.json` has items `D1` to `D5`, all older than the range. Input `## debt` is `none`, so they were not decided here and are not repeated in `## out of scope`. Reading the current code and tests, without restoring any defect, showed the positions and missing tests they name still in place
- Run: `ogw core test server friend` passed, as did `--file` runs of `server/core/auth/tests/withdraw.test.ts`, `server/core/block-report/tests/withdraw.test.ts` and `server/core/routing/tests/settings-minimum.test.ts`. The job output does not name the database of each run, so this review does not state that PostgreSQL ran. The whole server suite was not run
- `server/core/friend/tests/` was not checked by restoring defects in a temporary copy, since no finding needs it
- The client core changes, `server/core/iap/`, `server/core/matchmaker/` and `server/core/p2p-signaling/` in the range were not read for friend: friend does not depend on them, and the module dependency table in `server/core/routing/spec_tables.ts` lists none of them for friend
