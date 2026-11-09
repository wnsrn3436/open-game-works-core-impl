# review item-ledger round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | server/core/item-ledger/tests/change.test.ts:346 | The spec's `## test` item (item-ledger.md `## test`, "`add_items` called by content code with `once_key` `shop:1` throws, the request is `INTERNAL`, ... and an `error` log is left") still requires an `error` log. Under the new rule (item-ledger.md `## error` row "`once_key` passed by content code that starts with a core `once_key` prefix": "none by item-ledger; the unhandled exception `error` log by `routing`"), that log now comes from `routing`. Before commit 8ba7373a, this test checked that an error log was left (`expect((logs(env, 'error')).length).toBeGreaterThan(errors)`). Commit 8ba7373a replaced that check with `expect(env.server.lines.length).toBe(lines)`, so the test now requires that no log line is written at all. The test calls `request()` (tests/helpers.ts:205), which runs `storage.run_request_transaction` directly and never goes through `routing`. So no item-ledger test now sends the `shop:1` request through `routing` and checks that it answers `INTERNAL` with the one `error` log of the unhandled exception. A `routing` that drops that log, or that answers anything else for this throw, passes every item-ledger test | Add a case that sends a content request whose handler calls `add_items` with `once_key` `shop:1` through a test server with `routing` (e.g. `start_test_server(..., ledger_register)` as tests/concurrency.test.ts:41 does). Check that the response is `INTERNAL`, that there is exactly one `error` log line, from `routing`, and none from item-ledger, and that the balance, history and `once_key` table stay the same | no | 80 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- Ran `ogw core test server item-ledger` (background job mw8lpzrpca670b), which passed on both runs it reported. The modules that depend on item-ledger (`admin-api`, `iap`, `mailbox`, `shop`, `coupon` and others) were not run. That includes the new `admin-api` `list_history` source-name mapping and its `export_personal_data` test, which belong to `admin-api` and were read but not run.
- The `storage` changes of the range (`fail_transaction`, d8fa28d8 and the second-call no-op of 8ba7373a in server/core/storage/tx.ts) were read only as far as item-ledger relies on them (`hook_failure` in server/core/item-ledger/ledger.ts). The rest of `fail_transaction` belongs to the `storage` target.
- The `routing` step 13 `INTERNAL` mapping and its `error` log for a `FAILED` request after an item-ledger hook failure were not checked end to end. The item-ledger tests check `FAILED` at `storage.run_request_transaction`.
- Once_key rows of the raw form, written by core 0.10.0 or earlier, are not looked up after the switch to the SHA-256 form. This is not a finding: harness commits 84e223a and e55f451 record that no PROD build of any game exists and that DEV, STG and LOCAL DBs start empty. Whether that is still true was not checked.
