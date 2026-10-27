# review routing round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | test evidence | medium | server/core/routing/routing_module.ts:169 | The range rewrote job `storage_sweep` (`step` now takes `() => Promise<boolean>`, and `run_user_changes` is judged by `(await storage.run_user_changes()) !== 'FAILED'`). `routing` `## behavior` (routing.md:89) says "When `run_user_changes` is `FAILED`, leaves an `error` log", but no test makes `run_user_changes` return `FAILED`: the only routing test of the job, `server/core/routing/tests/storage-sweep.test.ts`, has its fake `run_user_changes` always return `0`, and no other test asserts a `storage_sweep: run_user_changes failed` log (grep of `server/core/*/tests`). Restored defect in a temporary copy outside the checkout: line 169 replaced with `await step('run_user_changes', async () => { await storage.run_user_changes(); return true; });` (no log on `FAILED`); `storage-sweep.test.ts` still passes 2/2 | Add a case to `storage-sweep.test.ts` whose fake `run_user_changes` returns `'FAILED'` and assert exactly one `error` log `storage_sweep: run_user_changes failed`, and none when it returns a number | no | 85 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- Only `server/core/routing/tests/storage-sweep.test.ts` was run (in a temporary copy, with ogw's pinned vitest). The other routing tests need `OGW_DEFAULT_DB` and `test-data/settings.json` from the `ogw core test` environment and were not run, so whether they pass at the end of the range is not checked here
- The routing changes of the range are `module_api.ts` (`sweep_expired` return type), `routing_module.ts` (job `storage_sweep`), `spec_tables.ts` (`ENV_GAME_SETTINGS` entry `adUnits`) and the new `storage-sweep.test.ts`. The storage side of `sweep_expired` (`server/core/storage/rows.ts`) is the `storage` target and was read only to confirm that it returns `{ deleted, failed }` and no longer returns `FAILED`
- The behavior when `storage.sweep_expired` throws (it is logged as `storage_sweep: sweep_expired threw` and `run_user_changes` still runs) is not set by the defining documents, so it was not judged
