# review: idempotency round 1

## findings

none

## previous

none

## out of scope

- server/core/idempotency/index.ts:204: medium `spec`: the behavior that `save_withdrawn_response` does not save a response whose `ResponseEnvelope` has `error` (`### request ID` of the idempotency spec) has no test. In `server/core/idempotency/tests/` the only error-response test (`request-id.test.ts` "does not store an error response") sends with handler `failing`, which does not delete the user, so `save_withdrawn_response` returns early on `user_deleted` `false`, never on `!is_success(response)`. No other test file calls `save_withdrawn_response`. The only tests that reach `save_withdrawn_response` with `user_deleted` `true` use handler `withdraw`, which always returns a success body. So no test fails when `\|\| !is_success(response)` is removed from line 204 (found by reading the tests, not by a run). This existed before the commit range and is unrelated to its changes

## debt

none

## must fix

none

## unknown

- The commit range does not change `server/core/idempotency/`. I checked what the range changed in the modules it depends on and in its caller: `storage` (`core.ts`, `index.ts`, `tx.ts`, `db/sqlite.ts`, `db/postgres.ts`, `db/meter.ts`: DB meter, seed provider signature, `make_seed`, WAL open retry), `server-time` (no change) and `routing` (`pipeline.ts`, `routing_module.ts`, `server_process.ts`, `start.ts`). None of these changes the `storage.db`, `DbHandle.query`, `register_table`, `clock_now` or `RequestCtx` that idempotency uses, or the order or arguments of the idempotency calls in `routing/pipeline.ts`. `ogw core test server idempotency` passed on this checkout (two results, both `pass`)
- I did not check per-user serialization across several request worker instances on one DB (`routing.requestWorkers` > 1, `server_process.ts`) by a run. The case where a request with the same request ID arrives while the first is in handling depends on it. From reading the code, `SqliteAdapter.begin` retries `BEGIN IMMEDIATE` across connections up to the lock wait limit (`server/core/storage/db/sqlite.ts:291`), so I found no defect. That serialization belongs to `storage` and `routing`
- I did not review the `routing` code that calls idempotency outside the range (step 5 and step 14 in `pipeline.ts`), because the range does not change it
