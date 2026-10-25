# review cheat round 1

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

- In the commit range, the only file of the cheat module that changed is `server/core/cheat/tests/support.ts:99`: `new_user` takes `.user_id` from the `NewUser` that `storage.create_user` now returns (`server/core/storage/rows.ts:51-68`). This matches the new return type, and the `'FAILED'` check of `run_game_transaction` still applies to the transaction result. The cheat module code in `server/core/cheat/dev/` did not change in the range
- The other changes in the range that the cheat module reaches were checked against cheat: `storage.create_user` now picks random user IDs below 2^53 and a public code (`server/core/storage/rows.ts:57-67`), schema version 2 adds `"user".public_code` (`server/core/storage/schema.ts:218-220`), and step 6 ban of `routing` reads the public code (`server/core/routing/pipeline.ts:579-588`), which returns early for cheat requests (`target.cheat`) before that. No cheat code or test depends on sequential user IDs (the user IDs in `server/core/cheat/tests/*.ts` come from `new_user` or a session), `cheat_time_offset` keys on `user_id` as `int64`, and the `audit` log `user_id` is written by `routing` DEV code, so these changes cause no cheat finding
- The cheat tests were not run: `server/` has no installed `node_modules` in this checkout, and running `ogw core test` is outside what the review agent does. Whether the cheat tests pass on `b99875f` was therefore checked only by reading
- The DEV code of `routing` (dev access, processing order, `audit` log) and `testing` are outside the target module code and did not change in the range for cheat behavior; they were not reviewed beyond the step 6 change above
