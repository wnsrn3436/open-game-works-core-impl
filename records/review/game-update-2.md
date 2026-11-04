# review game-update round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | server/core/game-update/tests/publish.test.ts now holds the `lock_game_row(game_update_deploy_list, [0])` lock on a second connection (`lock_holder`, `pg_advisory_xact_lock(lock_key(...))`) that commits after 200 ms. Restored in a temporary copy (git archive of HEAD) and run on PostgreSQL: with the `lock_game_row` line of `publish` (server/core/game-update/admin.ts:149) deleted, "gives two concurrent publishes different sequences: ..." and "with a concurrent prune that gets its turn first and deletes a referenced file: the publish is conflict ..." fail; with the `lock_game_row` line of `prune` (admin.ts:168) deleted, "with a concurrent publish that gets its turn first: the prune waits for it ..." fails. On SQLite these pass with either line deleted, because a write transaction holds the whole database there |
| R1-2 | fixed | New tests at server/core/game-update/tests/start.test.ts:59 and :64 start with `db` `null` (`host_secrets`) and secrets under the names that `environments.<ENV>.secrets` gives. Restored in a temporary copy: with index.ts:101-103 replaced by `return server.read_secret(key)`, both tests fail on PostgreSQL ("reads updateSigningKey and cdn from the host secrets ..." and "does not start when the host secret ... is missing ..."). They are skipped on SQLite |
| R1-3 | fixed | New test at server/core/game-update/tests/start.test.ts:45 (`cdn-r2`, full `cdnR2`, no `cdn` secret). Restored in a temporary copy: with index.ts:119-120 replaced by `const secret = read_secret('cdn') ?? '';`, "does not start when adapters.cdn is cdn-r2 and the cdn secret cannot be read, with an error log" fails on SQLite and PostgreSQL |
| R1-4 | fixed | The test at server/core/game-update/tests/serving.test.ts:55 asserts `content-type` `application/json` on both deploy list routes. Restored in a temporary copy: with routes.ts:54 set to `'Content-Type': 'text/plain'`, "is max-age of the settings ms divided by 1000, immutable for files, and application/json for the deploy list and signature" fails on SQLite and PostgreSQL |
| R1-5 | fixed | New test at server/core/game-update/tests/data-update.test.ts:53 inserts a `game_update_deploy_list` row whose `deploy_list` is not JSON and asks a fresh server instance. Restored in a temporary copy: with the `try`/`catch` at index.ts:184-190 replaced by `const entry = cache.current();`, "is false with an error log when the deploy list read throws" fails on SQLite and PostgreSQL |
| R1-6 | fixed | server/core/game-update/store.ts:74 (`file_sizes`) and :128 (`uploaded_sha256s`) now run one `IN (...)` statement per `SHA256_CHUNK` (500) distinct values (`sha256_chunks`, store.ts:34). The statement count no longer grows per file, only per 500 files. tests/store.test.ts:38 counts 3 statements for 1001 values; with the per-value loops restored in a temporary copy it fails on SQLite and PostgreSQL |
| R1-7 | fixed | `prune` (admin.ts:167-175) now deletes through `store.delete_files` (store.ts:94), one `DELETE ... IN (...) RETURNING sha256` per 500 values, counted by returned rows. tests/store.test.ts:50 counts 2 statements for 502 values; with the per-value `DELETE` restored in a temporary copy it fails on SQLite and PostgreSQL. `file_sha256s` still reads every stored `sha256` with one statement, which is one query whose result size follows the stored files, not one query per file |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | Same as R1-1: deleting either `lock_game_row` call in admin.ts makes a tests/publish.test.ts test fail on PostgreSQL (restore run in a temporary copy) |
| D2 | fixed | none | Same as R1-2: replacing index.ts:101-103 with `return server.read_secret(key)` makes start.test.ts:59 and :64 fail on PostgreSQL |
| D3 | fixed | none | Same as R1-3: removing the null check at index.ts:120 with the secret defaulting to `''` makes start.test.ts:45 fail |
| D4 | fixed | none | Same as R1-4: `text/plain` at routes.ts:54 makes serving.test.ts:55 fail |
| D5 | fixed | none | Same as R1-5: removing the `try`/`catch` of `is_data_update_ready` makes data-update.test.ts:53 fail |
| D6 | fixed | none | Same as R1-6: `file_sizes` and `uploaded_sha256s` run one statement per 500 distinct values |
| D7 | fixed | none | Same as R1-7: `prune` deletes with one statement per 500 values through `delete_files` |

## must fix

none

## unknown

- The tests were run outside `ogw core test` on a `git archive` copy of HEAD with vitest of ogw tools, `OGW_SERVER_DATA` of the main checkout of open-game-works-core-impl (at the same commit 9bbda86), `OGW_CORE_FIXTURES` of the copy and a throwaway `postgres:18.6` container of harness settings `tools.postgresql`. Unchanged copy: SQLite 80 passed and 2 skipped, PostgreSQL 82 passed. Only the game-update tests were run; the dependent modules (matchmaker, rating, routing, testing) were not run, and no file outside server/core/game-update imports `store.ts` or `admin.ts`, and the removed `delete_file` has no other caller
- The R1-1 tests show the missing lock only when this server's operation reaches the lock within the 200 ms before the holder commits. In the restore runs it did; on a slower host the holder can commit first, and then the test passes without showing the wait (it does not fail falsely). This was not measured further
- The R1-6 and R1-7 statement counts were checked; their time was not measured
- The rest of the commit range (modules other than game-update) is outside this target and was not read
