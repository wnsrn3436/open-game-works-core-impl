# review: friend, round 1

## findings

none

The range changes nothing in `server/core/friend/`, `proto/ogw/core.proto` or `core-spec/friend.json`, and input `## spec changes` is `none`. The changes that reach friend are `block-report.remove_user` (takes the `block_report_sequence` lock, can return `FAILED`), `block-report.add_report` (reads `is_active_user` after that lock), the `FallibleRemoveUser` type of `block-report` in `server/core/auth/deps.ts`, and the schema minimums. None of them produces a friend problem:

- Rollback with friend rows: a scratch test in a temporary copy, run on PostgreSQL, gave user A a friend, a received request and a sent request, held `block_report_sequence` past `storage.userLockWaitMs` and sent `Withdraw`. The result was `INTERNAL`, and the link rows, counts and `withdrawn_at` of all four users equalled their values before the request. The same `Withdraw` succeeded after the lock was released. The block ran: a sentinel assert placed in the same PostgreSQL-only block failed in a second run while the other tests of the block passed
- Lock order: `server/core/auth/withdraw.ts:16` runs `friend.remove_user` before `block-report.remove_user`, so a withdrawal takes `friend_count` rows (`server/core/friend/index.ts:403`) and then `block_report_sequence` (`server/core/block-report/index.ts:477`). `add_report` takes `block_report_sequence` (`server/core/block-report/index.ts:339`) and takes no `friend_count` row. Only `server/core/friend/index.ts:252`, `:253` and `:403` lock `friend_count`, in core rpc handlers, the block listener and `remove_user`. Content can lock only `game_state` (`server/core/storage/tx.ts:408`). So a hook `on_friend_changed` that calls `add_report` takes the two locks in the same order as the withdrawal, and no path takes `friend_count` after `block_report_sequence`
- Type: `remove_user` of friend returns `null | 'FAILED'`, which `FallibleRemoveUser` accepts
- Settings: the friend keys in `settings/core-settings.schema.json` did not change. `friend.*` at minimum 0, and `nickname.maxLookupCount` and `public-profile.maxRequestCount` at minimum 1, pass the checks of `create_friend` (`server/core/friend/index.ts:219` onward)

## previous

none

## out of scope

- server/core/friend/index.ts:282: medium On PostgreSQL, exceeding the lock wait on a `friend_count` row in a core rpc leaves no `error` log, while `open-game-works-core/skills/server-core/modules/friend.md:163` says `routing` leaves one. The same return is at `server/core/friend/index.ts:312` and `:350`. The handler returns `CORE_ERROR_INTERNAL` as a value, and `finish` in `server/core/routing/pipeline.ts` calls only `fail` for it, without `error_log`. Reproduced with a scratch test on PostgreSQL: holding the target's `friend_count` row past `storage.userLockWaitMs` and sending `SendFriendRequest` gave `INTERNAL` and exactly one log line for the request, `kind` `request` at level `error`, with no line of `kind` `error`. `BlockUser` in the same condition throws (`server/core/friend/index.ts:301`) and does leave a line of `kind` `error`. `server/core/routing/tests/processing-order.test.ts:154` checks an `error` log as a line of `kind` `error`. So an operator sees that the request failed but not that the cause was a lock wait. No friend test checks this log. The code is older than the range

## debt

none

## must fix

none

## unknown

- Whether the `friend.md:163` row means a line of `kind` `error` or would accept the level `error` `request` line that `logging` sets for any request ended with `INTERNAL`: the out of scope line reads it as `kind` `error`, from the routing test named there and from the `BlockUser` behavior. No defining document states it outright. Fixing it may mean changing that row instead of the code
- Lock cycle: checked by reading the core callers, not by a test that runs a withdrawal and a report concurrently with friend rows
- `withdraw_user`, `POST /account/deletion`, `ConfirmAge` and `auth_guest_sweep` with friend rows while `block_report_sequence` is held: the scratch test ran only `Withdraw`. `server/core/auth/tests/withdraw.test.ts` checks the rollback of these paths with users who have no friend rows
- `records/review-debt/friend.json` has items `D1` to `D5`, all older than the range. This review does not pay debt, and input `## debt` is `none`, so they were not decided here and are not repeated in `## out of scope`
- SQLite: the scratch tests ran only on PostgreSQL. On SQLite a holder of `hold_game_row_lock` holds the whole database, so the request transaction itself fails before friend code runs, and these paths cannot be reached that way
- Run: `ogw core test server friend` passed on both databases, as did `--file` runs of `server/core/block-report/tests/withdraw.test.ts`, `server/core/routing/tests/settings-minimum.test.ts` and `server/core/auth/tests/withdraw.test.ts`. The whole server suite was not run
- `server/core/friend/tests/` was not checked by restoring defects in a temporary copy, since no finding needs it
- The client core changes, `server/core/iap/`, `server/core/matchmaker/` and `server/core/p2p-signaling/` in the range were not read for friend: friend does not depend on them
