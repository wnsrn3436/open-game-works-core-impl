# review push round 3

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

- `git diff --stat 219d5b18..e4eeb273 -- server/core/push` is empty: no push code or test changed in the commit range, so the review covered the push code that the definitions changed in `## spec changes` reach
- push.md change (admin operation collection and handling follow `admin-api`): push gives its admin operations to `admin-api` with `audit_args: null` (server/core/push/schedule.ts:118, :137) and writes no audit or `actor` field itself, so the `logging` `audit` `actor` change does not reach push code
- storage.md transaction changes: every push transaction function (server/core/push/send.ts:343, :369, :409, :463, :522, :547, :581, :590) lets throws out and catches nothing, so a PostgreSQL abort ends the transaction as `FAILED`. A lock or connection `DbError` is `FAILED` (server/core/storage/db/types.ts:92, server/core/storage/tx.ts body), which the push write retry at server/core/push/send.ts:331-336 relies on. `lock_game_row` `FAILED` throws at server/core/push/schedule.ts:66, as the push `## error` row says
- storage.md `read_db` change (a failing statement throws): push `read_db` reads (server/core/push/send.ts:426, :497, :567, :577, :607) throw out of `run`, and `push_send_job` logs the throw (server/core/push/send.ts:634-646). A `SENDING` record stays under its lease and is taken again after `lease_until`. Checked by reading the code only
- storage.md new rule that a statement whose `string` parameter holds U+0000 fails: `RegisterPushToken` `device_token` (server/core/push/schedule.ts:33-45) and a content-supplied `queue_push` `dedupe_key` are not checked for U+0000, so such input throws and the request is `INTERNAL`. push.md lists no U+0000 check for either, so this follows the defining documents and is not a finding
- `run_user_changes`, `get_user_records`, `get_states`, `replace_game_rows`, the `logging` request-line fields, the truncated IP format and the core SKILL / command changes are not used by push
- No test was run: this worktree has no `server/node_modules`, and there is no finding to check and no restored defect to run
