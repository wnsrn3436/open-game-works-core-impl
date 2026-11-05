# review tutorial round 1

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

- The range 51d323b..7bb6c4e does not change `server/core/tutorial/` or `core-spec/tutorial.json`. The changes reviewed for their effect on tutorial are the `storage` changes that tutorial calls through (`server/core/storage/tx.ts` `body` and `run_savepoint` broken-transaction handling, `lock_row`, `mark_broken`, the new `get_states` and `get_user_records`), `server/core/logging/log_line.ts` `truncate_ip`, and the new `[tutorial_silent]` rows of `test-data/data/tables/tutorial.csv` and `test-data/data/tables/tutorial_step.csv` with `server/dev/generated/data/game_data_dev.ts`. tutorial catches no storage failure, so the new rule that a body returning after a broken statement ends as `FAILED` does not change its results; the new test data rows are used only by client `TutorialCore` tests and no tutorial server test counts table rows
- `ogw core test server tutorial` passed on both runs (SQLite and PostgreSQL) on 7bb6c4e
- Code of `storage` and `logging` was read only where tutorial calls it (`get_state`, `put_core_state`, `delete_core_state`, `write`, `track_core_event`) and where the range changed it; their own correctness is the scope of their reviews
