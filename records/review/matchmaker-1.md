# review: matchmaker round 1

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

- No file under `server/core/matchmaker/` changed in the range 2ef5ae8d..4bc36b7. The changes that reach the matchmaker are the public user code change of `storage` and `auth` (`server/core/storage/rows.ts`, `server/core/storage/public_code.ts`, `server/core/storage/schema.ts`, `server/core/auth/login.ts`, `server/core/auth/deletion.ts`, `server/core/auth/admin.ts`), `server/core/routing/pipeline.ts:588` (`BanDetail.public_code` in step 6) and the new `proto/ogw/core.proto` fields (`BanDetail.public_code`, `AuthResult.public_code`, `PublicProfileEntry.public_code`). Checked against them:
  - The matchmaker calls none of `create_user`, `get_user_record`, `find_user_by_public_code`, `is_public_code_input` (`grep` of `server/core/matchmaker/`), so the return type change of `create_user` does not reach it. Its tests create users through `login` of `server/core/testing/dev/index.ts`, which did not change in the range
  - User IDs are now random below 2^53 instead of ascending. The matchmaker orders nothing by user ID: queue entries keep entry order, team assignment sorts by rating (`server/core/matchmaker/matching.ts:94`), the match record keeps index order (`server/core/matchmaker/records.ts:205`), and the sweep pages by `match_id` (`server/core/matchmaker/records.ts:209`, `:211`). User IDs are kept as `bigint` in records and frames (`server/generated/contract/core_contract.ts` `user_id: bigint`), so values up to 2^53 are exact. The test expectations that compare user ID lists (`server/core/matchmaker/tests/matching.test.ts:103`, `:117`, `:226`, `:331`, `:357`, `:391`, `server/core/matchmaker/tests/rooms.test.ts:118`, `server/core/matchmaker/tests/apply.test.ts:118`) compare with the sessions' own user IDs in entry or room order, not in ascending ID order; the fixed IDs of `server/core/matchmaker/tests/queue-rules.test.ts` are unit inputs of the matching functions and do not come from the DB
  - `CLOSE`(`BANNED`) of the matchmaker carries only `code` (matchmaker spec `### MatchmakerFrame`); the `BanDetail.public_code` of `routing` step 6 and the ban login of `auth` does not apply to `/realtime`
- The matchmaker tests were not run: this checkout has no `node_modules` to run them with, so whether they pass with random user IDs was judged by reading only
- The unchanged matchmaker code (`server/core/matchmaker/realtime.ts`, `results.ts`, `websocket.ts`, `judge.ts`, `shared.ts`, `index.ts`, `dev/index.ts`) was read only where it touches user IDs, `storage`, `auth`, `session`, `admin-api` and `game-update`; it was not reviewed again as a whole, since the range does not change it
