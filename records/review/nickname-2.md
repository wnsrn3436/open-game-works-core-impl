# review nickname round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | New test server/core/nickname/tests/set-nickname.test.ts:85 holds `lock_key('nickname_claim', [normalizeText('Held')])` with `storage.userLockWaitMs` 300 on PostgreSQL while `SetNickname('Held')` runs with a `change_number` 0 cost of 10 and a balance of 10. It asserts `CORE_ERROR_INTERNAL`, empty `item_changes`, no `NicknameUserState`, no `nickname_name` row and balance 10. Restored in a temporary copy of the checkout outside it: server/core/nickname/index.ts:267 changed to `return CoreError.CORE_ERROR_NICKNAME_TAKEN` for `FAILED`. The nickname tests run by the harness `serverModuleTest` (SQLite and PostgreSQL default DB runs, own PostgreSQL 18.6 container) failed this test in both runs: `expected 44 to be 8` |
| R1-2 | fixed | New test server/core/nickname/tests/admin.test.ts:57 holds the `nickname_claim` lock of `Forced` past `storage.userLockWaitMs` 300 during `rename_user`. It asserts status 500 `{"error":"internal"}`, one `audit` line with status 500 and error `internal`, unchanged `NicknameUserState` and `nickname_name` rows, and success of the same `operation_id` after the release. Restored in a temporary copy: index.ts:325 returning `'conflict'` for `FAILED`. The test failed in both runs: `expected { status: 409 } to deeply equal { status: 500 }` |
| R1-3 | fixed | New test server/core/nickname/tests/rules.test.ts:54 sends, for a user inside the cooldown with balance 5 under a change-1 cost of 10, `a` (INVALID), `BadWord` (BANNED), `OWNER` (TAKEN) and `Second` (COOLDOWN), then `Second` after the cooldown (ITEM_NOT_ENOUGH), and asserts the nickname `First` and balance 5. Restored in two temporary copies: (a) the cooldown check moved before the rule check: the test failed in both runs with `{ nickname: 'a', code: 45 }` for expected 42; (b) the cost (index.ts:261-263) moved before the cooldown check: the test failed in both runs with `{ nickname: 'Second', code: 16 }` for expected 45 |
| R1-4 | fixed | server/core/nickname/tests/admin.test.ts:27-33 sets the clock to 1800000000000 before login, advances 5000 ms after `SetNickname`, and matches `changed_at: start_at + 5000n` after `rename_user`, so the request time of `rename_user` differs from the `changed_at` that `SetNickname` wrote. Restored in a temporary copy: index.ts:328 writing `0n`. The test failed in both runs (`expected NicknameUserState{…} to match object { nickname: 'BadWord', … }`) |
| R1-5 | fixed | New tests use Han characters U+20000..U+20004 (outside the BMP) with `nickname.maxLength` 4 and `nickname.allowedScripts` `['Han']`: server/core/nickname/tests/rules.test.ts:38 (one character and five characters are `NICKNAME_INVALID`, four pass), server/core/nickname/tests/lookup.test.ts:59 (`find_user_ids_by_nickname` finds the user with four, empty list with five), server/core/nickname/tests/admin.test.ts:147 (`find_user_by_nickname` 200 with four, 400 with five). Restored in two temporary copies: (a) index.ts:149 `nickname.length < min_length`: rules.test.ts:38 failed in both runs (`expected +0 to be 42`); (b) index.ts:293 `nickname.length > max_length`: lookup.test.ts:59 and admin.test.ts:147 failed in both runs (`expected [] to deeply equal [<user id>]`, `expected { status: 400 } to deeply equal { status: 200 }`) |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | Same as R1-1: set-nickname.test.ts:85 reaches `lock_game_row` `FAILED` in `SetNickname` step 5 and fails when index.ts:267 returns `NICKNAME_TAKEN` |
| D2 | fixed | none | Same as R1-2: admin.test.ts:57 reaches `FAILED` in `rename_user` and fails when index.ts:325 returns `conflict` |
| D3 | fixed | none | Same as R1-3: rules.test.ts:54 fails for the cooldown moved before the rules and for the cost moved before the cooldown |
| D4 | fixed | none | Same as R1-4: admin.test.ts:33 fails when index.ts:328 writes `0n` |
| D5 | fixed | none | Same as R1-5: rules.test.ts:38 fails for `nickname.length` at index.ts:149, and lookup.test.ts:59 and admin.test.ts:147 fail for `nickname.length` at index.ts:293 |

## must fix

none

## unknown

- The commit range 65ec9c4..d867e63 changes only server/core/nickname/tests/admin.test.ts, lookup.test.ts, rules.test.ts and set-nickname.test.ts under the target (commit 788f947); server/core/nickname/index.ts and the dependency modules (`validation`, `storage`, `item-ledger`, `server-time`, `logging`, `testing`, `admin-api`, `routing`) and proto/ and fixtures/ are unchanged in the range, so no implementation code was reviewed beyond the positions of R1-1 to R1-5.
- A real PostgreSQL deadlock was not made in any run; only the lock wait over `storage.userLockWaitMs` reaches `FAILED`. Both reach `FAILED` through the same `lock_row` catch in server/core/storage/tx.ts:386-388 (`is_db_failure` of a `lock` `DbError`), as the core agent report states; that catch was read, not run with a deadlock.
- The tests ran outside `ogw core test`: the harness `serverModuleTest` was called on a copy of the checkout with `server/build/data` copied from the main checkout (its server/ and fixtures/ equal d867e63). The unchanged copy passed 34 of 34 tests in each of the SQLite and PostgreSQL runs, none skipped, before the defects were restored.
- The dependents of nickname (`ogw core dependents nickname`) were not run: the range changes only nickname test files, which no other module imports.
