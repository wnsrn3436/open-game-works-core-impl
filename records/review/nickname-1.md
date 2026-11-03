# review nickname round 1

## findings

none

## previous

none

## out of scope

- server/core/nickname/index.ts:267: medium failure path of the spec `## error` without a test: a `nickname_claim` lock wait over the limit or a deadlock in `SetNickname` step 5 is `INTERNAL`, and the nickname and the balance do not change. No nickname test makes `lock_game_row` return `FAILED`; server/core/nickname/tests/set-nickname.test.ts:60 holds the lock only until it releases it, with `storage.userLockWaitMs` 20000. Restored in a temporary copy: returning `CORE_ERROR_NICKNAME_TAKEN` for `FAILED` passed `ogw core test server nickname` on SQLite and PostgreSQL
- server/core/nickname/index.ts:325: medium failure path of the spec `## error` without a test: a `nickname_claim` lock wait over the limit or a deadlock in `rename_user` is `internal`. server/core/nickname/tests/admin.test.ts checks only 200, 400 and 409 of `rename_user`. Restored in a temporary copy: returning `conflict` for `FAILED` passed the same run
- server/core/nickname/index.ts:255: medium processing order of `### SetNickname` without a test: no test has two failure conditions at once, so swapping steps passes. Restored in temporary copies, each passing the same run: the cooldown check (line 259) moved before the rule check (a nickname that breaks the rules within the cooldown would be `NICKNAME_COOLDOWN`, not `NICKNAME_INVALID`), and in a separate run the cost (line 262) moved before the cooldown check (a change within the cooldown with a short balance would be `ITEM_NOT_ENOUGH`, not `NICKNAME_COOLDOWN`)
- server/core/nickname/index.ts:328: medium behavior of `### operator forced change` without a test: `rename_user` writes request time to `changed_at`. server/core/nickname/tests/admin.test.ts:28 and :76 match only `nickname`, `change_count` and `forced`, and with `forced` `true` the next `SetNickname` does not read `changed_at`. Restored in a temporary copy: writing `0n` passed the same run
- server/core/nickname/index.ts:149: medium the code point counts of the spec have no test with a character outside the BMP: server/core/nickname/tests/rules.test.ts:20 and :21 and server/core/nickname/tests/admin.test.ts:109 use only ASCII. Restored in a temporary copy: `nickname.length` in place of the code point count at line 149 and at line 293 passed the same run. With that defect one Han character outside the BMP (allowed by the default `nickname.allowedScripts`) would pass `nickname.minLength` 2, and a lookup of 7 such characters would be an empty list or `bad_request` under `nickname.maxLength` 12

## debt

none

## must fix

none

## unknown

- The commit range changes no file of server/core/nickname, its tests, its contract in proto/ogw/core.proto, the `nickname.*`, `nicknameUnique` or `admin-api.maxSearchRows` settings, tools/data-tool/src/checks/nickname.ts, or the code of its dependency modules. The changes that reach this module are settings/core-settings.json, settings/core-settings.schema.json and server/core/testing/dev/setting_types.ts (keys of `coupon`, `matchmaker` and `routing`, and removed keys that nickname does not read), core-spec/validation.json (`supportedLanguages` removed from `settings`, `requirement` added to `usedTables`), tools/data-tool/src/corespec.ts (enums of the `requirement` header in core data) and server/core/Dockerfile (removes `core/*/tests`; nickname has no `dev/`). Reading them and running the tests shows no problem they cause or reveal in nickname
- `ogw core test server nickname` passed on the checked commit, and it may have used a kept result of the same key. The runs on temporary copies did not use kept results, because a dirty checkout neither uses nor keeps one: a control copy that wrote `forced` `true` in `SetNickname` step 6 failed on SQLite and PostgreSQL. The restorations at lines 267, 325, 255 (cooldown before rules), 328, 149 and 293 ran together in one copy, and the cost before the cooldown ran alone in another
- Tests of other targets were not run: the `friend`, `chat`, `public-profile` and `ranking` tests that call nickname, and the `tools` target with tools/data-tool/tests/nickname-checks.test.ts. tools/data-tool/src/checks/nickname.ts was read but its test was not read
- `rename_user` 404 for a missing or withdrawn user has no nickname test. server/core/admin-api/tests/content.test.ts:94 checks it for a content operation with `user_target`, and server/core/admin-api/tests/auth.test.ts:391 goes through the collected operations for roles. Whether that auth test reaches a 404 for `rename_user` was not checked
- The code of `validation`, `storage`, `item-ledger`, `server-time`, `logging`, `admin-api` and `routing` was read only where nickname calls it or as the specs define it; those modules are other review targets. That a `CoreError` returned after `subtract_items` reverts the balance comes from the `storage` spec and from server/core/nickname/tests/set-nickname.test.ts:76
- Concurrency on PostgreSQL was not observed beyond the core test run. The `nickname_claim` serialization was judged from the code, the `storage` spec (`READ COMMITTED`, lock held until the transaction ends) and server/core/nickname/tests/set-nickname.test.ts:51
- A nickname with an invisible character allowed by its script, e.g. U+3164 (`Script` Hangul, not `White_Space`, deleted by normalization), follows the rules as the spec writes them: `a` + U+3164 has code point count 2 and displays as one letter. It equals the defining documents, so it is not written as a problem, and whether the spec wants it was not judged
