# review block-report round 2

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R2-1 | correctness | medium | server/core/block-report/index.ts:296 | `ref` has only a byte limit (`utf8_bytes(ref)`, `max_len_key`), and `evidence` too (index.ts:298). Run through `core/ReportUser` with `ref` `a\u0000b`: SQLite returns success and writes the row; PostgreSQL returns `INTERNAL` (code 8), leaves the `error` log `unhandled exception` for `core/ReportUser` and writes no row. `add_report` with `ref` `x\u0000y` or `evidence` `a\u0000b` in a `RunCoreTest` request: SQLite `OK`, PostgreSQL request code 8. A `comment` with U+0000 is `INVALID_REQUEST` on both, through `is_plain_text`. `storage` `## behavior` requires queries that give the same result in both DBs | State in the `ref` rule that it has no U+0000, and the same for `evidence` of `add_report`, so that `ReportResult.INVALID_INPUT` covers them, then reject them in `valid_context_name` and test it on both DBs. `ref` is not plain text by spec today, so the code alone has no rule to apply | yes | 95 |
| R2-2 | efficiency | medium | server/core/block-report/index.ts:414 | `BlockUser` of a new target calls `public-profile.is_active_user` once per existing block row, and each call is one `storage.get_user_record` query (server/core/public-profile/index.ts:181). Spy on `is_active_user` for six successive `BlockUser` requests on both DBs: 1, 2, 3, 4, 5, 6 calls. The growing amount is the user's block row count, up to `block-report.maxBlocks` (default 100; the schema sets a minimum of 0 and no maximum) | Judge the rows in one query. `storage` reads the `user` table only with `get_user_record`, `find_user_by_public_code`, `scan_users` and `sample_users`, `public-profile` has no list form of `is_active_user`, and `get_public_profiles` calls a hook per user, so this needs a list operation in `storage` and `public-profile`, or a change of step 4 of `BlockUser` so that it scans only at the limit | yes | 90 |
| R2-3 | test evidence | medium | server/core/block-report/index.ts:297 | No test checks the `block-report.maxCommentLength` limit. Replacing `settings.max_comment_length` with 1000000 at this line leaves all block-report tests passing (48 passed, 3 skipped on SQLite). A probe shows the current code is right on both DBs: with a limit of 3, a 3 code point comment succeeds, a 4 code point comment is `INVALID_REQUEST` in `ReportUser` and `INVALID_INPUT` in `add_report` | Add a test with a low `block-report.maxCommentLength`: the limit passes and one code point more is refused, through `ReportUser` and `add_report` | no | 95 |
| R2-4 | test evidence | medium | server/core/block-report/index.ts:453 | `## error` sets log `none` for `INVALID_INPUT` of `add_report` in `ReportUser`, and no test checks it. Passing `log_invalid` `true` at this line leaves all block-report tests passing (48 passed, 3 skipped on SQLite). A probe shows the current code is right on both DBs: 0 `error` lines after that `ReportUser`, 1 after an invalid `add_report` of a content handler | In the `INVALID_REQUEST` test of `ReportUser`, assert that `read_logs` has no `error` line from `add_report` | no | 95 |
| R2-5 | test evidence | medium | server/core/block-report/index.ts:331 | No test checks `expires_at` of `block_report_count`. Making it window start + 5 × `block-report.reportWindowMs` at this line leaves all block-report tests passing (48 passed, 3 skipped on SQLite). A probe shows the current code is right on both DBs: with a window of 60000 at time 1800000000000, the row has `window_start` 1800000000000 and `expires_at` 1800000060000 | Assert `window_start` and `expires_at` of the counter row after a report | no | 95 |
| R2-6 | test evidence | medium | server/core/block-report/index.ts:330 | No block-report test uses a cheat time offset, and `server-time` puts that offset only into the request time, so no test tells the request time from `clock_now`. Each of these leaves all block-report tests passing (48 passed, 3 skipped on SQLite): the fixed window from `clock_now` (index.ts:330), report `created_at` from `clock_now` (index.ts:351), block row `created_at` from `clock_now` (index.ts:418). A probe with `core/cheat/SetTimeOffset` of 420000 shows the current code is right on both DBs: `window_start`, report `created_at` and block row `created_at` all follow clock + offset | Add a test with `core/cheat/SetTimeOffset` that asserts the three values against the request time | no | 95 |
| R2-7 | test evidence | medium | server/core/block-report/index.ts:468 | `## error` sets an `error` log for a second `register_block_listener` of the same function, and the test checks only the server start failure (server/core/block-report/tests/start.test.ts:9). Deleting the log call at this line leaves all block-report tests passing (48 passed, 3 skipped on SQLite) | Make the test also check the `error` log line that the failed start wrote | no | 95 |

## previous

none. Round 1 had no findings

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R2-1 | Reproduced on both DBs at the current code: SQLite success with a row, PostgreSQL code 8 with the `error` log `unhandled exception` and no row. The position moved to index.ts:296 |
| D2 | fixed | none | `add_report` takes the `block_report_sequence` lock and then reads `is_active_user` on the connection of its transaction (index.ts:339 to 343), and `remove_user` takes the same lock before it empties `evidence` (index.ts:477). Every withdrawal goes through `withdraw` in the user transaction (server/core/auth/withdraw.ts:12), and `report_chat_message` calls `add_report` with the text it read (server/core/chat/index.ts:370). Run on PostgreSQL in a temporary copy, `server/core/block-report/tests/withdraw.test.ts`, 8 tests: `kept_evidence = evidence` fails the test at line 64 and the peer test at line 129, and removing the lock in `remove_user` fails the tests at lines 74, 114 and 129 |
| D3 | open | R2-2 | Measured again on both DBs: 1, 2, 3, 4, 5, 6 `is_active_user` calls. The position moved to index.ts:414 |
| D4 | open | R2-3 | The mutation at index.ts:297 leaves all tests passing |
| D5 | open | R2-4 | The mutation at index.ts:453 leaves all tests passing |
| D6 | open | R2-5 | The mutation at index.ts:331 leaves all tests passing |
| D7 | open | R2-6 | The three mutations at index.ts:330, 351 and 418 each leave all tests passing |
| D8 | open | R2-7 | Deleting the log call at index.ts:468 leaves all tests passing |

## must fix

none

## unknown

- The commit range is empty (`f400b974f99d22a044b8cdf5c2a1b3228dac631b` on both sides) and input `## spec changes` is `none`, so this round judged only the input `## debt` items. It is not a review of the whole target
- The input `## previous review` path is in another workspace folder (`ogw-dev`, not `ogw-debt`). That file was byte-identical to `records/review/block-report-1.md` of this checkout, which was used
- Runs of this review: `ogw core test server block-report` passes. In a temporary copy outside the checkout, the unchanged tests gave 48 passed and 3 skipped on SQLite and 51 passed on PostgreSQL (PostgreSQL 18.6 in a throwaway container). The modules that depend on `block-report` (`auth`, `chat`, `friend`, `matchmaker`, `routing`) were not run
- The mutations of D4 to D8 were run on SQLite only. The 3 tests skipped there are the PostgreSQL peer tests in `server/core/block-report/tests/withdraw.test.ts`, which by reading check none of those values. The probes of D1 and D3 to D7 ran on both DBs. The mutations of D2 ran on PostgreSQL only, on `withdraw.test.ts` only
- D1: `core/ReportUser` and `add_report` were run with U+0000. Other values that PostgreSQL refuses in `text` were not tried
- D2: the interleaving was run with the two peer tests of `withdraw.test.ts`. `report_chat_message` itself was read and not run across two server instances. `withdraw` was read for the callers named in its header comment; `server/core/auth/guest_sweep.ts` and the other callers were not followed one by one in this round
- D8: whether the log line of a failed start can be read with the current test helpers was not checked, so the fix of R2-7 does not name a helper
- Lock order between `remove_user` and `add_report`, listed in round 1 as not run, was not run in this round
