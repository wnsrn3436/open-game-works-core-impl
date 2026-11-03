# review public-profile round 1

## findings

none

## previous

none

## out of scope

- server/core/public-profile/index.ts:267: medium `spec`: `expires_at` of `public_profile_find_counter` being the window end has no test. Replacing `window_start + MINUTE_MS` with `window_start` in a temporary copy leaves all 35 tests of `server/core/public-profile/tests` passing, yet the row is then deleted by a `storage.sweep_expired` run inside the window and the count restarts: a temporary test with `public-profile.findPerMinute` 1 (`count_find_attempt`, `sweep_expired`, `count_find_attempt`) got `pass` instead of `RATE_LIMITED`. The same temporary test passes on the unchanged code.
- server/core/public-profile/index.ts:171: medium `spec`: the expiry column of `public_profile_find_counter` has no test. Registering the table with expiry column `null` in a temporary copy leaves all 35 tests passing, and the row of a finished window then stays after `storage.sweep_expired`: a temporary test that advanced the clock 120000 ms and swept still found the row.
- server/core/public-profile/index.ts:170: medium `spec`: snapshot flag `false` of `public_profile_activity` and `public_profile_find_counter` (`### last active`, `### find by public code`) has no test. Changing both flags to `true` here and at server/core/public-profile/index.ts:171 in a temporary copy leaves the 35 public-profile tests and the 80 tests of `server/core/user-snapshot-clone/tests` passing, and no other test file under `server/core` names these tables.
- server/core/public-profile/index.ts:210: medium `efficiency`: profile build runs one `storage.get_user_record` query (`SELECT ... FROM "user" WHERE user_id = $1`, server/core/storage/rows.ts:88) per input user ID, and `get_public_profiles` has no limit on the user ID count. Measured calls of one `get_public_profiles`: 1 ID gives 1, 3 give 3, 6 give 6, 12 give 12. The growing amount is the list that the caller passes, e.g. the channel list at server/core/chat/index.ts:398 and the block list at server/core/block-report/index.ts:428. `storage` has no read of several `user` rows and `## behavior` of the spec sets `get_user_record` as the source, so the fix needs a spec change in `storage` and `public-profile`.

## debt

none

## must fix

none

## unknown

- The commit range changes no file of `server/core/public-profile/`, `core-spec/public-profile.json`, the `public-profile.*` and `nickname.maxLookupCount` settings, `proto/`, or the code of `storage`, `nickname`, `logging` and `server-time`. Input `## spec changes` is `none`. The range's diffs read were `core-spec/`, `settings/`, `server/core/testing/dev/setting_types.ts`, `server/core/matchmaker/shared.ts`, `server/core/routing/tests/storage-sweep.test.ts` and `tools/data-tool/src/corespec.ts`. The other server changes of the range (`server/core/coupon/`, `server/core/matchmaker/realtime.ts`, `server/core/Dockerfile`, `server/core/routing/tests/server-image.test.ts`) were judged only from the file list and were not read
- `server/core/public-profile/tests` ran at the commit under review in a temporary copy, with vitest run directly and not through `ogw core test`: 35 passed on SQLite and 35 passed on PostgreSQL. `server/build/` of that copy came from `open-game-works-core-impl/`, whose HEAD is later than the commit under review. The mutation runs and temporary tests ran on SQLite only
- The tests of the modules that call public-profile (`friend`, `block-report`, `guild`, `chat`, `auth`, `routing`) were not run. A mutation of the out of scope lines was therefore not run against them, apart from the search for the two table names under `server/core`
- `## behavior`, `## API`, `## error` and `## test` of the public-profile spec were read in full and compared with the code and tests. `storage`, `nickname`, `logging`, `server-time`, `routing`, `core`, `core` `command.md` and `server-core` were read only in the sections this module uses, found by searching, so rules in their other sections were not compared with the code
- The code of `nickname`, `storage`, `logging`, `server-time` and `routing` was read only where public-profile calls it. Those modules are other review targets
