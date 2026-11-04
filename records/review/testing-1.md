# review testing round 1

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

- The range changes no file under `server/core/testing/`. Only what the range reaches was read: `testing.backgroundWaitTimeoutMs` (`settings/core-settings.schema.json:620`, `server/core/testing/dev/test_server.ts:184-189`, `server/core/testing/dev/peer_process.ts:165`, `server/core/testing/dev/peer_process_main.ts:56`), `check_overrides` and `plan_of` as `server/core/routing/tests/settings-minimum.test.ts` calls them, and `start_peer_process`, `stop_peer_processes`, `until_blocked_by`, `hold_game_row_lock`, `core_test_register` and `load_data` as `server/core/block-report/tests/peer.ts`, `server/core/block-report/tests/withdraw.test.ts` and `server/core/auth/tests/withdraw.test.ts` call them. The other test helper code was not reviewed against the spec, because it is outside this range
- `ogw core test server testing` and the `--file` runs of `server/core/routing/tests/settings-minimum.test.ts` and `server/core/block-report/tests/withdraw.test.ts` ended with exit code 0 and `pass`. Their output names only the module result, so it does not show which DB kinds ran, how many tests ran, or whether the `testing` result came from the kept passing result. The PostgreSQL-only `describe` of `server/core/block-report/tests/withdraw.test.ts` was not seen running
- Not judged: `testing.backgroundWaitTimeoutMs` 0 given as a settings override of a test server. By reading the code, `check_overrides` (`server/core/testing/dev/test_server.ts:358`) accepts it and `wait_idle` (`server/core/testing/dev/test_server.ts:189`) waits 1 ms; this was not run. `open-game-works-core/skills/core/SKILL.md:120` says overridden values are checked with `core-settings.schema.json`, while `open-game-works-core/skills/server-core/modules/testing.md:60` and `open-game-works-core/skills/server-core/modules/testing.md:185` set the throw only for a nonexistent key or a different type. Whether the first line applies to test helper overrides could not be settled from the documents, so confidence stays below 80 and no finding is written
- The harness tool checks on schema `minimum` values were searched only by name under `open-game-works-core/tools/src/commands/core/`, and no core test run restored `minimum` 0 for that key, so whether something outside the core tests catches that restore was not established
