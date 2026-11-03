# review user-snapshot-clone round 1

## findings

none

## previous

none

## out of scope

- server/core/user-snapshot-clone/tests/export.test.ts:23: medium `### export_user_snapshot` ("It can be called in every environment") and `### game state snapshot` (the same sentence for `export_game_state` and `sample_game_state`) have no test on a PROD server, though exporting from PROD is the purpose of the module. The only PROD module instance in the tests is server/core/user-snapshot-clone/tests/import.test.ts:431, and it calls only the import prepare functions; the test server runs as LOCAL. Run path: in a temporary copy, `if (server.env === 'PROD') return 'conflict';` was added at the start of the handlers of `export_user_snapshot`, `export_game_state` and `sample_game_state` in server/core/user-snapshot-clone/index.ts, and all 80 tests of the module still passed. The problem existed before the range: the range does not change the module or its tests.

## debt

none

## must fix

none

## unknown

- The range does not change `server/core/user-snapshot-clone/`. Its changes that reach the module are the removal of `admin-api.maxBodyBytes` from core-spec/user-snapshot-clone.json (the module code does not read that key, and `max_body_bytes` is `user-snapshot-clone.maxSnapshotBytes`), and server/core/Dockerfile, which removes `dev` and `tests` folders from the image (the files of the module outside `tests/` import nothing from them). The other range changes (`coupon`, `matchmaker`, settings keys of those modules, `routing.storageSweepIntervalMs`, data tool, client) do not touch code that the module calls or that calls the module
- The module tests were run on SQLite only (80 passed), in a temporary copy of HEAD, with server/build/data copied from the main checkout at 9511ee9 and not built from the reviewed commit. They were not run on PostgreSQL, so the SQL of the module on PostgreSQL is checked only by reading
- The whole server core suite was not run
- The harness tool `ogw clone sweep` is outside the target and its code was not read
- The internals of `storage.replace_user_rows`, `storage.replace_game_rows`, `storage.sample_users` and `storage.sample_game_rows` were not read; only their definitions and how the module calls them were
