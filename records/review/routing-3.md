# review routing round 3

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R3-1 | test evidence | medium | server/core/routing/server_process.ts:488 | Commit 9665fa89 added the front wait for `finish` before it destroys a client socket whose worker side ended (`server_process.ts:488-492`), so that bytes the worker instance wrote before `sclose` (e.g. the matchmaker `refuse` answer, a WebSocket close frame) reach the client instead of being dropped by `destroy`. The report says the added test `server-process.test.ts:253` checks this on the realtime worker (`400 Bad Request` received whole, then closed). Restored in a temporary worktree (`git worktree add --detach` of HEAD, deleted afterwards): the `sclose` branch replaced with plain `socket.destroy()` as before the range, then `ogw core test server routing --file server-process.test.ts`: `routing pass` on SQLite and PostgreSQL. The answer heads in the test are a few dozen bytes that `net.Socket.write` hands to the kernel at once, so `destroy` drops nothing and the test cannot see the difference. So no test fails when this behavior is removed | Add a test where the worker instance writes more than the socket buffers hold before it closes, to a client that does not read for a while: e.g. a `--matchmaker` process where a WebSocket client pauses reading while the realtime worker sends it frames larger than the kernel and stream buffers and then closes it (or a route test double that writes several MiB with `end(data, () => destroy())`); the client then resumes and expects every byte and the end before the close | no | 90 |

## previous

| id | result | evidence |
|---|---|---|
| R2-1 | fixed | `server/core/routing/pipeline.ts:865` and `:871` now call `answer_and_close` (`:885-889`), which ends the socket and destroys it on `finish`; on a request worker the `BridgeSocket` `_destroy` posts `sclose` (`front_link.ts:221-224`), and the front calls `done` and closes the client socket (`server_process.ts:485-492`). Test `server-process.test.ts:253` checks 3 half-open clients (2 on the `GET /realtime` route 404, 1 on the path-table 404) get the 404 with `Connection: close`, the end, the close, and `ogw_requests_in_progress` 0. Restored in a temporary worktree (`answer_and_close` body replaced with `socket.end(head)` as before the range), `ogw core test server routing --file server-process.test.ts`: that test failed on SQLite and PostgreSQL with `the condition did not hold in time` |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The whole routing test suite was not run. Only `--file server-process.test.ts` was run twice in a temporary worktree, once with each of the two source changes of commit 9665fa89 reverted
- Whether the front, without the `finish` wait, actually drops bytes of a real realtime worker answer under a slow client was not reproduced; R3-1 is only that no test covers the added wait
- A client that never reads can hold a front socket after `sclose` while it waits for `finish` (`server_process.ts:488`). Read from the code: a server instance that receives the connection itself waits for `finish` the same way (`answer_and_close`, `matchmaker/realtime.ts:862-866`), and the request is no longer in progress, so it is not written as a finding; not run
- The front `else` branch for a `res` message of an upgrade (`server_process.ts:494-497`) is not reached by the worker side (`FrontAttachment.start` makes no `FrontResponse` for an upgrade); not changed in the range and not checked further
