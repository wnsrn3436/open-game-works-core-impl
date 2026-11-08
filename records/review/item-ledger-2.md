# review item-ledger round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | Commit a7045f49 restores `item-ledger.historyRetentionMs` in `settings/core-settings.json:63` (and the regenerated `client/godot/generated/core_settings.json:63`) from 34560000000 to 7776000000, the value before c8fe1d02. Its message gives the cause (c8fe1d02 changed the value with no cause or evidence; the spec sets no value; harness commit df02e39 only splits the once_key retention out) and the evidence (no 400 d value in the harness or `records/`, the history rows kept per user grow with the duration, `iap.refundLookupBackMs` 25 d stays inside 90 d), as `## harness writing rules` of AGENTS.md requires. No item-ledger code or test reads the default: `server/core/item-ledger/index.ts:114` reads the setting, and `server/core/item-ledger/tests/history.test.ts:14` and `:15` set their own values. `ogw core test server item-ledger` (job mw7yr0lxf6993e) passes on 9ff88dff |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The other changes of the range (`server/core/logging/metrics.ts`, `server/core/storage/db/sqlite.ts`, `server/core/routing/pipeline.ts`, `server/core/routing/dev/index.ts`, `server/core/admin-api/tests/auth.test.ts`, `server/core/cheat/tests/*`, `client/godot/core/qa_core/*`) belong to other review targets. item-ledger imports `logging`, `server-time` and `storage` only through their `index.ts`; the changed logging alert window and the SQLite `open` path are not called by item-ledger code other than through server start, and were not reviewed here beyond the item-ledger test run.
- The client tests (Godot) were not run; no client module reads `item-ledger.historyRetentionMs`.
- Whether 90 d covers every refund or support lookback a game needs (e.g. card chargebacks after a store refund window) was not checked; the item-ledger spec `## settings` sets no value for the key.
