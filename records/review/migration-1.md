# review migration round 1

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

- In the commit range, no file of `server/core/migration/` other than tests changed. The changes are `server/core/migration/tests/helpers.ts:253` (`new_user` takes `user_id` of the `NewUser` that `storage.create_user` now returns) and `old_users` in `server/core/migration/tests/batch.test.ts:59` and `server/core/migration/tests/processes.test.ts:34`, which now sort the made users by user ID before giving item IDs `101 + i` and `BROKEN`, because `storage` now picks user IDs with secure random. The tests that pick users by index (`users[n]`, converter hooks on item `102n`, gates on `101n`) all use that sorted order, so they keep checking the batch order of `### batch`. `ogw core test server migration --file` passed for `batch.test.ts` and `processes.test.ts`. `convert.test.ts`, `import.test.ts`, `snapshot.test.ts` and `admin.test.ts` were read only where they call `new_user` and were not run
- Random user IDs and the `cursor_user_id` of a batch: a user made during a `RUNNING` batch with a user ID below `cursor_user_id` is not visited by that batch. A user made by a server instance whose contract version is `target_version` or more has its items at that version, so this changes nothing. Whether a user made during a batch by a server instance of a lower contract version (a mixed rollout) must reach `target_version` before `DONE` is not set by `migration.md` or `storage.md`; the same holds already for existing users below the cursor that such a server writes again. Not written as a finding because the defining documents do not set it
- The `migration` source (`server/core/migration/index.ts`) does not call `create_user` or `get_user_record`, so the new `public_code` column and `UserRecord.public_code` do not reach it. The `storage` code changes of the range (`server/core/storage/public_code.ts`, `rows.ts`, `schema.ts`) were read only for their effect on `migration` and are not reviewed here
