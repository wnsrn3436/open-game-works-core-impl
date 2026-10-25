# review guild round 1

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

- The guild tests were not run. The usage limit stopped the review before a vitest run could be set up (server/build/data, PostgreSQL databases), so nothing here passed by a run.
- In the range, guild source (server/core/guild/*.ts) is unchanged. Only these guild tests changed: tests/admin.test.ts, direct.test.ts, kit.ts, locks.test.ts, query.test.ts, withdraw.test.ts. These changes were read. They take the expected order from comparing bigint user IDs, which matches the ascending user ID tie-break of server/core/guild/tables.ts:360-376, and direct.test.ts reads `.user_id` of the new `create_user` result. No defect was found in these changes.
- User IDs are now random (server/core/storage/public_code.ts pick_user_id), but these tests were not checked for orders that still assume users get increasing IDs: tests/succession.test.ts, roles.test.ts, create.test.ts, join.test.ts, module.test.ts, and the rest of the other test files. These may be flaky. Not checked.
- These changed dependency paths were not traced through guild: `public-profile.get_public_profiles` now reads `get_user_record` per ID and fills `public_code` (server/core/public-profile/index.ts), which guild calls for `GetGuild` and `GetMyGuild` profiles. Also storage `create_user` and `get_user_record` (server/core/storage/rows.ts), which `import_guild` uses. Not checked against guild behavior.
