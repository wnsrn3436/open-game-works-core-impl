# review nickname round 5

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R4-1 | fixed | server/core/nickname/index.ts:302 (commit a28ef8b): `lookup` returns `[]` without running `LOOKUP` when `validation.is_plain_text(normalized, Number.MAX_SAFE_INTEGER)` is `false`, so U+0000 never reaches a statement parameter; `find_user_ids_by_nickname` and admin `find_user_by_nickname` both go through `lookup`. No saved row can match such input: a saved nickname passes `is_plain_text` (character rules step 1, also in `rename_user`), and `normalize_text` (NFKC, lower case, removing `White_Space`/`Default_Ignorable_Code_Point`) adds no C0/C1 control, U+2028/2029 or `Bidi_Control`, keeps the text well-formed, and leaves no edge space, so the guard drops only input that matched nothing before. Restored the defect in a temporary copy of the checkout outside the target checkout by deleting the line `if (!validation.is_plain_text(normalized, Number.MAX_SAFE_INTEGER)) return [];` from server/core/nickname/index.ts and ran the nickname tests on SQLite: server/core/nickname/tests/lookup.test.ts:59 failed with `Error: a string parameter holds U+0000`, and server/core/nickname/tests/admin.test.ts:147 failed with `expected { status: 500, … } to deeply equal { status: 200, json: { users: [] } }`. With the fix in place, both pass |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The changes of the range in server/core/nickname/ are only commit a28ef8b (index.ts `lookup` and the two new tests). The other changes of the range that nickname reaches are in `item-ledger` (items.ts `read_encoded` used by `amount_of`, and ledger.ts `apply` for a delta of 0 or less). nickname calls only `subtract_items` with the `cost` of a `nickname_cost` row (index.ts:240), whose amounts are 1 or more, so the `d <= 0n` and `d > applied` changes do not reach it. `amount_of` now gives `INVALID_AMOUNT` for an `amount` over 2^53−1 with `big_amount` empty. That follows the `item-ledger` amount limit and only changes the result for a `nickname_cost` row outside that limit. No finding.
- Tests: the 36 nickname tests were run with the harness vitest (tools/node_modules/vitest) on SQLite (`OGW_DEFAULT_DB` `sqlite`) in a temporary copy of the checkout. 32 passed, and the 4 that need PostgreSQL could not start because no PostgreSQL is installed on this host (`OGW_POSTGRESQL` not set). The PostgreSQL runs and the defect restore on PostgreSQL were not made in this round. The core agent report says `ogw core test server` passed on both DBs.
- The `friend` `SearchUsers` path (friend/index.ts) calls `find_user_ids_by_nickname` and did not change in the range. It was not run in this round.
- The matchmaker PostgreSQL test failure named in the core agent report's `## unverified` is outside the nickname target and was not checked.
