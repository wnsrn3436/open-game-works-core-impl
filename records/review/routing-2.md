# review routing round 2

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R2-1 | spec | medium | server/core/routing/pipeline.ts:865 | The R1-2 fix (commit dd19ec48) changed `socket.destroy()` to `socket.end('HTTP/1.1 404 ...')` for an upgrade with no route. On a request worker the socket is a `BridgeSocket` (`front_link.ts:188`, `allowHalfOpen: true`): `end` sends `sdata` and `send`, but the socket is never destroyed while the front has not sent `end`, so no `sclose` is posted. The front answers `send` with `socket.end()` only (`server_process.ts:480`), and the server socket of `node:http` is half-open (`allowHalfOpen` true), so the connection stays open. The front calls `done` for an upgrade only on `sclose` or on the client socket `close` (`server_process.ts:433-437`, `:481-483`). So a request whose 404 answer the front has fully sent stays in progress on its request worker until the client closes. `### server process` (open-game-works-core/skills/server-core/modules/routing.md:110) says a request is in progress "until the front has received the end of its answer", and only "a connection upgraded to WebSocket" stays in progress until it closes. Before this range, `destroy` posted `sclose`, and the front called `done` and destroyed the socket. Reproduced in a temporary worktree with a `--file` test run by `ogw core test server routing` (SQLite and PostgreSQL), deleted afterwards: a server process without `--matchmaker`, 3 clients `connect({allowHalfOpen: true})` that send the `GET /realtime` upgrade and do not close. Each got `HTTP/1.1 404 Not Found` and `end`, no `close`, and 3 s later `ogw_requests_in_progress` of `GET /metrics` was 3. After the clients ended their side it was 0. So a client that never closes keeps any number of connections open with no time limit (no `node:http` timeout applies to an upgraded socket), inflates `ogw_requests_in_progress`, and skews the request worker choice of `routing.md:110` | Close the connection once the 404 is written: e.g. `socket.end(head, () => socket.destroy())` or `destroySoon`, so that a `BridgeSocket` posts `sclose`; and have the front call `done` at `send` and close the client socket after its writes are flushed (`destroySoon`), not wait for the client. Add a test that a client that keeps its side open after the upgrade 404 gets its connection closed and `ogw_requests_in_progress` back to 0 | no | 90 |

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `server/core/routing/server_process.ts:444-449` pauses the client stream once `FRONT_WINDOW_BYTES` are in flight, and `from_worker` resumes it only on `pull` (`:462-466`). The worker side pulls only the bytes a stream took (`front_link.ts:83-105`, `:132`, `:206`), so a request that does not read, or that `read_body` paused at `routing.maxBodyBytes`/`routing.bodyReadTimeoutMs`, pulls nothing. `FrontResponse.end` removes the request from `requests` (`front_link.ts:292-295`), so later `data` is dropped, and the front stops sending after `res` (`server_process.ts:394-399`) and answers with `Connection: close` when `req.complete` is false (`:474`). `front-link.test.ts` `front link flow` and `server-process.test.ts` `closes the connection after an answer that came before the end of the body ...` check both sides. A replica of the front logic on `node:http` also showed that a paused request whose body was complete keeps its keep-alive connection usable for the next request (bodies of 70 000 to 140 000 bytes) |
| R1-2 | fixed | `server/core/routing/pipeline.ts:865` writes `HTTP/1.1 404 Not Found` for an upgrade with no route, and `server-process.test.ts` expects `HTTP/1.1 404` from a server process without `--matchmaker`. The reproduction of R2-1 got that status line. The connection handling after that line is R2-1 |
| R1-3 | fixed | Commit 54fa46c3 in this range: `server/core/routing/dev/index.ts:167` calls `process_tokenless` without the `false` argument, and `pipeline.ts:533-535` always runs `check_min_version` after the IP counter. `server/core/cheat/tests/processing.test.ts:96` checks `DevLogin` below `min_version` is `APP_UPDATE_REQUIRED` with no auth handler call |

## out of scope

- server/core/routing/pipeline.ts:871: medium A route handler of an upgrade that returns a status (`output !== null`) gets `socket.end(status line)`, the same half-open end as R2-1 (unchanged since 301b3dd8). On a request worker or the realtime worker the front then calls `done` only when the client closes, so a client that keeps its side open after that answer holds the connection and its in-progress count with no time limit. Read from the code (`front_link.ts:210-224`, `server_process.ts:433-437`, `:480`); not run separately from R2-1

## debt

none

## must fix

none

## unknown

- The whole routing test suite was not run. Only the temporary `--file` test of R2-1 was run, in a temporary worktree, with `ogw core test server routing --file` (SQLite and PostgreSQL)
- A client that sends a body over `routing.maxBodyBytes` without waiting for the answer can get `EPIPE` instead of the `INVALID_REQUEST` answer, because the front closes the connection after that answer (`Connection: close`). This was checked only with replicas on `node:http` (not the real front): the replica of the front answered 15/20 and 9/20 requests (2 MiB and 8 MiB bodies), and a replica of a server instance that listens itself with the `read_body` pause answered 14/20 and 20/20. Because a server instance that receives the connection itself (`routing.md:109`) also loses answers, it is not written as a finding
- The worker heap under a client that streams slowly while the worker holds the request unanswered was not measured. It was read from the code: bytes in flight stay at `FRONT_WINDOW_BYTES` plus one chunk
- The WebSocket flow of the realtime worker under the front window (`ws` pausing `BridgeSocket`) was read from the code and not run
