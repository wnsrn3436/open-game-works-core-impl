# review offer round 1

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

- No file of `server/core/offer/` changed in 51d323b..d593421, and no change in that range touches `server/generated/`, the `offer` table of `test-data/`, `server/core/live-event/`, `server/core/validation/` or `server/core/server-time/`. The changes in that range that offer reaches are `server/core/storage/` (`get_states`, `get_user_records`, `in_id_list`, the transaction `body` and `run_savepoint` handling of a broken transaction, `lock_row`, `run_user_changes`) and `server/core/logging/log_line.ts` (`truncate_ip`). offer calls only `get_state`, `put_core_state`, `delete_core_state`, `logging.write` and `logging.track_core_event`, catches no throw of them, and none of their signatures or results changed, so no problem in offer is caused or revealed by those changes. Checked by reading `server/core/offer/index.ts`, `server/core/offer/deps.ts`, `server/core/offer/dev/index.ts`, the offer tests and the range diff of storage and logging.
- The core tests of offer were not run: the server package of this checkout has no test runner set up outside `ogw core test`, and no offer code or test changed in the range.
- The whole offer module was also read against `skills/server-core/modules/offer.md` for problems outside the range of severity `medium` or higher; none was found. Every `## test` item of the spec has a test in `server/core/offer/tests/` or, for the data rules, `tools/data-tool/tests/offer-check.test.ts`; whether each of those tests fails on a defect was not checked by restoring defects.
