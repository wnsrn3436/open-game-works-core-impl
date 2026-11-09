# review admin-api round 1

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

- Commit range 625ae189..aca0d897 changes these admin-api files: `server/core/admin-api/operations.ts` (`list_item_history` now gives `source` as the `ItemChangeSource` element name, because `item-ledger.list_history` now returns the enum value), `tests/items.test.ts`, `tests/export.test.ts` (`item_ledger_history` rows are now in `export_personal_data`), and the schema minimum of `admin-api.maxSearchRows` (0 to 1, `settings/core-settings.schema.json:75`, `server/generated/core_settings_schema.json:75`). Each was checked against `## API` (enum values of output JSON are element names), `### personal data export` and `## settings` of the admin-api spec, and against the `item_ledger_history` table definition of the item-ledger spec. No problem was found. The new asserts fail if the source mapping is removed (they would get the number 5) or if the history table is left out of the export
- The range's dependency changes were checked by reading the code for how admin-api uses them. (1) item-ledger hook failures now call `storage.fail_transaction`, so a `grant_items`, `revoke_items` or user-targeted content admin operation whose hook throws now ends with `run_user_transaction` `FAILED`, which admin-api answers with 500 `internal` and an `error` log (`server/core/admin-api/index.ts:396`), as `## error` of admin-api sets. Its `admin_api_operation` row rolls back with that transaction. (2) The `once_key` table now keeps a SHA-256 of the key, and the check for an unpaired surrogate is reached only after the body rules have already refused such an `operation_id`. (3) Item-ledger misuses no longer log. (4) The iap lookup result `gone` does not change `list_payments`. (5) The logging metrics comment change does not touch the `audit` log
- Both earlier out-of-range problems are already fixed in this checkout: `revoke_login_tokens` is in `COLLECTED` (`server/core/admin-api/tests/auth.test.ts:26`), and the server process front stops reading the client at `FRONT_WINDOW_BYTES` (`server/core/routing/server_process.ts:448`)
- Commit d7430b85 changes the `admin-api.maxSearchRows` minimum. Its message names the cause (server start accepted 0, review R1-1) but not the evidence for the new value. The evidence is the admin-api spec `## settings` "1 or more". This was not written as a finding: the confidence that the message breaks the commit message rule is below 80
- `ogw core test server admin-api` (job mw8kyzy76c18a0) and `ogw core test server admin-api item-ledger` (job mw8k8zhb8e9f05) ran. The SQLite runs of admin-api passed. The PostgreSQL runs failed with connection and wait timeouts: "the connect to PostgreSQL went over its time limit", "wait_background did not end within 10000 ms", and 60000 ms test timeouts. Those runs were not judged: the timeouts point at the host's PostgreSQL, not the code under review. The item-ledger concurrency test (`server/core/item-ledger/tests/concurrency.test.ts:85`) failed in the same loaded run: some requests ended with `INTERNAL` (8) instead of a response or the refusal. They wait up to 20000 ms for the user lock, so this may be host load, but the cause was not reproduced. The test is outside the admin-api target, and it was not re-run alone
- admin-api was not run in server process mode (`routing.requestWorkers` workers)
