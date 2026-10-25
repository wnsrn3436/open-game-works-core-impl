# review admin-api round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | server/core/admin-api/tests/auth.test.ts:26 | The range adds the collected admin operation `auth` `find_user_by_public_code` (role `read`) in server/core/auth/admin.ts:45 and :78, and the admin-api spec collected operation table has the row `auth` \| `find_user_by_public_code` \| `read`. admin-api `## test` requires that for each operation of the collected admin operation table a holder of its role reaches the module's handling, a wrong secret is 401 and an operator without the role is 403. `COLLECTED['auth']` lists only `withdraw_user` and `find_user_by_social_account`, so `check_collected` never sends `find_user_by_public_code`: registering it under another role (e.g. `ops`), or not registering it, passes every admin-api test | Add `['find_user_by_public_code', 'read']` to `COLLECTED['auth']`. Its `sample` input `public_code: 'x'` reaches the handler (which answers `bad_request`), which the existing check accepts as processing that ran | no | 95 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The admin-api tests were not run: this checkout has no installed dependencies (`node_modules`). Whether they pass with random user IDs below 2^53 was checked only by reading: they get users through `core/Login` and do not depend on the order users were made. `MISSING_USER` (`999999999`, server/core/admin-api/tests/helpers.ts:241) can be a real user ID with a chance of about 2^-53 per user made, which is not a finding
- admin-api code (server/core/admin-api/) is unchanged in the range. Of the range's storage changes, admin-api uses only `get_user_record` (server/core/admin-api/operations.ts:123, :135, :141, server/core/admin-api/index.ts:370), which reads only `created_at` and `withdrawn_at`. The added `public_code` field does not change any admin-api output, and the admin-api spec does not set `public_code` in `get_user` or `export_personal_data`
- The storage public code start fill, `create_user` retry and `find_user_by_public_code` were read only where admin-api reaches them. They belong to the `storage` review
