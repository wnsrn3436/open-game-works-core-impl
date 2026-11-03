# review block-report round 1

## findings

none

## previous

none

## out of scope

- server/core/block-report/index.ts:295: medium `correctness`: `ReportUser` with `ref` `a\u0000b` passes every check, because `ref` has only a byte limit (`max_len_key`, `utf8_bytes(ref)`) and neither `validation.is_plain_text` nor any other check rejects U+0000. Run through `core/ReportUser` on both DBs: SQLite returns success and writes the row; PostgreSQL returns `INTERNAL` (code 8), leaves the `error` log `unhandled exception` and writes no row. So a client gets `INTERNAL` and an `error` log for each such request, in place of `INVALID_REQUEST`, and the two DBs give different results for the same input (`storage` `## behavior` requires the same result in both DBs). Existed before the range
- server/core/block-report/index.ts:347: medium `correctness`: `add_report` does not check whether the target has already run `remove_user`, so `evidence` can stay after the target withdraws, against `remove_user` in `## behavior` and the `## test` item on `evidence` after `Withdraw`. Run path across two server instances on PostgreSQL: A runs `report_chat_message` and reads the message (server/core/chat/index.ts:366), B runs `Withdraw` of the sender, `chat.remove_user` deletes the message and `remove_user` (server/core/block-report/index.ts:472) empties `evidence` of the existing rows and commits, then A inserts the report with the text it read. `report_chat_message` takes no lock that `remove_user` also takes. The report is `Open` with `expires_at` null, so expiry cleanup does not delete the text until an operator resolves it. Run on one server: after `Withdraw` of bob, `add_report` with evidence `text of bob` returned `OK` and `list_reports` returned `Open`, `text of bob`, null. The interleaving across two instances was not run (see `## unknown`). Existed before the range
- server/core/block-report/index.ts:411: medium `efficiency`: `BlockUser` of a new target calls `public-profile.is_active_user` once per existing block row, and each call is one `storage.get_user_record` query (server/core/public-profile/index.ts:181). Measured `is_active_user` calls for six successive `BlockUser` requests: 1, 2, 3, 4, 5, 6. The growing amount is the user's block row count, up to `block-report.maxBlocks` (default 100; the settings schema sets no maximum). Existed before the range
- server/core/block-report/index.ts:296: medium `test evidence`: no test checks the `block-report.maxCommentLength` limit in `add_report`. Replacing `settings.max_comment_length` with 1000000 at this line leaves all 46 block-report tests passing. A probe confirms the current code is right: a 4 code point comment with a limit of 3 is `INVALID_INPUT` in `add_report` and `INVALID_REQUEST` in `ReportUser`. Existed before the range
- server/core/block-report/index.ts:450: medium `test evidence`: `## error` sets log `none` for `INVALID_INPUT` of `add_report` in `ReportUser`, and no test checks it. Passing `log_invalid` `true` at this line leaves all 46 tests passing. Existed before the range
- server/core/block-report/index.ts:330: medium `test evidence`: no test checks that `expires_at` of `block_report_count` is window start + `block-report.reportWindowMs`. Making it window start + 5 × `block-report.reportWindowMs` leaves all 46 tests passing. Existed before the range
- server/core/block-report/index.ts:329: medium `test evidence`: no test tells the request time from `clock_now`, because no block-report test uses a cheat time offset and `server-time` puts that offset only into the request time. Each of these leaves all 46 tests passing: the fixed window from `clock_now` (index.ts:329, `## behavior` sets the request time), report `created_at` from `clock_now` (index.ts:348), block row `created_at` from `clock_now` (index.ts:415). Existed before the range
- server/core/block-report/index.ts:465: medium `test evidence`: `## error` sets an `error` log for a second `register_block_listener` of the same function, and the test checks only the server start failure (server/core/block-report/tests/start.test.ts:9). Deleting the log call at this line leaves all 46 tests passing. Existed before the range

## debt

none

## must fix

none

## unknown

- The commit range changes nothing in `server/core/block-report/`, `core-spec/block-report.json`, `block-report.*` settings, `proto/` or the server code of its dependencies (`storage`, `server-time`, `logging`, `validation`, `public-profile`). The server changes of the range are in `coupon`, `matchmaker`, the `routing` tests, `server/core/Dockerfile` and `server/core/testing/dev/setting_types.ts`. The one settings change near this module is the `routing.storageSweepIntervalMs` minimum going from 0 to 1, and the block-report tests still pass with it
- Test run: all 46 block-report tests pass on SQLite and on PostgreSQL 18.6. They ran with vitest directly in a temporary copy of the checkout, not through `ogw core test`, and `server/build/data` was copied from `open-game-works-core-impl/` because the checkout has none, so that data was not built from the commit under review. The tests of modules that depend on block-report (`friend`, `chat`, `matchmaker`, `auth`) were not run
- The test `test evidence` lines above come from mutations run on SQLite only. A control mutation that removes the `BLOCK_LIMIT` check failed 1 test, which shows these runs load the mutated file
- The `add_report` and `Withdraw` interleaving was traced by reading code and was not run across two server instances. Only the missing check was run, on one server
- The `audit` log rows of `resolve_report` in `## error` were not checked: the block-report tests do not check them, and the `admin-api` tests that may cover collected operations were not read
- Defining documents read in full: `block-report`. Read only in the sections this module uses, found by searching: `storage`, `server-time`, `logging`, `validation`, `public-profile`, `core`, `core` `command.md`, `server-core`. Rules in the other sections were not compared with the code
- The callers `friend`, `chat`, `matchmaker` and `auth` were read only at their block-report call sites. The behavior of `friend` and `matchmaker` around blocks was not reviewed
