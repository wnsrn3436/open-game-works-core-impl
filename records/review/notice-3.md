# review notice round 3

## findings

none

## previous

none (round 2 `## findings` is `none`, and it has no `open` row in `## previous`)

## out of scope

none

## debt

none

## must fix

none

## unknown

- The commit range does not change server/core/notice/ (`git diff --name-only` of the range lists no file under it). The review covered the code that the changed definitions reach from notice:
  - admin-api: `string` fields now reject U+0000, also as array elements and object fields (server/core/admin-api/body.ts:60-62, 109-130), so `platforms`, `languages`, `texts` and the URL fields of `put_notice` cannot carry U+0000 to the DB. The JSON parser refuses duplicate member names (server/core/admin-api/json.ts:99-113), and `int64` fields are exact `bigint` values (body.ts:44-49)
  - audit `args`: notice operations have no audit args function and a JSON body, so `args` is the checked input (server/core/admin-api/index.ts:367-370), and its `bigint` fields go through `output_json`
  - storage advisory lock keys: notice passes the same TypeScript type at every `lock_game_row` of a table. `notice_sequence` always gets the number 0 (server/core/notice/index.ts:50, 372), and `notice_notice` always gets the `bigint` `int64` input (index.ts:406, 432)
  - storage abort and `read_db` failures: when `lock_game_row` is `FAILED`, the notice handlers return `internal` (index.ts:372, 406, 432), and admin-api logs that at `error` (admin-api/index.ts:395-397). A query throw goes out of the handler as an unhandled exception. The cache reload catches a `read_db` throw and logs it (notice/index.ts:306-320)
  - The notice spec change (notice.md:52) only rewords the admin operation line, and the code and the collection by `routing` do not differ from it
- Tests: server/core/notice tests (9 files, 49 tests) passed with the ogw-pinned vitest on SQLite only (`OGW_DEFAULT_DB=sqlite`, server data from open-game-works-core-impl/server/build/data). The PostgreSQL run was not done here
- The admin-api, storage and logging changes in the range belong to those modules' own reviews. Only their effect on notice was checked
