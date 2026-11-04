# attendance review round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | New test server/core/attendance/tests/errors.test.ts:76 spies on the `mailbox` module object that attendance calls (server/core/attendance/index.ts:154), runs the real `grant_or_mail` and returns `UNKNOWN_ITEM`, `INVALID_AMOUNT`, `UNSUPPORTED_ITEM`, `INVALID_INPUT`, and asserts `INTERNAL`, no item changes, no progress, gold 0 and no mail. Restored the defect in a temporary copy of the checkout in the scratchpad (outside the target checkout): changed `default: return CoreError.CORE_ERROR_INTERNAL` at server/core/attendance/index.ts:234 to `return 'pass'`; vitest on server/core/attendance/tests (SQLite) failed 1 of 35, that test (`expected +0 to be 8`) |
| R1-2 | fixed | New row `[attendance_extra],3,,true` in test-data/data/tables/attendance_reward.csv:30 and test server/core/attendance/tests/hooks.test.ts:109 claim day 3 and assert `grant_or_mail` not called, `day` 3, empty `items`, `mailed` false, no item mails, `grant_attendance_extra` called with `(calendar, 3)`, progress saved. Restored the defect in the temporary copy: removed `if (reward.length === 0) return 'pass';` at server/core/attendance/index.ts:220; that test failed (`expected "grant_or_mail" to not be called at all, but actually been called 1 times`), 34 of 35 passed |
| R1-3 | fixed | New test server/core/attendance/tests/dev.test.ts:53: claim, `set_attendance` day 0, claim again on the same game day; asserts `grant_or_mail` returned `AlreadyApplied`, the claim succeeds with `day` 1, no second grant (gold stays 10), no mail, progress day 1 claimed today. Restored the defect in the temporary copy: the `AlreadyApplied` branch at server/core/attendance/index.ts:231-232 returning `CoreError.CORE_ERROR_INTERNAL`; that test failed (`expected 8 to be +0`), 34 of 35 passed |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | Same item as R1-1; the `grant_or_mail` failure path is now tested by server/core/attendance/tests/errors.test.ts:76, which fails when the defect is restored (see `## previous` R1-1) |
| D2 | fixed | none | Same item as R1-2; test-data/data/tables/attendance_reward.csv:30 has an empty `reward` row with `extra_grant` true and server/core/attendance/tests/hooks.test.ts:109 fails when index.ts:220 is removed (see `## previous` R1-2) |
| D3 | fixed | none | Same item as R1-3; server/core/attendance/tests/dev.test.ts:53 reaches the `AlreadyApplied` branch and fails when it is changed to `INTERNAL` (see `## previous` R1-3) |

## must fix

none

## unknown

- The restore runs and the unchanged run (35 of 35 passed) used vitest directly on SQLite in a copy of the checkout; the PostgreSQL run was not repeated for the restores. `ogw core test server attendance` on this checkout passed on both databases
- Client core tests were not run. The new data row is read by client tests only through dynamic counts (client/godot/core/data_core/tests/test_derived.gd:160 counts rows per `id` and asserts only on `[attendance_window]`), and no client test or the `attendance-progress` fixture uses `[attendance_extra]`; checked by reading only
- The core tests of modules that depend on attendance were not run in this round (`ogw review run` runs them after each fix)
- The other files of the commit range (play-session and user-snapshot-clone tests, review records of other targets) are outside this target and were not reviewed
