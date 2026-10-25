# review loot-table round 1

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

- Commit range 2ef5ae8d..3ca53c4 changes no file under `server/core/loot-table/`. The changes in the range that reach the dependencies of loot-table are in `storage` (`create_user` now returns `NewUser`, `get_user_record` adds `public_code`, new `find_user_by_public_code` and `is_public_code_input`, core schema version 2 with `fill_public_codes` at server start) and test helpers of `item-ledger` and `logging`. loot-table calls only `storage.random_weighted` (`server/core/loot-table/index.ts:245`), `item-ledger` `amount_limit`, `read_amount`, `make_item_amount` and `logging.write`; none of them changed in the range (`server/core/storage/random.ts:51` is unchanged), and `server/core/loot-table/tests/helpers.ts` does not call `create_user`. So no change of the range causes or reveals a problem of loot-table
- The loot-table core tests were not run: `server/build/data` (the `OGW_SERVER_DATA` input of a server module test) is not built in this checkout. Whether the test server start (`start_test_server`, which now runs `fill_public_codes` and the version 2 schema) still passes for the loot-table tests was not checked by a run
- The PostgreSQL behavior of the storage changes was not checked; it belongs to the `storage` review, not this target
