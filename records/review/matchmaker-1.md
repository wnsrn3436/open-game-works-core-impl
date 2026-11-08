# review matchmaker round 1

## findings

none

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | `create_matchmaker` exports `list_match_flags` and `get_match` (server/core/matchmaker/index.ts:152-153), made by `admin_operations` with role `read` (server/core/matchmaker/admin.ts:45-119), and the routing collected table lists them (server/core/routing/spec_tables.ts:105). Tests: server/core/matchmaker/tests/forfeit.test.ts:176 and :476 send `POST /admin/list_match_flags`, forfeit.test.ts:509-539 send `get_match` and check 200 and 404. `ogw core test server matchmaker --file server/core/matchmaker/tests/forfeit.test.ts`: pass |
| D2 | fixed | none | `hello_user` returns `INVALID_REQUEST` for a non-empty `platform` that `validation.is_platform` rejects (server/core/matchmaker/realtime.ts:421-426) and `APP_UPDATE_REQUIRED` when `game-update.is_below_min_version(client_version, platform)` is true for a non-empty `client_version` (realtime.ts:428-431), before the data version judgement. Test: server/core/matchmaker/tests/connection.test.ts:126-140 publishes android `min_version` `1.2.0` and checks `APP_UPDATE_REQUIRED` for `1.1.9`/`android`, `HELLO_ACK` for `1.2.0`/`android`, `1.1.9`/`ios`, empty `client_version` and empty `platform`, and `INVALID_REQUEST` for `Android` and `playstation`. `ogw core test server matchmaker --file server/core/matchmaker/tests/connection.test.ts`: pass |
| D3 | fixed | none | `decide` returns `FORFEIT` in the final decision when there is a forfeiter and a reporter that is not one (server/core/matchmaker/judge.ts:106-108), `judge` saves it (server/core/matchmaker/results.ts:182-185), and `apply_in` calls hook `apply_match_forfeit` for status `FORFEIT` (results.ts:223-225); the hook slot is in `hook_slots` (server/core/matchmaker/index.ts:119). Tests: server/core/matchmaker/tests/decision-rules.test.ts:72-89 check `FORFEIT` and the `Forfeit` integrity event, server/core/matchmaker/tests/forfeit.test.ts:180-197 check status `FORFEIT` from `ReportMatchResult` and from the decision after the `left_at` write, and the `apply_match_forfeit` call. forfeit.test.ts: pass |

## must fix

none

## unknown

- The commit range `625ae189..625ae189` holds no commit, so no changed code was reviewed; only the positions of the input `## debt` items and their tests were read
- The first run of server/core/matchmaker/tests/forfeit.test.ts, run at the same time as connection.test.ts, failed with `storage: cannot connect to PostgreSQL: the connect to PostgreSQL went over its time limit` and two `wait_background did not end within 10000 ms` errors. A second run alone passed. The cause (host load from two PostgreSQL runs at once, or a time limit that is too short) was not reproduced or checked
- Did not run the whole server core test suite or the other matchmaker test files; ran only connection.test.ts and forfeit.test.ts
