# review user-snapshot-clone round 3

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R3-1 | spec | medium | server/core/user-snapshot-clone/tests/import.test.ts:280 | The spec change adds the `## test` item "An `import_user_snapshot` whose body is not JSON is 400 `bad_request`, and its `audit` line has `args` with `source_environment`, `source_user_id` and `sha256` `null` and `target_user_id` the input value" (open-game-works-core/skills/server-core/modules/user-snapshot-clone.md:201, rule at :118). No test checks it: the only audit test (import.test.ts:280) imports a valid snapshot and asserts the four args of the 200 line; the check 2 refusals (import.test.ts:173-204, through `expectRefused`) assert only status and unchanged rows, and `encodeJson('[]')` (import.test.ts:194) is JSON. `grep` over server/core/*/tests finds no assertion of a `null` `source_environment` or `sha256` in an audit line. The code (server/core/user-snapshot-clone/index.ts:414-421) gives `null` because `user_snapshot_of` returns null for a body that breaks check 2, but replacing `?? null` with any other value would pass every current test | Add a test that sends a non-JSON body (e.g. bytes `{` ) to `import_user_snapshot` for an existing target, asserts 400 `bad_request`, and asserts the `audit` line of that request has `source_environment`, `source_user_id`, `sha256` `null` and `target_user_id` the input value | no | 90 |
| R3-2 | spec | medium | server/core/user-snapshot-clone/tests/game-state.test.ts:302 | The spec change sets for `import_game_state` (open-game-works-core/skills/server-core/modules/user-snapshot-clone.md:135): "When the body breaks check 2, `source_environment` and `sha256` are `null` and `keys` is empty. `target_key` is `null` when it is not given". The only audit test (game-state.test.ts:302) imports a valid snapshot with `target_key` 5 and asserts those values; game-state.test.ts:317 calls `audit_args` only with a valid body and `target_key` 5n. No test sends a body that breaks check 2 or omits `target_key` and reads the audit `args`, so changing `?? []` or `?? null` at server/core/user-snapshot-clone/index.ts:555-558 passes every current test | Add a test that sends a body that breaks check 2 to `import_game_state` without `target_key` and asserts its `audit` line has `source_environment` `null`, `sha256` `null`, `keys` `[]` and `target_key` `null` | no | 88 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- In the commit range, no file under server/core/user-snapshot-clone, server/core/storage, server/core/validation, server/core/session, server/core/server-time, server/core/logging or server/core/admin-api changed (`git diff --stat` of the range on those paths is empty), so the review covered the code and tests that the definitions changed by the spec diff reach: the `audit_args` of `import_user_snapshot` and `import_game_state` (index.ts:414-421, 552-559, which match the new rules), and the handling of `FAILED` and throws of `replace_game_rows`, `replace_user_rows` and `lock_game_row` after a PostgreSQL abort (index.ts:394-412, 540-550, 279-306). Under the changed storage rules, an abort makes the opening transaction `FAILED` and later statements throw a value that is not `StorageMisuse`, which the module rethrows; no defect was found there
- The previous round had no findings and no `open` rows in `## previous`, so `## previous` has no row
- No test was run: neither finding needs a run (both are missing tests, shown by reading the tests and by `grep`). PostgreSQL behavior under the changed storage abort rules was not run and was checked only by reading the module code
- The changes in the diff to logging.md and server-core SKILL.md (client log counts, analytics send, truncated IP, `request` field of `routing`) do not reach code of this module and were not reviewed further
