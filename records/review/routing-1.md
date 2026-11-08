# review routing round 1

## findings

none

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | The front now has flow control: `send_data` (server/core/routing/server_process.ts:448-453) counts bytes in flight per request and pauses the client stream at `FRONT_WINDOW_BYTES` (64 KiB, server/core/routing/front_link.ts:73). It resumes only when the worker sends a `pull` (server_process.ts:464-468), and `Inflow.take` sends that only when `push` stays under the stream's high water mark or the handler reads again (front_link.ts:94-98, `_read` at :134). So a body the handling does not read (a 401 at admin steps 1 to 3, a 404) stays in the client connection, with at most about one window in worker memory. After `res` the front removes the request from `handed` (server_process.ts:472), stops forwarding later `data` (:394), and answers with `Connection: close` when `req.complete` is false (:477). The worker removes the request at answer time (`answered`, front_link.ts:276-279) and drops its later `data` (:243-246). Tests: front-link.test.ts:145 (the over-limit request buffers nothing after the answer, and an unread body pulls 0 bytes) and server-process.test.ts:330 (a 1 GiB body to a 404 path gets `Connection: close` and the client sends less than the whole body). I ran both files with `ogw core test server routing --file ...` and both passed |
| D2 | fixed | none | `Pipeline.upgrade` now answers a route output with `answer_and_close` (server/core/routing/pipeline.ts:870, :883-887): `socket.end(head, () => socket.destroy())`. On `BridgeSocket` that posts `sdata`, then `send` (`_final`), then `sclose` (`_destroy`, front_link.ts:211-219). The front then calls `done` on `sclose` and destroys the client socket once its write finishes (server_process.ts:491-498). So a client that keeps its side open no longer holds the connection or the in-progress count. The path without a route goes through the same function (pipeline.ts:864). Test: server-process.test.ts:287 holds the client side open on `/realtime` with a request worker, on a path without a route, and on a realtime worker refusal. It checks the `Connection: close` answer, `ogw_requests_in_progress` back to 0, and that the client connection closes. I ran it and it passed |

## must fix

none

## unknown

- The commit range is empty (`3c42c58d..3c42c58d`), so this round has no changed code to review. Only the two debt items were checked. I did not review the rest of the module for new problems, so `## out of scope` covers nothing beyond them
- No restore-the-defect run was made for D1 or D2. These are debt items, not `test evidence` findings of an earlier round. Their tests were read and run on the current code only
- I did not check whether the PostgreSQL cases of server-process.test.ts ran or were skipped in this run. The tests for D1 and D2 use `sqlite`
