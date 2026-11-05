# review nickname round 6

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R6-1 | structure | medium | server/core/nickname/tests/set-nickname.test.ts:4 | Input debt D6, still present at f58b503. set-nickname.test.ts:4 and admin.test.ts:2 import `lock_key` from `../../storage/tx.ts`, which is an internal file of `storage` and not part of its public API. The tests pass `lock_key('nickname_claim', [normalizeText(...)])` to `hold_lock_key` at set-nickname.test.ts:60 and :92 and at admin.test.ts:65. The `testing` spec (open-game-works-core/skills/server-core/modules/testing.md:105) defines `game_row_lock_id`(table name, key value) as "the int64 key of the advisory lock that `storage.lock_game_row` takes on that row. Passed to `hold_lock_key`". It is exported from server/core/testing/dev/index.ts:32. The same lines also call `normalizeText`, imported from the `validation` internal file `../../validation/text.ts` (set-nickname.test.ts:5, admin.test.ts:4). The public form is `normalize_text` of the `Validation` object (validation/index.ts:45) | In both files, replace `lock_key('nickname_claim', [k])` with `game_row_lock_id('nickname_claim', [k])` from `../../testing/dev/index.ts`, and drop the `storage/tx.ts` import | no | 90 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D6 | open | R6-1 | server/core/nickname/tests/set-nickname.test.ts:4 and server/core/nickname/tests/admin.test.ts:2 still import `lock_key` from `../../storage/tx.ts`. It is used at set-nickname.test.ts:60, :92 and admin.test.ts:65. The commit range f58b503..f58b503 is empty, and nickname/tests last changed in a28ef8b, which did not touch these imports |

## must fix

none

## unknown

- The commit range f58b503..f58b503 is empty, so no changed code was reviewed. The scope was the input debt item D6 and the previous round's review file. That file (round 5) has no findings and no `open` rows, so `## previous` has no rows to judge.
- Tests were not run in this round. R6-1 is a `structure` finding that the imports show directly. No fix was made, so there is nothing to restore.
- The same `storage/tx.ts` `lock_key` import exists in tests of other modules (chat, notice, push, game-update, migration, guild). Those are outside the nickname target and were not judged.
