# review cheat round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | server/core/routing/dev/index.ts:166 | Commit 6ac30088 (in the range) added the minimum app version judgement to `Pipeline.process_tokenless` behind a new `min_version` flag (server/core/routing/pipeline.ts:533-535), and the `DevLogin` branch of the routing DEV code passes `false`, so `DevLogin` never calls `check_min_version` (the comment at server/core/routing/pipeline.ts:530 says "not for a cheat request"). The defining documents say otherwise: cheat.md `### processing order` makes the step 7 skip apply only to "cheat requests other than `DevLogin`" and says "`DevLogin` gets the handling `routing` defines for `NoAccessTokenRpc`" (skills/server-core/modules/cheat.md:101,108); `core/cheat/DevLogin` is in `NoAccessTokenRpc` and not in `NoUserRpc` (skills/server-core/SKILL.md:131-133); and for those requests "the minimum app version judgement of step 7 is done after the IP counter and before step 10" (skills/server-core/modules/routing.md:197), with only `GetNotices`, `FinishPlaySession`, `ContinuePlaySession` and `ReportMatchResult` exempted (routing.md:373). Run path: on a server whose deploy list `app` entry for platform `P` has `min_version` `2.0.0`, send `DevLogin` with a valid `X-Ogw-Dev-Access`, `X-Ogw-Platform` `P` and `X-Ogw-Client-Version` `1.0.0`: `process_tokenless` runs `count_ip`, skips `check_min_version` because `min_version` is `false`, decodes and calls the `auth` handler, and the login succeeds, where the spec gives `APP_UPDATE_REQUIRED` without calling the handler. No test covers `DevLogin` below `min_version` (server/core/routing/tests/min-version.test.ts and server/core/cheat/tests have no such case) | Pass `true` for `DevLogin` at server/core/routing/dev/index.ts:166 (and fix the comment at pipeline.ts:530), and add a test that `DevLogin` below `min_version` is `APP_UPDATE_REQUIRED` and does not call the handler. If `DevLogin` is meant to skip it, that has to go into cheat.md and routing.md first | no | 82 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- No file under server/core/cheat changed in the commit range. I checked the changes of the range that the cheat code calls or that call it: `storage` (`register_table`, `db`, `put_state`, `delete_state`, the seed provider signature change, the DB meter wrapping of the adapters), `server-time` (no change in the range), the cheat handling of the routing DEV code (server/core/routing/dev/index.ts) and the `testing` test server change. Apart from R1-1, none of them changes how cheat behaves
- `ogw core test server cheat` failed only in its PostgreSQL run: 5 tests failed with `cannot connect to PostgreSQL: the connect to PostgreSQL went over its time limit` or `testing: wait_background did not end within 10000 ms`, and the SQLite run had no failure. I did not reproduce the cause of those connection timeouts, so I could not check the PostgreSQL results of access.test.ts, processing.test.ts and start.test.ts in this round
- I did not run R1-1 as a test: a test file in the target checkout would be a write outside `output`. The evidence comes from the code path at server/core/routing/dev/index.ts:166 and server/core/routing/pipeline.ts:533-535
