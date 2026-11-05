# review user-snapshot-clone round 4

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R3-1 | fixed | server/core/user-snapshot-clone/tests/import.test.ts:295 sends body bytes `{` to `import_user_snapshot` for an existing target, asserts 400 with unchanged rows, and asserts the last 400 `audit` line of `import_user_snapshot` has exactly the keys `sha256`, `source_environment`, `source_user_id`, `target_user_id`, the first three `null` and `target_user_id` the input value (rule at open-game-works-core/skills/server-core/modules/user-snapshot-clone.md:118, test item :201). Checked in a temporary copy outside the checkout (vitest on SQLite, `-t "not JSON"`): the test passes on the code as is, and fails on each of four restored defects in `audit_args` (server/core/user-snapshot-clone/index.ts:417-420): `source_environment ?? "x"`, `source_user_id ?? 0`, `sha256 ?? "x"`, `target_user_id: null` |
| R3-2 | fixed | server/core/user-snapshot-clone/tests/game-state.test.ts:317 sends to `import_game_state` without `target_key` a non-JSON body (`{`) and a snapshot whose `format` is the string `'1'` (a type that breaks check 2, user-snapshot-clone.md:104, :200), asserts 400 with unchanged rows, and asserts the last 400 `audit` line has exactly `keys`, `sha256`, `source_environment`, `target_key` with `null`, `[]`, `null`, `null` (rule at user-snapshot-clone.md:135). Checked in a temporary copy outside the checkout (vitest on SQLite, `-t "breaks check 2 without target_key"`): the test passes on the code as is, and fails on each of four restored defects in `audit_args` (server/core/user-snapshot-clone/index.ts:555-558): `source_environment ?? "x"`, `keys ... ?? ["x"]`, `sha256 ?? "x"`, `target_key ?? 0n` |

## out of scope

none

## debt

none

## must fix

none

## unknown

- In the commit range, the only changes under server/core/user-snapshot-clone are the two new tests (tests/import.test.ts, tests/game-state.test.ts); index.ts did not change. Of the dependency modules, only server/core/logging/log_line.ts (`truncate_ip`) and settings/core-settings.schema.json (logging minimums) changed; this module does not call `truncate_ip` and reads none of those logging settings keys, so they were not reviewed further. `core-spec/routing.json` gained `storage.userLockWaitMs`, a generated file outside this module. The changes to chat, auth, testing and the Godot AccessibilityCore are outside this target
- The mutation runs used SQLite only (`OGW_DEFAULT_DB=sqlite`) with `server/build/data` copied from open-game-works-core-impl/; PostgreSQL was not run. The audit `args` come from `audit_args`, which reads no database, so the result does not depend on the database
- The whole module test suite was not run; only the two new tests were run, on the unchanged code and on each restored defect
