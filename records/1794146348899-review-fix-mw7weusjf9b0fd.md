# review fix cheat round 1

## done

- `routing` (server): `DevLogin` now does the step 7 minimum app version check, the same as every other token-less core `rpc`. `Pipeline.process_tokenless` lost its `min_version` flag and always calls `check_min_version` after the IP counter and before step 10 (server/core/routing/pipeline.ts:529-535). The DEV code of `routing` calls it without the flag (server/core/routing/dev/index.ts:167)
- `cheat` tests: a new test in server/core/cheat/tests/processing.test.ts covers `DevLogin` below `min_version`. `client_data_version` of served.ts is now exported for it
- Last `ogw core test server cheat routing testing`: pass, SQLite and PostgreSQL runs. `ogw code check core`: pass for type check, lint, dependency and secret
- No engine-specific implementation rules document was written. `## <engine> build` of `tools/ogw.md` was not written

## spec proposals

none

## review

- R1-1: fixed. server/core/routing/pipeline.ts:535 (the check no longer depends on a flag, and the doc comment at :529-531 no longer exempts cheat requests) and server/core/routing/dev/index.ts:167 (`DevLogin` goes through it). Added test: server/core/cheat/tests/processing.test.ts, `answers DevLogin below min_version with APP_UPDATE_REQUIRED without the auth handler, and skips step 7 for the other cheats`. The test publishes `min_version` 1.2.0 for linux. It checks three things:
  - `DevLogin` at 1.0.0 and at 1.1.9 is `APP_UPDATE_REQUIRED`, and its `audit` line has user `0`, so the `auth` handler that decides the user was not called
  - `SetTimeOffset` at 1.0.0 still succeeds, because step 7 is still skipped for other cheats (cheat.md `### processing order`)
  - `DevLogin` at 1.2.0 succeeds for the user

## unverified

- I did not run the new test against the code from before the fix. The `min_version` flag was removed, so the old path cannot be called any more. Before the fix, `DevLogin` below `min_version` reached the handler and succeeded, so the test's first assertion would fail on that code
- During this work, one run of server/core/routing/tests/server-process.test.ts (`server process on PostgreSQL > hands the requests that arrive while a request worker waits in a DB call to the other request worker`) failed once with `testing: cannot connect to http://127.0.0.1:<port>: fetch failed`. The re-run of that file passed, and so did the last full run. I did not reproduce the cause. The test does not touch the changed code path
- One `ogw code check core` run reported a type check failure, TS7016 for `typescript` in tools/data-tool/tests/helpers.ts. I did not edit that file, and `typescript.d.ts` was present right after the run. I think node_modules were being installed in this worktree at the same time by the parallel `ogw core test`, but I did not confirm this. The last `ogw code check core`, run after the last `ogw core test`, passed
