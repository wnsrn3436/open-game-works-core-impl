# review admin-api round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | server/core/admin-api/tests/auth.test.ts:26 | Commit e3f3d9e0 of the range adds the collected admin operation `revoke_login_tokens` (module `auth`, role `ops`, server/core/auth/admin.ts:86). The admin-api `## test` item "For each operation of the collected admin operation table, a request of an operator that has its role calls the handling of that module, a wrong secret is 401, and an operator without that role gets 403 `forbidden`" covers the operations listed in `COLLECTED`, and its `auth` row is `withdraw_user`, `find_user_by_social_account`, `find_user_by_public_code` only. `check_collected` (auth.test.ts:392) loops only over that list, so no test sends `revoke_login_tokens` with a wrong secret (401) or from an operator without `ops` (403); server/core/auth/tests/logout-other-devices.test.ts:115 calls it only as `ogw`. Removing the `ops` role check for that operation would leave every test passing | Add `['revoke_login_tokens', 'ops']` to the `auth` row of `COLLECTED` | no | 90 |

## previous

none

## out of scope

- server/core/routing/server_process.ts:383: medium In the server process the front reads the whole request body of every `--port` request and posts each chunk to the worker (`req.on('data')` with no limit and no backpressure), and the worker pushes it into the `FrontRequest` buffer (server/core/routing/front_link.ts:208) whether or not the request handling reads it; `read_body` only pauses that stream when the limit is passed (server/core/routing/http.ts:192), and an admin request refused at steps 1 to 3 never reads it. So a client without `Authorization` that sends `POST /admin/x` with a body of any size gets 401 while the whole body is still read by the front and kept in the worker's memory until the client ends it. This breaks the admin-api rule that steps 1 to 3 do not read the body and that a request without `Authorization` is 401 without the body being read even when it is larger than `admin-api.maxBodyBytes`, and lets an unauthenticated client grow worker memory with the body size (a worker that ends ends the process, server_process.ts:279). Fix in routing: stop forwarding (or close the client side) once the worker answers or its `read_body` gives up, and apply backpressure
- server/core/matchmaker/index.ts:103: medium The matchmaker spec (`## API` lines 61-62) exports the admin operations `list_match_flags` and `get_match` with caller `operator`, and the admin-api collected table lists them with role `read`, but `create_matchmaker` exports no admin operation (no `AdminOperation` in server/core/matchmaker/), so `POST /admin/list_match_flags` and `POST /admin/get_match` are 404 at step 3. Unrelated to the changes of the range

## debt

none

## must fix

none

## unknown

- No admin-api file changed in the commit range; the review covered the range's changes in the modules admin-api depends on or that call it (item-ledger history `seq` counter and once key retention, storage seed provider, `make_seed`, DB meter and `read_db_metrics`, logging metrics, routing server process and front link, auth `revoke_login_tokens`, iap tables) and how admin-api uses them. No problem was found in `list_item_history` with the new `seq` values, in the out-of-request transactions of admin-api with the new seed provider, or in the `audit` log with the new metrics counting
- Tests were not run: this checkout has no installed node_modules, and the findings above rest on reading the code and tests
- The admin-api tests were not run in the server process mode (`routing.requestWorkers` workers); the per-worker switch cache and the IP counter in that mode were checked only by reading: each worker is a server instance with its own cache, which the spec allows within `admin-api.switchCacheMs`, and the IP counter is in the shared DB
