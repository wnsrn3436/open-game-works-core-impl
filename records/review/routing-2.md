# review routing round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `server/core/routing/tests/storage-sweep.test.ts:63` (test `leaves one error log when run_user_changes is FAILED`) makes the fake `run_user_changes` return `'FAILED'` and asserts the error logs equal exactly `['storage_sweep: run_user_changes failed']`; `:70` asserts no error log when it returns `2`. Restored the defect in a temporary copy (`git archive HEAD server`) outside the checkout: `server/core/routing/routing_module.ts:169` replaced with `await step('run_user_changes', async () => { await storage.run_user_changes(); return true; });`. With ogw's pinned vitest (`vitest run --globals core/routing/tests/storage-sweep.test.ts`), the unmodified copy passes 4/4 and the restored copy fails `leaves one error log when run_user_changes is FAILED` (expected `storage_sweep: run_user_changes failed`, got none), 1 failed / 3 passed |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The only server change of the range is `server/core/routing/tests/storage-sweep.test.ts`; no implementation code changed, so no other routing code was re-read beyond job `storage_sweep` (`server/core/routing/routing_module.ts:147-171`)
- Only `server/core/routing/tests/storage-sweep.test.ts` was run, in the temporary copy and on that copy's fakes (no DB). The PostgreSQL run that the core agent report names was not repeated here, and the other routing tests (which need the `ogw core test` environment) were not run
