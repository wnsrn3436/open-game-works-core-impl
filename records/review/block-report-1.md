# review block-report round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | `correctness` | medium | server/core/block-report/index.ts:296 | Input `## debt` D1, still present. `valid_context_name` checks `ref` only with `utf8_bytes(ref) > settings.max_ref_bytes`; the generated rule of `ReportUserRequest.ref` (server/generated/contract/core_contract.ts:6037, `max_len: 128`) runs `Wire.validate`, which checks only `isWellFormed` and `max_len` for a string (server/generated/contract/wire.ts:636-638). No check rejects U+0000. So `core/ReportUser` with `ref` `a\u0000b` reaches the `INSERT INTO block_report_report` at index.ts:349-352: SQLite stores the row and returns success; PostgreSQL rejects a NUL byte in a text value, so the request ends `INTERNAL` with an `unhandled exception` `error` log and no row. The same input gives different results on the two DBs, against `storage` `## behavior`, and the client gets `INTERNAL` in place of `INVALID_REQUEST` | Reject `ref` that holds U+0000 as `INVALID_INPUT` in `valid_context_name` (or define in the spec which characters `ref` may hold and check that), and add a test of `ReportUser` with that `ref` on both DBs | no | 85 |
| R1-2 | `efficiency` | medium | server/core/block-report/index.ts:414 | Input `## debt` D3, still present. `BlockUser` of a not-yet-blocked target loops over every block row of the caller (index.ts:413) and calls `profiles.is_active_user` for each, and each call is one `storage.get_user_record` query (server/core/public-profile/index.ts:181). The number of queries per `BlockUser` grows with the caller's block row count, up to `block-report.maxBlocks` (default 100, no schema maximum) | Read the withdrawal state of all `blocked_id` values in one query (e.g. one batch read of user records), then delete the rows of withdrawn users | no | 90 |
| R1-3 | `test evidence` | medium | server/core/block-report/index.ts:297 | Input `## debt` D4, still present. No block-report test sets `block-report.maxCommentLength` or sends a comment longer than the limit (grep of server/core/**/*.test.ts finds no `maxCommentLength`); the comment tests at server/core/block-report/tests/report.test.ts:119-120 and :172 fail on the plain text rule only. Replacing `settings.max_comment_length` at this line with a large constant leaves every test passing | Add a test: a comment of limit+1 code points is `INVALID_REQUEST` in `ReportUser` and `INVALID_INPUT` in `add_report`, and one of limit code points is accepted | no | 90 |
| R1-4 | `test evidence` | medium | server/core/block-report/index.ts:453 | Input `## debt` D5, still present. `## error` sets log `none` for `INVALID_INPUT` of `add_report` in `ReportUser`. The `ReportUser` `INVALID_REQUEST` test (server/core/block-report/tests/report.test.ts:112-124) reads no logs, so passing `true` as `log_invalid` at this line leaves every test passing | In that test, check that no `error` log line is written for the `INVALID_REQUEST` results | no | 90 |
| R1-5 | `test evidence` | medium | server/core/block-report/index.ts:331 | Input `## debt` D6, still present. No test reads `block_report_count` (no test file names it). The window test (server/core/block-report/tests/report.test.ts:64-80) advances by one window, where the new `window_start` differs and the count restarts whatever `expires_at` is, so `window_end = window_start + 5 * settings.report_window_ms` leaves every test passing | Add a test that reads the counter row and checks `expires_at` = `window_start` + `block-report.reportWindowMs` | no | 85 |
| R1-6 | `test evidence` | medium | server/core/block-report/index.ts:328 | Input `## debt` D7, still present. No block-report test sets a cheat time offset (no test uses one), and `server-time` puts that offset only into the request time, so request time equals `clock_now` in every test. Using `clock_now` in place of `request_time` for the fixed window (index.ts:330), for report `created_at` (index.ts:351) or `time.clock_now()` for block row `created_at` (index.ts:418) leaves every test passing | Add tests with a cheat time offset that check the window, report `created_at` and block `blocked_at` follow the request time | no | 85 |
| R1-7 | `test evidence` | medium | server/core/block-report/index.ts:468 | Input `## debt` D8, still present. `## error` sets an `error` log for a second `register_block_listener` of the same function; server/core/block-report/tests/start.test.ts:9-12 checks only that server start rejects. Deleting the `core_log` call at this line leaves every test passing | Check the `error` log line in that test | no | 90 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | No U+0000 check on `ref` in index.ts:291-303 nor in the generated rule (wire.ts:636-638) |
| D3 | open | R1-2 | index.ts:413-414 still calls `is_active_user` (one `get_user_record` query) per block row |
| D4 | open | R1-3 | No test uses `block-report.maxCommentLength` or an over-length comment |
| D5 | open | R1-4 | report.test.ts:112-124 reads no logs |
| D6 | open | R1-5 | No test reads `block_report_count` |
| D7 | open | R1-6 | No block-report test uses a cheat time offset |
| D8 | open | R1-7 | start.test.ts:9-12 checks only the start failure |

## must fix

none

## unknown

- The commit range is empty (`ab75c82..ab75c82`), so no changed code was reviewed; this round checked only the input `## debt` items against the current code and tests.
- The tests were not run: `ogw core test` needs Docker PostgreSQL, and the test-evidence findings come from reading every test file of server/core/block-report/tests and grepping the other modules' tests, not from mutation runs in this round. The PostgreSQL result of R1-1 is from known PostgreSQL behavior with NUL bytes in text values and the D1 report, not from a run in this round.
