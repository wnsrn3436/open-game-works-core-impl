# review: live-event round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | server/core/live-event/index.ts:279 | `## behavior` settlement of the live-event spec: `on_request_start` opens one out-of-request change per `LiveEventEntryUserState` whose `settled` is `false`, and a hook that throws rolls back "that one settlement". `settlement_change` returns `false` on `FAILED` (index.ts:279-282), and `on_request_start` then returns (index.ts:374, 377), so the participations after it are not settled in that request. The range made a hook statement failure end as `FAILED`: d469dc5/9e53845 changed `body` in server/core/storage/tx.ts:195-208 so that a body that returns after a statement broke the transaction is `FAILED`. Before, `call_settle_hook` catching the thrown `DbError` (index.ts:227-229) and returning `CORE_ERROR_INTERNAL` gave `REJECTED`, and the loop went on. Repro (SQLite run, test in a temporary copy): alice joins `[live_event_once]` and `[live_event_weekly]` at `S`, time is set to `S + DAY`, and `settle_live_event` runs `storage.db(ctx).query('SELECT * FROM no_such_table_xyz')` for the lower event ID only and otherwise returns `pass`. After `core/Resync`, the hook was called only for the lower ID, the error logs are `settle_live_event ... threw` and `live event settlement transaction failed`, and both entries are `settled` `false`. The same test passes with server/core/storage/tx.ts of 51d323b | On `FAILED` of one settlement change, log it and go on to the next due participation (end the loop only on `WITHDRAWN`). Add a test in which the hook of one participation breaks the transaction and the other participation is settled in the same request | no | 90 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- server/core/live-event/ has no change in the commit range. I checked the changed code it calls: storage `run_user_transaction`, `with_hook_change_source`, `check_hook_output`, `get_state`, `list_state`, `put_core_state` and the `body`/`run_savepoint`/`lock_row`/`mark_broken` changes in server/core/storage/tx.ts and core.ts. I also checked logging (log_line.ts IP truncation only) and the changed callers mission, ranking reward, gacha, routing pipeline and auth account. None of them change how they call live-event
- I ran the repro and the live-event tests (23 passed) only in the SQLite run, in a temporary copy, with the server build data of the open-game-works-core-impl main checkout (0b2f181), not data built from d593421. The PostgreSQL run was not run
- The double `error` log for one hook statement failure (`threw` and `transaction failed`) was not judged against the error table: the spec does not set the number of logs for that case
