# update core: iap refund lookup

## done

- module `iap` (server), commits `b934a448`, `217855c4` on `agent/mw7ryqrq3bddcc`
  - `server/core/iap/refund_lookup.ts` (new): job `iap_refund_lookup`, scheduled in `begin_start` with `server-time.schedule_job` and the period `iap.refundLookupIntervalMs`. A run handles `APPLE` and then `GOOGLE`, each store that has an adapter. For each store it does the refund retry first (up to `iap.refundRetryBatchSize` rows, ordered by `failed_at` and then `transaction_id`; a success deletes the row; a failure adds 1 to `attempts` and sets `failed_at`, or deletes the row with an `error` log once `attempts` + 1 reaches `iap.refundRetryCount`; a `FAILED` write ends the retry). Then it reads the pages: the cursor window rules with the `warn` log of a skipped range, up to `iap.refundLookupPageCount` pages, failed applies inserted into the retry table, a cursor upsert after each page, and the reset to the first page after `rejected` with a page token. A failure in one store does not stop the next store
  - `tables.ts`: `iap_refund_cursor` (key `store`) and `iap_refund_retry` (key `(store, transaction_id)`, index `(store, failed_at)`), both scope `game` with no expiry column. They are not added to the user tables that `remove_user` marks
  - `notify.ts`: the `REFUND` work now has a `claim` flag and an audit reason. The new `refund_apply` runs the existing `REFUND` handling (lookup, record recheck, processing order, withdrawn user) without `idempotency.claim_notify`, with audit `reason` `iap_refund_lookup`. HTTP 200 counts as success and HTTP 500 as failure. Notification handling behaves as before
  - `adapter.ts`: `StoreAdapter.list_refunds(window_start, window_end, page_token, call)` → `RefundPage {transaction_ids, next_page_token, unverified}` or a failure (`rejected` = store refusal). `unverified` counts the left-out Apple history elements, and iap writes one `error` log per element, because the adapter has no logger
  - `adapters/apple.ts`: `POST /inApps/v1/notifications/history`. Production for `iap-apple` and sandbox for `iap-apple-sandbox`. The JSON body is `startDate`, `endDate`, `notificationType` `REFUND`, and `?paginationToken=` is sent only for a page token. HTTP 400 is `rejected`; any other non-200 status or a body that is not a JSON object is `communication_failure`. Each element's `signedPayload` goes through the same check and kind mapping as `parse_notification`; that logic is now shared in `signed_notification`
  - `adapters/google.ts`: `GET …/purchases/voidedpurchases?startTime&endTime&type=1[&token]`. The ID is `orderId`, else `purchaseToken`. The next page token is `tokenPagination.nextPageToken`. HTTP 400 is `rejected`
  - `dev/adapters/fake.ts`: the controller operation `list_refunds` (result `{transaction_ids, next_page_token}`, unset or `null` means an empty list and the empty string). Calls are recorded with input `{window_start, window_end, page_token}`. `hold`/`release` also cover `list_refunds`
  - `settings.ts`, `deps.ts`: the five new `iap.refund*` keys; `schedule_job` added to the server-time members iap uses
- `server/generated/core_settings_schema.json`: written by `ogw core spec`, committed with the implementation
- tests: `tests/refund-lookup.test.ts` (new, 14 tests) covers every new `## test` item of the refund lookup. `tests/adapters.test.ts` adds `list_refunds` tests for the fake adapter, `iap-apple`/`iap-apple-sandbox` and `iap-google`
- server-time caller cell: a spec change only. `server-time` does not check callers in code, and `core-spec/server-time.json` has no caller field, so no file changed for it. No code of another module changed
- last runs: `ogw core test server iap admin-api auth matchmaker notice rating routing testing` (iap plus every server module that `ogw core dependents iap` lists): all pass on SQLite and PostgreSQL. `ogw code check core`: type check, lint, dependency and secret all pass
- no engine-specific implementation rules document was written, and `## <engine> build` of `tools/ogw.md` was not written

## spec proposals

- `### refund lookup` does not say what happens when the `storage.read_db` read of the `iap_refund_retry` rows or of the cursor row throws. The implementation leaves an `error` log. A failed retry-row read ends only the retry of that store, and the pages still run; a failed cursor read ends that store in that run. Proposal: add both to the `## error` table
- When the delete of a given-up `iap_refund_retry` row is `FAILED`, the implementation leaves the `FAILED`-write `error` log and ends the retry. It does not also leave the give-up log, because the row stays and a later run retries it again. The spec could say this explicitly
- The `## test` item "inserts T1 into `iap_refund_retry` with `attempts` 0, with one `error` log": when the subscription status lookup fails, the existing `error` log of the lookup failure (from the shared lookup) is also written. The test counts only the refund-retry log line. Proposal: say "one `error` log of the refund apply failure", or state that the lookup failure log is also there
- `iap-google` `list_refunds`: when getting the access token fails, the implementation maps it to an adapter call failure, not `rejected`, so a token problem does not drop the stored page token. The spec says only "HTTP status 400 is `rejected`". Proposal: say that the access token failure is an adapter call failure
- `iap-apple` `list_refunds`: a key source failure while checking a history element fails the whole page as an adapter call failure, following `## settings` ("a failure of that call … is an adapter call failure"). The element is not left out. The `### refund lookup` line could say so

## review

none

## unverified

- `list_refunds` was tested only against HTTP answers stubbed in the tests, not the live App Store Server API or Google Play Developer API (pagination field names and the ms units of `startTime`/`endTime` come from the spec)
- The concurrency test (refund apply of the lookup and a `REFUND` notification at once) runs both together without forcing an interleaving. Its once-only result rests on record recheck, which the existing notification race tests already cover
- No client core test was run: only server files changed. `ogw core dependents iap` lists client modules (e.g. `PaymentCore`), but no client-facing contract or behaviour changed
