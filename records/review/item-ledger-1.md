# review item-ledger round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | settings/core-settings.json:63 | Commit c8fe1d02 of the range changes the core default of `item-ledger.historyRetentionMs` from 7776000000 (90 d) to 34560000000 (400 d) (`git diff 85f6b36d..3196fa39 -- settings/core-settings.json`). Its message ("core settings: settings of the spec changes since harness 3417ebc (... item-ledger.onceKeyRetentionMs ...)") names only the new key `onceKeyRetentionMs` and gives no cause or evidence for the new history duration. The item-ledger spec sets no value for this key (item-ledger.md `## settings`), and the harness spec commit df02e39 says the change keeps "the once_key window and the balance logic as they are", without a new history duration. This breaks the rule of `## harness writing rules` of AGENTS.md that a commit changing a time value states its cause and evidence. The new value also multiplies the rows the history table keeps per user by about 4.4 | Either restore 7776000000, or change it in a commit whose message gives the cause (e.g. the refund or support lookback the history must cover) and the evidence (store refund window, specification) for 400 d | no | 85 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- `server/core/item-ledger/tests/history.test.ts` was run with `ogw core test server item-ledger --file server/core/item-ledger/tests/history.test.ts` and passed; the other item-ledger test files and the modules that depend on item-ledger were not run.
- The test of a history key conflict checks that `run_request_transaction` is `FAILED` and that nothing changed; the mapping of `FAILED` to `INTERNAL` and its `error` log by `routing` were not checked here (they belong to `routing`).
- The callers of `list_history` (`admin-api`) were not checked against the new `seq` range (from `clock_now` + 1, about 1.7e12), as they are outside the target.
