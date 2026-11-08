# review notice round 1

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

- The commit range 85f6b36d..c554182f changes no file in server/core/notice/, and no notice entry of settings/core-settings.json, settings/core-settings.schema.json, server/generated/contract/core_contract.ts or core-spec/. The review checked the changed code that notice calls or that calls notice: the NoUserRpc path of server/core/routing/pipeline.ts (process_no_user does not run the new min_version judgement or step 4, so GetNotices is still handled during maintenance and for clients below min_version), storage read_db, db, lock_game_row and after_commit behind the new counting_adapter and DbMeter (server/core/storage/db/meter.ts, server/core/storage/db/sqlite.ts, server/core/storage/db/postgres.ts), logging.write of an error entry (server/core/logging/index.ts), and the worker instances of server/core/routing/server_process.ts (each worker instance makes its own notice module, cache and notice_cache job, which matches the per server instance cache of the spec). No problem was found there
- `ogw core test server notice` passed. Which DB adapter the job ran on was not checked, so the notice tests on PostgreSQL were not confirmed by this review
- The notice code and tests that the range does not reach were not reviewed again: with a commit range, problems that existed before the range and are unrelated to its changes are not findings
