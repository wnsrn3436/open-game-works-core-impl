# review nickname round 4

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R4-1 | correctness | medium | server/core/nickname/index.ts:298 | The range adds the storage rule "A statement with a `string` parameter that holds U+0000 fails in both DBs" (storage.md `### DB`), and commit d469dc5 implements it on SQLite (server/core/storage/db/sqlite.ts:49 throws `DbError` 22021). `lookup` passes `validation.normalize_text(nickname)` as a `string` parameter of `LOOKUP`, and `normalizeText` (server/core/validation/text.ts:48) keeps U+0000 (it removes only `White_Space` and `Default_Ignorable_Code_Point`). `bad_lookup` (index.ts:292) checks only the empty string and the code point count, and nothing before it rejects U+0000: the `SearchUsersRequest.nickname` validator checks only `max_chars` and UTF-8 (U+0000 is valid UTF-8), and the admin JSON input accepts it. So a lookup input with U+0000, which can match no saved nickname because the character rules (`validation.is_plain_text`) reject C0 controls, throws instead of giving the empty list that `### find by nickname` and the `## API` rows set (failure value of `find_user_ids_by_nickname` is only the empty list for empty or over-long input; `find_user_by_nickname` is `bad_request` only for those). Reproduced on SQLite in a temporary copy of the checkout with a test that registers `Kiwi` for one user: `find_user_ids_by_nickname(ctx, 'Kiwi\u0000', 10)` threw `Error: a string parameter holds U+0000`, and admin `find_user_by_nickname` `{nickname: 'Kiwi\u0000'}` gave status 500 `{"error":"internal"}`, while `{nickname: 'Nobody'}` gave 200 `{"users":[]}`. Through `friend` `SearchUsers` (friend/index.ts:379) the same input ends the request with `INTERNAL`. No nickname test sends such input | In `find_user_ids_by_nickname` and `find_user_by_nickname`, give the no-match result (empty list, `users: []`) without running the query when the normalized input holds a character no saved nickname can hold (at least U+0000; e.g. when `validation.is_plain_text` is `false`), and add a lookup test with U+0000 for both operations | no | 90 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- server/core/nickname/ did not change in c25128c..a7c7f90. The review covered how the changed `storage`, `logging` and `item-ledger` code and the spec changes of the diff reach server/core/nickname/index.ts and its tests.
- Spec changes checked against nickname with no finding: the `lock_game_row` key text removed from storage.md (nickname passes the `string` normalized value at index.ts:202 at every call; `nickname_claim` has one key column); a statement failure other than an abort SQLSTATE counting as an abort (nickname's `UPSERT_NAME` uses `ON CONFLICT ... DO UPDATE`, and `DELETE_NAME` and `SELECT_OTHER` cannot violate a key); a later `lock_game_row` on an aborted transaction being `FAILED` (index.ts:267 and 325 turn `FAILED` into `INTERNAL` and `internal`, as the nickname error table says); `read_db` statement failures (nickname does not use `read_db`); `run_user_changes` (not used by nickname); the `item-ledger` `ItemChange` order and `revoke_items` changes (nickname calls only `subtract_items` with a `nickname_cost` list, and its tests do not assert the order of several `ItemChange`s); the `logging` `log` level change (nickname writes only one `core` `info` line with `logging.write`, index.ts:166). `SetNickname` and `rename_user` check the character rules before any query that takes the input, so U+0000 there is `NICKNAME_INVALID` / `bad_request` without a statement.
- Tests: the 34 nickname tests were run with the harness vitest on SQLite (`OGW_DEFAULT_DB` `sqlite`) in a temporary copy of the checkout; 30 passed and the 4 that need PostgreSQL could not start because no PostgreSQL was given (`OGW_POSTGRESQL` not set). The PostgreSQL run was not made in this round, and the U+0000 reproduction was made only on SQLite (PostgreSQL rejects U+0000 in text parameters with SQLSTATE 22021, which storage.md now sets for both DBs).
- The debt list of nickname has item D6 (test imports `lock_key` from `storage/tx.ts`); the input `## debt` is `none`, so it was not judged again and not written in `## out of scope`.
