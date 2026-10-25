# review notice round 1

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

- The commit range `2ef5ae8..4bc36b7` changes no file of the server `notice` module (`server/core/notice/index.ts`, `server/core/notice/select.ts`, `server/core/notice/tests/`) and no `core-spec/notice.json`; `git log 2ef5ae8..4bc36b7 -- server/core/notice` is empty. Input `## spec changes` is `none`. The review therefore checked only how the changed code reaches `notice`
- Checked how the changes reach `notice`:
  - `storage`: the range adds the public code (`server/core/storage/public_code.ts`, `server/core/storage/rows.ts:57`, `:93`), core schema version 2 (`server/core/storage/schema.ts:218`) and the start fill `fill_public_codes` that runs after the module tables in `apply_schema` (`server/core/storage/schema.ts:351`), and changes `create_user` to return `NewUser`. `notice` calls only `register_table`, `db`, `read_db`, `lock_game_row` and `after_commit` (`server/core/notice/index.ts:22`); none of these changed, and `apply_table`, which creates `notice_notice` and `notice_sequence`, is unchanged. The fill writes only the `"user"` table. `notice` never calls `create_user` or `get_user_record`
  - `routing`: the ban step now fills `BanDetail.public_code` (`server/core/routing/pipeline.ts:588`). That step runs only for authenticated targets (`check_ban_and_version(exchange, target, user_id)`), and `GetNotices` is a `NoUserRpc`. `MODULE_CORE_RPCS` still maps `notice` to `GetNotices` (`server/core/routing/spec_tables.ts:131`). `REQUEST_PREPARE` and `MODULE_ADMIN_OPERATIONS` get only `public-profile` and `auth` entries. The new admin operation name `find_user_by_public_code` does not clash with `put_notice`, `delete_notice` or `list_notices`
  - Contract: `proto/ogw/core.proto` and `server/generated/contract/core_contract.ts` add `FindUserByPublicCode` with its two messages and `public_code` fields; `Notice`, `NoticeKind`, `GetNoticesRequest` and `GetNoticesResponse` are unchanged (no `notice` line in the diff of `server/generated/contract/core_contract.ts`)
  - `admin-api`, `validation`, `server-time`, `logging`: only test files changed (`server/core/admin-api/tests/auth.test.ts`, `server/core/validation/tests/server.ts`, `server/core/logging/tests/helpers.ts`), each one an update to the new `auth` operation or the `create_user` return shape. None is imported by `server/core/notice/tests/`
  - Test support: `server/core/notice/tests/` imports `server/core/testing/dev/index.ts`, `server/core/storage/tx.ts`, `server/core/validation/tests/standalone.ts` and generated files. In `testing/dev`, only `setting_types.ts` changed, where it adds `SoundCore.*`, `public-profile.findPerMinute` and `uiQuality` types. `storage/tx.ts` and `validation/tests/standalone.ts` are unchanged
- The `notice` core tests were not run in this review: the checkout has no `node_modules` (`server/package.json` has no dependencies installed, and `ogw core test` is what prepares and runs them). The conclusion above comes from reading the code
- `notice` code outside the range was read only to find its calls into the changed modules. It was not checked for problems that existed before the range
- The storage changes themselves (the start fill, the schema version 2 migration on an existing PostgreSQL DB, public code collisions) were not checked: they belong to the `storage` review
