# review block-report round 1

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

- The range 2ef5ae8d..b99875f changes no file of `server/core/block-report/`. The changes reviewed for their effect on block-report are those of its dependencies: `storage` (random user IDs below 2^53, `public_code` in `UserRecord`, `create_user` returning `NewUser`, core schema 2 and the start fill of public codes) and `public-profile` (`get_public_profiles` reading `get_user_record` directly and filling `PublicProfileEntry.public_code`, `FindUserByPublicCode`, `count_find_attempt`). `is_active_user` and the `get_public_profiles` signature that block-report calls are unchanged, and the withdrawn and missing user filter of `get_public_profiles` gives the same users as before, so `BlockUser`, `ReportUser` and `GetBlockedUsers` keep their behavior.
- The block-report tests that depend on user ID order (`server/core/block-report/tests/block.test.ts` GetBlockedUsers tie order, list over `public-profile.maxRequestCount`, `list_blocked_ids` ascending) already compute the expected order from the user IDs, so random user IDs do not make them depend on the order users were made. The USER_NOT_FOUND tests use `alice.user_id + 1_000_000n` as a missing user; with random IDs below 2^53 it can only hit one of the few other users of the test with negligible probability.
- Tests were run only with SQLite (`OGW_DEFAULT_DB=sqlite`, vitest of the ogw tools, data from `open-game-works-core-impl/server/build/data`): 5 files, 46 tests passed. The PostgreSQL run was not done because no PostgreSQL database was given to this review.
- The new `public_code` value inside the `PublicProfileEntry` of `GetBlockedUsers` is not checked by block-report tests; it is behavior of `public-profile`, whose tests check it, and outside this target.
