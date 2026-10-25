# review auth round 2

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

- The tests were read, not run: `server/node_modules` is not installed in this checkout, and the review agent does not install anything. Whether `server/core/auth/tests/public-code.test.ts` and `server/core/admin-api/tests/auth.test.ts` pass on this commit was not checked. That the new `google` lookup failure test fails on code without the `try`/`catch` of `server/core/auth/deletion.ts:256` was judged by reading: the thrown error then reaches `handle_route` of `server/core/routing/pipeline.ts:797`, which answers a plain 500 instead of the `[auth_deletion_retry]` result page, so the body comparison with the 503 maintenance page fails; this was not run
- The PostgreSQL path of the `read_db` read of `auth_social_link` was not run; only the code was read
- Client `AuthCore` (`client/godot/core/auth_core/tests/test_login.gd`) and `BootstrapCore`, `TweenCore` changes in the range are not part of server module `auth` and were not reviewed
- `storage` (`server/core/storage/schema.ts` start fill savepoint), `friend` and `public-profile` test changes in the range are other review targets; `storage` was read only to see that it does not change what `auth` calls, and its own behavior was not reviewed
