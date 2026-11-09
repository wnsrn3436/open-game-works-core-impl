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

- The commit range changes no file of `server/core/live-event/`. The changes that reach live-event are those of its dependency `storage` (`fail_transaction`, the `failed` mark in `server/core/storage/core.ts` and `server/core/storage/tx.ts`) and of `item-ledger`, which a content `settle_live_event` hook calls (`server/core/item-ledger/ledger.ts` `hook_failure` now calls `storage.fail_transaction`). Checked against `server/core/live-event/index.ts`: when an item-ledger hook fails inside `settle_live_event`, the settlement transaction now ends `FAILED` instead of `REJECTED`, also when the content hook catches the throw and returns `pass` (the later `put_core_state` throws, and `body` returns `FAILED`). `settlement_change` logs it, returns `true` and the next due participation is still settled, `due` is set before the first settlement runs, and `settled` stays `false` for the next request, as `## behavior` settlement of the live-event spec sets. `with_hook_change_source` is entered on a transaction that is not marked, so its new `not_failed` check does not throw on the settlement path. The `logging` metrics change (comment only) does not reach live-event
- In that item-ledger hook failure case live-event writes two `error` logs for one settlement (`settle_live_event ... threw` in `call_settle_hook` and `live event settlement transaction failed` in `settlement_change`). The live-event spec writes `error` log for a settlement hook failure and an `error` log for a failure of `on_request_start` without setting their count, and no `## test` item counts them, so this was not written as a finding
- The live-event core tests were run with `ogw core test server live-event` and passed. Whether they ran on PostgreSQL as well as SQLite was not read from the output (the output prints `live-event pass` twice and gives no DB kind). No live-event test goes through a settlement transaction that ends `FAILED`; the spec `## test` list does not ask for one, and that code did not change in the range
- The modules that call live-event (`routing`, `auth`, `attendance`, `mission`, `shop`, `iap`, `offer`, `ranking`) were checked only for whether the range changed their calls to live-event; it did not
