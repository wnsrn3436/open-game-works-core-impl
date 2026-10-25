# review: routing round 1

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

- The commit range `d4e2728..c6a1194` changes no file under `server/core/routing/`. The server changes are in `server/core/auth/login.ts`, `server/core/auth/deletion.ts`, `server/core/auth/dev/index.ts` and `server/core/testing/dev/setting_types.ts`. For routing, the only places reached are the token-less handler outputs that `process_tokenless` (`server/core/routing/pipeline.ts:510`) consumes, and the `POST /account/deletion` route. I checked these: `claim_key` now returns `user_id` = the new user on `WITHDRAWN`/`FAILED`, `create_user` and `transaction_failed` add an `error` log in auth, and routing's `fail` (`server/core/routing/pipeline.ts:207`) adds no second `error` log. Routing code outside these paths was not re-reviewed, because the range does not change it
- I ran the routing core tests and `server/core/auth/tests/transaction-failure.test.ts` only with `OGW_DEFAULT_DB=sqlite`, and they passed (126 tests). `OGW_SERVER_DATA` pointed at `open-game-works-core-impl/server/build/data`, not at a build of this checkout, since this checkout has no `server/build/data` and the range does not change `test-data/`. The `postgresql` run was not done because no PostgreSQL input was available
- In DEV, `server_time_at` (`server/core/routing/pipeline.ts:185`) of a token-less failure that now carries the new user's ID calls `server-time.user_now`, which reads the DB through the cheat offset provider. I did not check or reproduce whether this read throws when the cause of the `FAILED` transaction is the DB itself, so it is not a finding
- Whether `user_id` of a `claim_key` `WITHDRAWN`/`FAILED` output should be the new user or none is not settled. Routing spec `## API` says "the user ID that the handler decided"; `### request processing order` says "auth finds the user"; auth spec `Login` step 3 says the user is the key's user after the commit. The only observable difference is `user_id` of the `request` log line, because a new user has no time offset. Confidence is below 80, so it is not written as a finding or as out of scope
