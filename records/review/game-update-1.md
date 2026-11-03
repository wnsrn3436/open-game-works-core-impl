# review game-update round 1

## findings

none. The range changes no file under `server/core/game-update/`, no code of its dependencies `validation`, `storage`, `server-time`, `logging`, and none of its settings. The new `server/core/Dockerfile` removes `core/*/dev` from STG and PROD images, and the non-test code of game-update outside `dev/` does not import `dev/`.

## previous

none

## out of scope

- server/core/game-update/tests/publish.test.ts:77: medium `test evidence`. No game-update test fails when the `storage.lock_game_row` calls that `game-update.md` step 6 and `prune_update_files` require are removed. Both concurrency tests (`:77` and `:231`) send the two operations to one server instance in one process, and the handler functions contain no `await`, so their bodies do not interleave. Run on a temporary clone, SQLite: with both calls at `server/core/game-update/admin.ts:149` and `:168` removed, 74 of 74 pass. Reaching the race takes two server processes on PostgreSQL.
- server/core/game-update/index.ts:101: medium `test evidence`. No test covers reading a secret by the name in game settings, the path that `read_secret` of `server-core` `## module` sets when `db` is `null`, which is how a DEV, STG or PROD server reads `updateSigningKey` and `cdn`. `tests/helpers.ts` always gives a test server with a `db`, so lines 102 and 103 do not run. Run on a temporary clone, SQLite: with those lines replaced by `return server.read_secret(key)`, together with the other restored defects listed in `## unknown`, the only game-update failure is the one the control defect causes, and the 91 tests of the 6 other module test files listed there pass.
- server/core/game-update/index.ts:120: medium `test evidence`. No test covers server start with an unreadable `cdn` secret, which `server-core` `## adapter` says must stop the server. `tests/start.test.ts` covers only `updateSigningKey`, and no test uses `start_failure` with `adapters.cdn` `cdn-r2`. Run on a temporary clone, SQLite: with line 120 removed and the secret defaulting to an empty string, in the same combined run, no test fails on it.
- server/core/game-update/routes.ts:54: medium `test evidence`. No test checks `Content-Type: application/json` of `GET /update/deploy_list.json` and `GET /update/deploy_list.json.sig`, which `### serving` of `game-update.md` sets. `tests/serving.test.ts:34` checks only the content type of a file response. Run on a temporary clone, SQLite: with the value changed to `text/plain`, in the same combined run, no test fails on it.
- server/core/game-update/index.ts:185: medium `test evidence`. No test goes through the failure value `false` of `is_data_update_ready` that `## API` of `game-update.md` sets: no test makes the deploy list read throw. Run on a temporary clone, SQLite: with the `try`/`catch` removed so the read failure propagates to `routing` step 7 and `matchmaker`, in the same combined run, no test fails on it.
- server/core/game-update/store.ts:62: medium `efficiency`. `file_sizes` runs one `SELECT` per distinct `sha256` of the deploy list input, and `uploaded_sha256s` at `:114` does the same. `files_match` calls `file_sizes` twice per publish (`server/core/game-update/admin.ts:132` and `:151`), the second time inside the game transaction while holding the `sequence` 0 lock. The growing amount is the number of files in the input, limited only by `admin-api.maxBodyBytes` (1048576 bytes, which fits on the order of 10000 file entries by estimate; not measured). One `WHERE sha256 = ANY` style query would not grow with it.
- server/core/game-update/admin.ts:175: medium `efficiency`. `prune_update_files` reads every `sha256` of `game_update_file` (`store.file_sha256s`) and runs one `DELETE` per unreferenced file (`store.delete_file`) inside one game transaction while holding the `sequence` 0 lock, so publishes wait for it. The growing amount is the number of stored files and of files to delete. The time was not measured.

## debt

none

## must fix

none

## unknown

- Restored defects were run with vitest directly on temporary clones, on SQLite only. PostgreSQL was not run for any of them, so the lock removal result holds for SQLite and its PostgreSQL result comes from reading the code. Each restored defect was run once.
- Only the lock removal was run alone. The defects at `index.ts:101`, `index.ts:120`, `routes.ts:54` and `index.ts:185` were run together with it and with a control defect (the second step 2 check at `admin.ts:151` removed). In that combined run the only game-update failure was the control defect's, at `tests/publish.test.ts:231`, so the control was caught, and the other defects were not run one at a time.
- The other modules' tests were run on the combined defects only for these 6 files, 91 of 91 passing: `testing/tests/fake.test.ts`, `routing/tests/server-start.test.ts`, `routing/tests/cors.test.ts`, `matchmaker/tests/data-change.test.ts`, `matchmaker/tests/connection.test.ts`, `admin-api/tests/auth.test.ts`. The whole test suite was not run.
- `routing/tests/server-image.test.ts` needs Docker and was not run on the defects. It was read: its STG start expects exit code 1, so it would not detect the secret name defect.
- `ogw core test server game-update` gives no evidence here. Started inside a temporary clone, it reported `pass` even with a defect that must fail (`next_sequence` returning `published_at + 7n`), so it did not test that clone. Which checkout it tested, and whether it used a kept result, was not determined, so both of its runs were discarded. The unchanged code result is the direct vitest run on a clone at the reviewed commit: SQLite, 74 of 74 pass.
- The direct runs used the server build data folder of the main checkout at `f27aa5c`, newer than the reviewed `07923ff`, because the reviewed worktree has no `server/build/data`. The game-update tests read `client_data_version` from it.
- `game-update.md` was read in full. `validation.md`, `storage.md`, `server-time.md`, `logging.md`, `routing.md`, `admin-api.md`, `core/SKILL.md`, `core/command.md` and `server-core/SKILL.md` were read only at the parts about the operations, lifecycle, secrets and settings that game-update uses, so a rule elsewhere in them was not checked against the code.
- The real `cdn-r2` adapter was not run against R2; only its tests with a stubbed `fetch` were. The client `GameUpdateCore` and the `## deploy`, bundle patch check and adapter check of the `build` skill were not read.
- The handling of a throwing route handler was read at `server/core/routing/pipeline.ts:799` (HTTP 500 with an `error` log) but not run with a real DB failure.
