# review nickname round 3

## findings

none

## previous

none

## out of scope

- server/core/nickname/tests/set-nickname.test.ts:4: medium `structure`: the test imports `lock_key` from `../../storage/tx.ts`, an internal file of `storage` that is not its public API, and passes `lock_key('nickname_claim', [normalizeText(...)])` to `hold_lock_key` (lines 60, 92). The testing spec gives `testing.game_row_lock_id`(table name, key value) (exported from server/core/testing/dev/index.ts:32) for exactly this key. The same import is at server/core/nickname/tests/admin.test.ts:2 (used at line 65). It dates from the initial commit 301b3dd and the range does not change it

## debt

none

## must fix

none

## unknown

- In the range d867e63..c25128c nothing under server/core/nickname/ changed, and neither did the dependency modules (`item-ledger`, `validation`, `storage`, `server-time`, `logging`) or `testing/dev`. The range changes server code only in ads-reward, block-report, coupon, gacha, guild, mission, public-profile, auth tests, testing/tests and settings/core-settings.schema.json. So the review covered only how the spec changes in the diff relate to server/core/nickname/index.ts and its tests.
- Spec changes checked against nickname: the `lock_game_row` PostgreSQL advisory lock key and the rule that a module passes each key column with the same TypeScript type (nickname always passes the `string` normalized value at index.ts:202, and storage/tx.ts:357 already derives the key by the SHA-256 rule); `lock_game_row` `FAILED` on SQLSTATE `55P03`/`40P01`/`40001` or a connection end (index.ts:267 returns `INTERNAL`, index.ts:325 returns `internal`, as the nickname error table says); the `read_db` throw rules (nickname's production code reads only with `db(ctx)` and `db(tx)`); `Recovery`/`Overflow` source and `read_amount`/`INVALID_AMOUNT` of `item-ledger` (nickname passes source `Nickname` and data-built `nickname_cost` amounts to `subtract_items`, index.ts:240); the new `get_states` and `get_user_records` (not used by nickname); the `logging` and log common-field changes (nickname writes no log of its own). None of them makes the nickname code or tests differ from the definitions.
- The tests were not run in this round: no code that nickname runs or imports changed in the range, and round 2 recorded 34 of 34 nickname tests passing on SQLite and PostgreSQL on the same code.
- A real PostgreSQL deadlock or `pg_terminate_backend` during the `nickname_claim` lock was not made; the storage paths that turn them into `FAILED` were not read in this round.
