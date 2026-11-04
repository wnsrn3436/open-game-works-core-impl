# review notice round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | server/core/notice/index.ts:69-73 (`UPDATE_LIVE_NOTICE`, `DELETE_LIVE_NOTICE`) check `end_at > now` in the write statement and return the changed row; put_notice (index.ts:405-408) and delete_notice (index.ts:433) return `not_found` when no row changed and register no `after_commit`. On PostgreSQL READ COMMITTED, a sweep delete that commits first leaves the UPDATE/DELETE with no row (`not_found`); an UPDATE that commits first makes the sweep's re-checked outer `AND <expiry> <= $1` (server/core/storage/rows.ts:375) false for the new `end_at`. Checked: server/core/notice/tests/sweep.test.ts run against the round 1 notice index.ts (copy of HEAD with `git show fdef2b5:server/core/notice/index.ts` put in place, outside the checkout) fails both tests (`expected { notice_id: 7n } to be 'not_found'`, `expected {} to be 'not_found'`), and passes on HEAD |
| R1-2 | fixed | server/core/notice/tests/target.test.ts:84-94 sends `GetNotices` with a 35-byte `language` (succeeds with the `sourceLanguage` text) and 36-byte ASCII and 12 × `가` (36 bytes) values expecting `CORE_ERROR_INVALID_REQUEST` and no response body. Defect restored in a copy of HEAD outside the checkout by removing `max_len: 35` from `rules_CoreContract_GetNoticesRequest` in server/generated/contract/core_contract.ts:5920 (the generated form of the `max_len` of proto/ogw/core.proto:1183): that test fails at target.test.ts:91 (`expected undefined to be 1`) on SQLite, and the other 9 tests of the file pass; on HEAD all 10 pass |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | Same as R1-1: the replace is one `UPDATE ... WHERE notice_id = $1 AND end_at > $15 RETURNING notice_id` whose result is checked (server/core/notice/index.ts:406-408), and sweep.test.ts fails on the restored code |
| D2 | fixed | none | Same as R1-2: target.test.ts:84-94 fails when `max_len` of `GetNoticesRequest.language` is removed from the generated rules |

## must fix

none

## unknown

- Tests were run directly with the ogw-pinned vitest on SQLite only (`OGW_DEFAULT_DB=sqlite`, server data from open-game-works-core-impl/server/build/data); the PostgreSQL run was not done here. The core agent report states both DB runs passed through `ogw core test`
- The PostgreSQL interleaving of the UPDATE/DELETE with `sweep_expired` was not reproduced in a real concurrent run; it was checked from the SQL (row re-check under READ COMMITTED) and by the fake DB handle test
- The `max_len` defect was restored in generated code rather than by editing proto/ogw/core.proto and regenerating, because the base proto check of `ogw core test` stops when core.proto differs from the spec
- Other changes in the commit range are outside the `notice` target and were not reviewed
