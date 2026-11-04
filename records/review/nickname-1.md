# review nickname round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | test evidence | medium | server/core/nickname/index.ts:267 | Input debt D1 remains: the spec `## error` row "step 5 `nickname_claim` lock wait over the limit, deadlock (`FAILED` of `lock_game_row`)" sets `INTERNAL` with the nickname and the balance unchanged, and no nickname test reaches `register_name` returning `'FAILED'` (index.ts:202). The only `nickname_claim` lock test, server/core/nickname/tests/set-nickname.test.ts:51-81, holds the lock with `storage.userLockWaitMs` 20000 and releases it, so both requests get the lock; no test in server/core/nickname/tests/ sets a short lock wait or makes a deadlock (grep of `userLockWaitMs`, `deadlock`, `FAILED` finds only set-nickname.test.ts:53 and restart.test.ts:55, the latter for `create_user`). Returning `CORE_ERROR_NICKNAME_TAKEN` or leaving the cost subtracted on `FAILED` would not fail any test | Add a PostgreSQL test that holds `lock_key('nickname_claim', [normalized])` past a short `storage.userLockWaitMs` while a user with a balance and a `nickname_cost` row sends `SetNickname`, and assert `CORE_ERROR_INTERNAL`, no `NicknameUserState` change, no `nickname_name` row and the balance unchanged | no | 90 |
| R1-2 | test evidence | medium | server/core/nickname/index.ts:325 | Input debt D2 remains: the spec `## error` sets `internal` for a `nickname_claim` lock wait over the limit or a deadlock in `rename_user`. server/core/nickname/tests/admin.test.ts:21-96 checks only status 200, 400 and 409 of `rename_user`; no test holds the claim lock during `rename_user`. Returning `'conflict'` for `FAILED` at index.ts:325 would not fail any test | Add a PostgreSQL test that holds the `nickname_claim` lock key of the target nickname past a short lock wait during `rename_user` with `nicknameUnique` true, and assert the `internal` status, the `audit` log and that `NicknameUserState` and `nickname_name` are unchanged | no | 90 |
| R1-3 | test evidence | medium | server/core/nickname/index.ts:255 | Input debt D3 remains: `### SetNickname` sets the order rules (step 2), cooldown (step 3), cost (step 4). Every failure test in server/core/nickname/tests/ has one failure condition: set-nickname.test.ts:136 (cooldown with a valid name and 100 gems), set-nickname.test.ts:162 (short balance outside the cooldown), rules.test.ts:27 (invalid names on a user with no nickname, so no cooldown). Moving the cooldown check at index.ts:259 before line 255, or the cost at index.ts:262 before line 259, changes the failure value only for inputs with two failure conditions, which no test sends | Add a test where a user inside the cooldown with a short balance sends a name that breaks a character rule (expect `NICKNAME_INVALID`) and a valid new name (expect `NICKNAME_COOLDOWN`), with the balance unchanged | no | 90 |
| R1-4 | test evidence | medium | server/core/nickname/index.ts:328 | Input debt D4 remains: `### operator forced change` sets request time to `changed_at`. No test in server/core/nickname/tests/ reads `changed_at` (grep finds none); admin.test.ts:28 and :76 match only `nickname`, `change_count` and `forced`, and `in_cooldown` (index.ts:233) does not read `changed_at` when `forced` is `true`, so writing `0n` at index.ts:328 fails no test | In the `rename_user` test, advance the test clock to a known time and assert `changed_at` of `nickname_state` equals it | no | 90 |
| R1-5 | test evidence | medium | server/core/nickname/index.ts:149 | Input debt D5 remains: the spec counts length in code points (rule 1 and `find_user_by_nickname`/`find_user_ids_by_nickname` input limits), and no nickname test has a character outside the BMP (a byte grep for 4-byte UTF-8 and a grep for `\u{`/`fromCodePoint` in server/core/nickname/tests/ find none; rules.test.ts:17-31, lookup.test.ts:49 and admin.test.ts:104 use ASCII, Hangul and full-width BMP characters). Using `nickname.length` instead of the code point count at index.ts:149 and index.ts:293 fails no test, while with it one Han character outside the BMP (e.g. U+20000) would pass `nickname.minLength` 2 | Add rule and lookup cases with a supplementary-plane character of an allowed script: one such character is `NICKNAME_INVALID` under `minLength` 2, `maxLength` such characters pass, and a lookup of `maxLength` such characters is not `bad_request` | no | 90 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | The commit range is empty; server/core/nickname/index.ts:267 and server/core/nickname/tests/ are as the item states, and no test makes `lock_game_row` return `FAILED` in `SetNickname` |
| D2 | open | R1-2 | server/core/nickname/tests/admin.test.ts still checks only 200, 400 and 409 of `rename_user` |
| D3 | open | R1-3 | No test in server/core/nickname/tests/ combines two failure conditions of `SetNickname` |
| D4 | open | R1-4 | No test in server/core/nickname/tests/ reads `changed_at` |
| D5 | open | R1-5 | No test in server/core/nickname/tests/ uses a character outside the BMP |

## must fix

none

## unknown

- The commit range 65ec9c4..65ec9c4 is empty, so no changed code was reviewed; the review covered the input `## debt` items only.
- The defects named by D1 to D5 were not restored and run again in this round; the results rest on reading index.ts and every file in server/core/nickname/tests/ and on the greps written in the evidence. The input items record that the restored defects passed `ogw core test server nickname` on SQLite and PostgreSQL.
