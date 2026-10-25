# review remote-config round 1

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

- No file under `server/core/remote-config/` changed in the commit range. The changes that reach remote-config are in `storage` (user IDs are secure random integers below 2^53 from `pick_user_id`, `create_user` returns `{ user_id, public_code }`, core schema version 2 with the start fill of `"user".public_code`) and `routing` (`get_user_record` in step 6, `FindUserByPublicCode` in the prepare, rpc and admin operation tables). remote-config calls only `register_table`, `db`, `read_db`, `lock_game_row` and `after_commit` of `storage` (`server/core/remote-config/index.ts:14`), none of which changed, and it does not call `create_user` or `get_user_record`. `assign_group` (`server/core/remote-config/assign.ts:15`) takes the user ID as a bigint and writes it in decimal, so user IDs below 2^53 give the hash input that `## behavior` sets
- The remote-config tests were read for assumptions on user ID creation order: `new_user` (`server/core/remote-config/tests/helpers.ts:171`) logs in by account name and no test expects a fixed group for a user; the group checks read the assigned group first (`tests/client.test.ts:69`, `tests/request-cost.test.ts:42`, `tests/value.test.ts:85`). `tests/instance.test.ts:24` expects more than one group among 20 users with weights 1, 2, 3, 4; with random user IDs the chance that all 20 get one group is below 1e-7, so it was not written as a finding. `tests/group.test.ts` uses the fixed user IDs of the `remote-config-group` fixture and does not depend on `storage`
- The tests were not run in this review. The record `records/1792943805934-update-core-mvo0g6paabed90.md` states a passing `ogw core test server` run of all modules after the storage change, and `records/1792947513155-update-core-mvo2nn7kb4e445.md` a passing run of the edited modules and their dependents; those runs were not checked again here
- PostgreSQL behavior of `lock_game_row` on key 0 of `remote_config_experiment` (a row that does not exist) was not checked; it did not change in the range
