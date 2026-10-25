# review admin-api round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | server/core/admin-api/tests/auth.test.ts:26 now has `['find_user_by_public_code', 'read']` in `COLLECTED['auth']`, which matches the admin-api spec collected operation table row `auth` \| `find_user_by_public_code` \| `read`. The test `lets each role call the admin operations of auth, ...` (server/core/admin-api/tests/auth.test.ts:391) runs `check_collected` on it: when the operation is not registered, the `'registered'` expect fails (:368); when it is registered under another role (e.g. `ops`, server/core/auth/admin.ts:80), the `read` operator's valid request (`public_code: 'x'` from `sample`) gets 403, so the `allowed.status === 401 \|\| 403` expect fails (:374); `check_refusals` checks 401 for a wrong secret and 403 for `ops` (:357-:358). The handler (server/core/auth/admin.ts:45) answers `bad_request` to `x`, which counts as processing that ran (`spy.calls > 0`). The other entries of `COLLECTED` equal the spec table row by row |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The admin-api tests were not run here. The role-mismatch failure of R1-1 was checked by reading the test path; the core agent report says that a temporary registration with role `ops` made the test fail on sqlite and postgresql
- Outside records, the range changes only server/core/admin-api/tests/auth.test.ts (one line) and server/core/public-profile/tests/profiles.test.ts. The latter belongs to the `public-profile` review, and admin-api does not reach it. No admin-api code changed in the range
