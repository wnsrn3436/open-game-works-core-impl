# review auth round 1

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

- The tests were read, not run: `server/node_modules` is not installed in this checkout, and `ogw core test` was not called because the review agent does not edit or install anything. Whether `server/core/auth/tests/public-code.test.ts`, `deletion.test.ts`, `deletion-form.test.ts`, `login.test.ts`, `ban.test.ts`, `social.test.ts` and `withdraw.test.ts` pass on this commit was not checked
- `storage` (`create_user`, `find_user_by_public_code`, `is_public_code_input`, the start fill of null `public_code`), `public-profile` (`FindUserByPublicCode`, `count_find_attempt`) and `routing` (step 6 `BanDetail.public_code`) were read only at the points that auth calls or that collect auth exports; they are other review targets and their own behavior was not reviewed
- Client `AuthCore` and `BootstrapCore` changes in the range are not part of server module `auth` and were not reviewed
- The `google` method of `POST /account/deletion` reads `auth_social_link` with `read_db` without handling a failure of that read (`server/core/auth/deletion.ts:256`); this predates the range, and the defining documents do not set that failure (recorded as D1 of `records/review-debt/spec-auth.json`), so it is not judged here
- The PostgreSQL path of the new public code lookups was not run; only the code was read
