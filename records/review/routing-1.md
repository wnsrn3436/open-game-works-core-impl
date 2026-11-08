# review routing round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | security | medium | server/core/routing/front_link.ts:208 | The front forwards every body chunk of a request of `--port` to the worker (`server_process.ts:383-386`, `req.on('data')` with no limit and no stop after the answer), and the worker side pushes each chunk into the `FrontRequest` as long as its id is in `requests`. That entry goes away only on `end` or `abort` (`front_link.ts:211-218`). After `read_body` gives up at `routing.maxBodyBytes` or `routing.bodyReadTimeoutMs` it only calls `stream.pause()` (`http.ts:192`), and a request that never reads its body (403 of step 1, 404 path) never reads it at all. So `Readable.push` keeps buffering every byte the client sends in worker memory. Before this range the server read the socket itself, and the paused `IncomingMessage` put TCP backpressure on the client. Reproduced in a temporary script (deleted afterwards): a `FrontAttachment` on a `MessageChannel` with a handler that calls `read_body(req, 10, ...)` and answers. 50 `data` messages of 1 MiB were posted. The handler answered with the body `null`, and `req.readableLength` was 51380224 bytes after that. One client that streams a body of many GB to `POST /<rpc>` grows the request worker's heap until the thread dies, and then the whole process ends with exit code 1 (`### server process`, worker thread end) | Once the worker has answered, or has stopped reading (body limit, time limit, a step that never reads), stop buffering: drop the `requests` entry and discard later `data` messages for it, and have the front stop forwarding (e.g. `req.unpipe` / `req.resume()` to discard, or close the connection with `Connection: close`) once it gets `res`. Add flow control (front pauses `req` until the worker asks for more) so that bytes in flight stay bounded by `routing.maxBodyBytes` | no | 88 |
| R1-2 | spec | medium | server/core/routing/pipeline.ts:863 | `### server process` (open-game-works-core/skills/server-core/modules/routing.md:107) says "request workers answer `GET /realtime` with HTTP 404 as server instances without `--matchmaker`", and open-game-works-core/skills/server-core/modules/matchmaker.md:111 says "Requests to other server instances ... get HTTP 404". `collect.ts:98` drops route `GET /realtime` on an instance without `--matchmaker`. So `Pipeline.upgrade` finds no route and calls `socket.destroy()` with no response (`pipeline.ts:863-865`), on a request worker as well. The test added in this range asserts that it gets no answer: `server-process.test.ts:168` `expect(await realtime_upgrade(plain.port)).toBe('')`, and its comment at :164 says "a request worker closes it without an answer". Run path: a server process without `--matchmaker`, a WebSocket upgrade `GET /realtime` on `--port`, and the client reads EOF instead of `HTTP/1.1 404` | On an upgrade request with no route, write `HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n` and end the socket, as the path table does for other paths (no `request` log for an unknown path). Change the test at :168 to expect a 404 status line | no | 85 |
| R1-3 | spec | medium | server/core/routing/dev/index.ts:167 | open-game-works-core/skills/server-core/modules/cheat.md:108 says "`DevLogin` gets the handling `routing` defines for `NoAccessTokenRpc`", and open-game-works-core/skills/server-core/modules/routing.md:197 defines that handling: "the minimum app version judgement of step 7 is done after the IP counter and before step 10". The DEV code calls `process_tokenless(..., false)` for `DevLogin`, and `pipeline.ts:534` then skips `check_min_version`. The comment at `pipeline.ts:530` says "not for a cheat request", which reads the "skips step 7" of open-game-works-core/skills/server-core/modules/cheat.md:104. That rule covers only "cheat requests other than `DevLogin`", and the same branch does run step 4 maintenance for `DevLogin`, which open-game-works-core/skills/server-core/modules/cheat.md:104 also skips for other cheats. Run path: a DEV server with a deploy list whose `app.android.min_version` is `1.2.0`, and `POST /core/cheat/DevLogin` with `X-Ogw-Client-Version` `1.1.9`, `X-Ogw-Platform` `android`. The handler runs and logs the user in, where `Login` and `AutoLogin` under the same headers give `APP_UPDATE_REQUIRED` (min-version.test.ts:44). No test covers `DevLogin` below `min_version` | Pass `true` for `DevLogin` (the min version judgement after the IP counter, as for `Login`), fix the comment at `pipeline.ts:530`, and add a test that `DevLogin` below `min_version` is `APP_UPDATE_REQUIRED` without the handler | no | 82 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- No core test was run. PostgreSQL was not used, so the server process tests on PostgreSQL (`server-process.test.ts:254-329`) were read and not run
- R1-1 was reproduced on the worker side only, with `FrontAttachment` and `read_body` in one thread. The front side (Node `http` keeps calling the `data` listener after `res.end` on a keep-alive connection) was read from the code and was not run against a real client that streams a large body
- `game_settings` is `{}` at every caller in this checkout (`worker_main.ts:57`, `testing/dev/test_server.ts:241`). So keys of the form `environments.<ENV>.<key>` in game settings values, which `check_settings` checks only for overrides, were not exercised
- The settings constraint `routing.opsReportIntervalMs` × 2 ≤ `routing.readyMaxReportAgeMs` is not checked at server start. Its checker was not looked for outside routing
- The `logging.read_metrics` families and the storage DB meter (`storage/db/meter.ts`) were read only where routing calls them. Their own correctness belongs to the `logging` and `storage` reviews
