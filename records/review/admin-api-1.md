# review admin-api round 1

## findings

none

## previous

none

## out of scope

- server/core/admin-api/index.ts:410: medium `correctness`. A `json` input field with a number outside the double range passes the body rules and ends in 500 `internal` instead of 400 `bad_request`. Input: `send_mail` with body `{"operation_id":"a","user_id":1,"mail":{"x":1e999}}`, and `broadcast_mail` the same way. `plain_json` (server/core/admin-api/json.ts:52) turns `1e999` into `Infinity`, and `canonical_json` (server/core/storage/canonical_json.ts:29) throws `TypeError` on it while `input_sha256` is computed, before the handler function and `mail_input_from_json` run. A scratch script that ran `parse_json`, `check_json_body` and `canonical_json` on this body printed `mail: { x: Infinity }` as passing and then `canonical_json: a number that is not finite`. The catch at server/core/admin-api/index.ts:474 answers 500 and leaves an `error` log line. Saved state does not change. skills/server-core/modules/admin-api.md sets a body violation and `INVALID_INPUT` of mail to 400. It existed before the range.
- server/core/admin-api/body.ts:172: medium `spec`. The query string of a binary body operation accepts the unknown field `__proto__`. `raw` is a plain `{}`, so `raw['__proto__'] = 'x'` sets no own key, and `check_object` does not see the field. A scratch script ran `check_query` with fields `{user_id: int64}`: `user_id=1&__proto__=x` returned `{ user_id: 1n }`, and `user_id=1&other=x` returned null. The body rules of skills/server-core/modules/admin-api.md make an unknown field `bad_request`. The field is dropped, so the handler function does not get it. A JSON body is not affected, because `JSON.parse` makes an own key. It existed before the range.
- server/core/admin-api/index.ts:414: medium `spec`. A 500 `internal` caused by a failed storage operation leaves only the `audit` line, with no `error` line. Run paths: `lock_game_row` returns `FAILED` when the lock wait passes `storage.userLockWaitMs` or a deadlock occurs, and the work returns `ROLLBACK` with the initial `fail('internal')` in `box.reply`; `run_transaction` then returns that reply as `REJECTED`, and the `error` line at line 433 is written only for `FAILED`. Also `get_user` and `export_personal_data` answer `fail('internal')` at server/core/admin-api/operations.ts:132 and :150 when `run_user_transaction` is `FAILED`, without a log line. `storage` does not log these failures (`run_user` and `lock_row` of server/core/storage/tx.ts only return `FAILED`). Both 500 rows of `## error` in skills/server-core/modules/admin-api.md have the `error` log, and neither row names this condition. It was checked by reading the code, not by running it. It existed before the range.
- settings/core-settings.schema.json:87: medium `spec`. `admin-api.switchCacheMs` has `minimum` 0, and `schedule_job` makes a period below 1 a server start failure (server/core/server-time/scheduler.ts:164, called from server/core/admin-api/index.ts:487). So game settings `core` with value 0 passes the schema and the server does not start. The range gave `routing.storageSweepIntervalMs` the minimum 1 and did not change this key. The cause is the settings row at skills/server-core/modules/admin-api.md:286, and it is already D1 of records/review-debt/spec-admin-api.json. That list is not an input list of this review, so it is written here. It existed before the range.

## debt

none

## must fix

none

## unknown

- The range does not change `server/core/admin-api/`, `core-spec/admin-api.json` or the code of `storage`, `server-time`, `logging`, `item-ledger`, `mailbox`, and input `## spec changes` is `none`. The changes checked for their effect on admin-api are `coupon.maxCodePicks` in `create_coupon`, the removal of `admin-api.maxBodyBytes` from `core-spec/user-snapshot-clone.json` (its code does not read that key; only its tests set it for admin-api), `server/core/Dockerfile`, the settings schema and `setting_types.ts`.
- `ogw core test server admin-api` reported `admin-api pass` on the range end. The output does not say whether that result was run or reused from a stored pass with the same key. The whole core test suite was not run.
- The 500 of the first `## out of scope` line was not sent as an HTTP request. The body check and `canonical_json` were run in a scratch script, and the rest of the path was read. `mail_input_from_json` was not checked with a non-finite number, because the exception comes before it.
- The tests were not restored with defects in a temporary copy, and no mutation run checked whether they fail on changed code. Test titles were compared with `## test` of the spec, and `COLLECTED` of server/core/admin-api/tests/auth.test.ts was compared with the collected operation table. Both comparisons found no gap.
- The handler functions of collected operations, `routing`'s collection of them and `routing`'s client IP handling (`trustedProxyCount`) were not reviewed. They belong to other targets.
- PostgreSQL behavior of the lock failure path was not run.
