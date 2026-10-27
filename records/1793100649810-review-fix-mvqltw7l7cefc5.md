# review fix routing

## done

- `routing`: added core tests for job `storage_sweep` when `run_user_changes` is `FAILED` (one `error` log `storage_sweep: run_user_changes failed`) and when it returns a number (no `error` log), in `server/core/routing/tests/storage-sweep.test.ts`. No implementation change
- `ogw core test server routing testing`: pass. `ogw code check core`: pass

## spec proposals

none

## review

- R1-1: fixed. `server/core/routing/tests/storage-sweep.test.ts:4-5` (`sweep_job` takes the `run_user_changes` result), `:63` (test `leaves one error log when run_user_changes is FAILED`), `:70` (test `leaves no error log when run_user_changes returns a number`). Checked by mutation: with `routing_module.ts:169` replaced by `await step('run_user_changes', async () => { await storage.run_user_changes(); return true; });`, `ogw core test server routing --file server/core/routing/tests/storage-sweep.test.ts` fails the new `FAILED` test on both the SQLite and the PostgreSQL run; the mutation was reverted before the commit

## unverified

none
