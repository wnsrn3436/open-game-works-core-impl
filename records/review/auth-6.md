# review auth round 6

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

- In the range `2b98bb1..d7f5d28` the only change under server/core/auth/ is the test file server/core/auth/tests/transaction-failure.test.ts. Its fakes `fail_next_call` and `fail_next_query` now mark the transaction of the DB handle as broken through `fail_transaction` (server/core/storage/tests/helpers.ts:334) before they throw the `lock` DbError. This follows the storage change in the same range: in server/core/storage/tx.ts:202 a DB failure that no statement of the transaction threw now rolls back and throws, where before it gave `FAILED`. Transaction DB handles carry an `owner` (server/core/storage/core.ts:186-204), so the fakes still drive the `FAILED` path that open-game-works-core/skills/server-core/modules/storage.md `### transaction` sets. `ogw core test server auth --file server/core/auth/tests/transaction-failure.test.ts` passed on this checkout on both SQLite and PostgreSQL. I did not run the rest of the auth suite
- I read the storage changes in the range for their effect on auth. (1) tx.ts:202 changes the result only for a `lock` or `connection` failure of a `read_db` statement inside a transaction body. Every `read_db` use in auth (account.ts:37, login.ts:273, :323, :345, deletion.ts:232, :262, guest_sweep.ts:38, :41) runs outside a transaction. (2) `check_text_param` (server/core/storage/db/types.ts:99) now also fails a string parameter that holds an unpaired surrogate. The auth strings that can come from a client reach the DB in three ways: decoded from protobuf (always well-formed UTF-16), from the deletion form after a fatal UTF-8 decode (deletion.ts:270) and `URLSearchParams` percent-decoding (deletion.ts:164), which puts U+FFFD in place of bytes that are not valid UTF-8, or from values the provider has verified. So none of them can hold an unpaired surrogate (3) `scan_users` with a version (rows.ts:130) is not used by auth: guest_sweep.ts:38 calls it without a version, and that path did not change
- I did not review the code that `remove_user` of other modules runs inside the withdrawal transaction; it belongs to those modules
- The round 5 review file has no `## findings` rows and no `open` rows in `## previous`, so `## previous` is `none`
