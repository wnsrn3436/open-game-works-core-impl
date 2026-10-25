# review mission round 1

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

- The range 2ef5ae8d3d40c74ba1bc3385efee1c2c0591c772..5c9b8c8bf66ee12bc077ffce2b664d1ab97bc204 changes no file under `server/core/mission/`. The changes that `mission` reaches are in `storage` (`server/core/storage/rows.ts` `create_user` now returns `NewUser` with a random `user_id` and a `public_code`, `server/core/storage/schema.ts` core schema version 2 and the start fill of `public_code`, `server/core/storage/index.ts` new members `find_user_by_public_code` and `is_public_code_input`) and `routing` (`server/core/routing/pipeline.ts` `public_code` in the ban detail, `server/core/routing/spec_tables.ts` `FindUserByPublicCode`). `mission` calls only `get_state`, `put_core_state`, `with_hook_change_source` and `check_hook_output` of `storage` (`server/core/mission/deps.ts:10`), none of which changed, and its code does not depend on the order or form of user IDs. `server/core/mission/tests/support.ts` creates users through `testing` `login`, not `storage.create_user`, so the changed return type does not reach it. `mailbox`, `live-event`, `validation`, `server-time`, `logging` and `item-ledger` have no non-test code change in the range
- The core tests of `mission` were not run by this review (the review does not write files outside `output`, and `ogw core test` writes `core-spec/` and test records). The record `records/1792947513155-update-core-mvo2nn7kb4e445.md` states `ogw core test server` passed for the edited modules and their dependents (4934/4934); `mission` depends on `storage`, but this review did not check that `mission` was in that run
- The client `UserStateCore.get_mission_progress` (the same round reset and lazy reset rules on the client) is not part of this server module target and was not checked
- The data rules of `mission.csv` (`target` range, empty `reward` with `extra_grant` `false`) are checked by `tools/data-tool/src/checks/mission.ts`, which is outside this target and was not read
