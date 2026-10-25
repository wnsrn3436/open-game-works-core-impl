# review reset-counter round 1

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

- The commit range 2ef5ae8d..a74c315 changes no file of `server/core/reset-counter/`, `server/core/server-time/`, `test-data/data/tables/reset_counter.csv`, `tools/data-tool/src/checks/reset-counter.ts` or the reset-counter parts of `proto/`. The changes reached are those of `storage` (`server/core/storage/index.ts`, `rows.ts`, `schema.ts`, `public_code.ts`: random user ID and public code in `create_user`, core schema version 2 and the start fill of `public_code`, `get_user_record` and `find_user_by_public_code`). reset-counter calls only `storage.get_state` and `storage.put_core_state` (`server/core/reset-counter/index.ts:11`), which the range does not change, and does not use user IDs, so no change of the range reaches its behavior. Its tests start servers through `testing.login`, which goes through the changed `create_user`; the run log `records/1792947513155-update-core-mvo2nn7kb4e445-runs.json` has a passing `ogw core test server` run that includes `reset-counter` (4934 of 4934). The tests were not run again in this review
- Client `UserStateCore.get_reset_counter` (the client read by the same lazy reset rules, `## behavior`) is outside this server module target and was not checked
- Whether server start fails for a `reset_counter` row whose `limit` is 0 was checked only through the data tool check `tools/data-tool/src/checks/reset-counter.ts` and its test `tools/data-tool/tests/reset-counter-checks.test.ts` (exit code 1, `out_of_range`); the path by which a failed data check stops server start was not traced, as it is not in the range
