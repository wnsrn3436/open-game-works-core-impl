# review cheat round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `Pipeline.process_tokenless` no longer has the `min_version` flag and always calls `check_min_version` after `count_ip` and before `decode` (server/core/routing/pipeline.ts:533-535), and the `DevLogin` branch of the routing DEV code calls it (server/core/routing/dev/index.ts:167), as cheat.md `### processing order` and routing.md:197 require. `check_min_version` exempts only `DATA_HASH_EXEMPT_RPC` (pipeline.ts:629-634), so `DevLogin` is not exempted. New test server/core/cheat/tests/processing.test.ts:96 (`answers DevLogin below min_version with APP_UPDATE_REQUIRED without the auth handler, ...`). I restored the defect in a `git worktree add` copy of HEAD by changing pipeline.ts:535 to `if (exchange.name !== 'core/cheat/DevLogin' && !this.check_min_version(exchange)) return;`, and `ogw core test server cheat --file processing.test.ts` failed that test in both the SQLite and PostgreSQL runs (`AssertionError: expected undefined to be 6`, the `APP_UPDATE_REQUIRED` assert at processing.test.ts:104). On the fixed checkout the same file passed in both runs, and `ogw core test server routing --file min-version.test.ts` passed in both runs |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The other changes of the commit range that cheat reaches (server/core/storage/db/sqlite.ts: the `open` PRAGMA statements now counted by the DB meter) change only the meter counts, not how cheat behaves; I did not run the storage tests for them, as they are not the target
- I ran only server/core/cheat/tests/processing.test.ts and server/core/routing/tests/min-version.test.ts with `--file`, not the whole cheat, routing and testing suites; the core agent report says its last `ogw core test server cheat routing testing` passed, and `ogw review run` runs the dependent module tests after each fix
