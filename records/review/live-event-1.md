# review live-event round 1

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

- The commit range 85f6b36d..346907af changes no file under `server/core/live-event/` (code and tests), and input `## spec changes` is `none`. The review read the whole module (`server/core/live-event/index.ts`, `server/core/live-event/tests/*`) and the changes of the range to the code live-event calls or is called by: `storage` (`index.ts`, `core.ts`, `tx.ts` seed provider and `make_seed`, `db/meter.ts` counting adapter, `db/sqlite.ts`, `db/postgres.ts`), `logging` (`index.ts` metrics on `write`, `read_metrics`), `routing` (`pipeline.ts` step detail texts, min version check, `duration_ms` clock; `server_process.ts` and `worker_main.ts` worker threads; the `on_request_start` call at `server/core/routing/pipeline.ts:659` is unchanged) and `start.ts`. None of them changes `run_user_transaction`, `get_state`, `list_state`, `put_core_state`, `with_hook_change_source`, `check_hook_output`, `logging.write` of an `error` entry, `server-time.is_reached`/`is_reached_strict` or the request start order that live-event relies on. The out-of-request change of `on_request_start` passes no request fields, so it still gets a secure seed (`server/core/storage/tx.ts:186`). live-event keeps no per-process state other than `hook_slots`, which every worker instance fills at its own server start, and the cheat time offset comes from `user_now` with the DB handle, so worker threads do not change the active judgement or settlement. `server-time` has no code change in the range
- `ogw core test server live-event` (job mw7x090zd37693) passed on this checkout. Tests of other modules were not run: no finding claims a failure outside live-event
- PostgreSQL-specific behavior of settlement was not run separately; the test run used the default DB of the test runner
