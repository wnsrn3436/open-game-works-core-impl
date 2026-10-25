# review: idempotency round 1

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

- In the commit range, the only change under `server/core/idempotency/` is `server/core/idempotency/tests/helpers.ts:85`: `new_user` now reads `.user_id` from the `NewUser` that `storage.create_user` returns. `server/core/idempotency/index.ts` is unchanged. It calls only `storage.register_table` and `storage.db`, and those did not change in the range. The range's storage changes (`server/core/storage/rows.ts`, `server/core/storage/schema.ts`, `server/core/storage/public_code.ts`) affect idempotency in one way: user IDs are now random below 2^53 instead of following creation order. They still fit the `int64` `user_id` column of `idempotency_response`. No idempotency test depends on the user ID value or on creation order: the multi-user test (`server/core/idempotency/tests/request-id.test.ts:122`) only keeps two users apart, and the access tokens are built from the user ID string.
- I did not run the idempotency tests. A direct vitest run outside `ogw core test` failed in every test before reaching idempotency code, because no server build data folder was given (`OGW_SERVER_DATA`). That is a test-input problem, not an idempotency result. The update core record `records/1792943805934-update-core-mvo0g6paabed90.md` reports that `ogw core test server` passed for all modules after this change, but I did not reproduce that run.
- I did not check PostgreSQL behavior.
