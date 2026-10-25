# review: logging round 1

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

- In the range `2ef5ae8d..4d3efc4` the only change under `server/core/logging/` is `server/core/logging/tests/helpers.ts:150` (`new_user` takes `.user_id` of the new `storage.create_user` result `NewUser`). It matches `server/core/storage/rows.ts:57` and `server/core/storage/index.ts:162`. No logging code calls `create_user`
- The storage changes in the range that logging reaches were checked: user IDs are now random below 2^53 (`server/core/storage/public_code.ts:16`). logging keeps user IDs as `bigint` and writes them as decimal strings (`server/core/logging/log_line.ts:61`, `server/core/logging/adapters/analytics_ga4.ts:84`, `server/core/logging/adapters/analytics_ga4.ts:183`), and the security window group key uses `user_id.toString()` (`server/core/logging/log_line.ts:135`). No user ID is changed to `Number`. The admin list tests that order by `(time_at, user_id, seq)` sort the two users before they assert (`server/core/logging/tests/client-log.test.ts:208`, `server/core/logging/tests/server-event.test.ts:169`), so they do not depend on the order in which IDs are created
- The `user` table's new `public_code` column and start fill (`server/core/storage/schema.ts:218`, `server/core/storage/schema.ts:317`) and the routing ban detail `public_code` (`server/core/routing/pipeline.ts:588`) are not used by logging, and the logging spec says nothing about public codes
- The logging tests were run with vitest on SQLite only (`OGW_DEFAULT_DB=sqlite`). Server build data came from `open-game-works-core-impl/server/build/data`, not from a build of this checkout. 82 of 82 passed in each of 7 runs. They were not run on PostgreSQL, because no PostgreSQL connection was available to this review
