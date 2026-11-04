# review: friend, round 1

## findings

none

## previous

none

## out of scope

- server/core/friend/index.ts:282: medium On PostgreSQL, exceeding the lock wait on a `friend_count` row in a core rpc leaves no line of `kind` `error`, while `open-game-works-core/skills/server-core/modules/friend.md:163` says `routing` leaves an `error` log. The same return is at `server/core/friend/index.ts:312` (`SendFriendRequest`) and `:350` (`AcceptFriendRequest`); line 282 is `drop`, used by decline, cancel and remove. The handler returns `CORE_ERROR_INTERNAL` as a value, and `finish` in `server/core/routing/pipeline.ts` calls only `fail` for it, without `error_log`. Reproduced with a scratch test on PostgreSQL with `storage.userLockWaitMs` 300: holding the target's `friend_count` row with `hold_game_row_lock` and sending `SendFriendRequest` or `RemoveFriend` gave `INTERNAL` and exactly one log line, `kind` `request` at level `error`. `BlockUser` under the same hold throws at `server/core/friend/index.ts:301` and leaves a line of `kind` `error` with a stack trace plus the `request` line, and the two rows of the spec use the same words. So an operator sees that the request failed but not that a lock wait caused it. No friend test reads a log. The code is older than the range and the range does not touch it

## debt

none

## must fix

none

## unknown

- Scope checked: the range changes nothing in `server/core/friend/`, `proto/` or `core-spec/friend.json`, and input `## spec changes` is `none`. The changes that reach friend are `block-report.remove_user` (takes the `block_report_sequence` lock, can return `FAILED`), `add_report` (reads `is_active_user` after that lock), `FallibleRemoveUser` in `server/core/auth/deps.ts` and the schema minimums. None of them produced a friend finding
- Rollback, checked by a scratch test in a temporary worktree, removed afterwards: user A with a friend, a sent request and a received request, and a guest with a friend, while another connection held `block_report_sequence` past `storage.userLockWaitMs`. `Withdraw` and `ConfirmAge` gave `INTERNAL`, `withdraw_user` and `POST /account/deletion` gave 500. Every `friend_link` row, `friend_count` row and `withdrawn_at` of all five users equalled the values before. After the release `Withdraw` succeeded, A's rows were gone and the counts of the other users were right. The log of the run shows `postgresql` and `sqlite` both ran
- On SQLite the holder holds the whole database, so that scratch run and the log scratch run failed at `rate counter transaction failed`, before any friend code. Only the PostgreSQL run exercises the friend paths
- `auth_guest_sweep` in that scratch test: the guest and its rows stayed, but the test does not show that the sweep reached `remove_user`, because `server/core/auth/guest_sweep.ts:24` was not observed directly
- Lock cycle: checked by reading, not by a test that runs a withdrawal and a report concurrently. `server/core/auth/withdraw.ts:16` runs `friend` before `block-report`, so a withdrawal takes `friend_count` and then `block_report_sequence`. `friend_count` is locked only at `server/core/friend/index.ts:252`, `:253` and `:403`, in core rpc handlers, the block listener and `remove_user`. A hook `on_friend_changed` that calls `add_report` takes the two locks in the same order. `routing` has no hook that runs before a core rpc handler, so no path takes `friend_count` after `block_report_sequence`. While a withdrawal waits for `block_report_sequence` it keeps its `friend_count` rows, so a friend rpc on those rows can reach its own lock wait and end with `INTERNAL`. This was not run, and it follows the failure the spec sets
- Settings: the friend keys in `settings/core-settings.schema.json` did not change. `friend.*` at minimum 0, and `nickname.maxLookupCount` and `public-profile.maxRequestCount` at minimum 1, pass the checks of `create_friend` (read, not run)
- Whether `friend.md:163` means a line of `kind` `error` or accepts the level `error` `request` line that `logging` sets for any request ended with `INTERNAL`: the out of scope line reads it as `kind` `error`, from the same words in the `BlockUser` row and that row's behavior. No defining document states it outright, and step 15 of `routing` sets no log for a returned `CoreError`. The fix may be a change of that row instead of the code
- `open-game-works-core/skills/server-core/modules/guild.md:297` has the same log row. `guild` is outside this target and was not checked
- `records/review-debt/friend.json` has items `D1` to `D5`, all older than the range. Input `## debt` is `none`, so they were not decided here, were not checked again and are not repeated in `## out of scope`
- Run: `ogw core test server friend` passed on both databases. The two scratch tests passed through `--file` runs of `auth` and `friend`. The whole server suite and the rest of `server/core/auth/tests/` were not run
- `server/core/friend/tests/` was not checked by restoring defects in a temporary copy, since no finding needs it
- The rest of the friend code was read only for problems the range could cause, not as a review of the whole target. The client core changes, `server/core/iap/`, `server/core/matchmaker/` and `server/core/p2p-signaling/` in the range were not read: friend does not depend on them
