## done

- server module `auth`: in step 4 of `POST /account/deletion`, the `google` method now reads the `auth_social_link` row with `storage.read_db` inside a guard. A failure of that read (of `read_db` or of its query) gives 500 and `[auth_deletion_retry]` with one `error` log, and no user transaction is opened (`server/core/auth/deletion.ts:256-261`). The `error` log message names which lookup failed: the public code or the `auth_social_link` row (`server/core/auth/deletion.ts:302-303`)
- core test (`## test` item "When the `storage.read_db` lookup of the public code or of the `auth_social_link` row of `POST /account/deletion` fails ..."): `server/core/auth/tests/public-code.test.ts:76`. Only the `auth_social_link` query on the read handle fails. The test checks the 500, exactly one new `error` log, a page identical to another `[auth_deletion_retry]` page (the 503 during maintenance), and that nothing was deleted: the session still works and the same credential then deletes the account. Without the fix the test fails on SQLite and PostgreSQL (500 with an empty body)
- `ogw core test server auth matchmaker rating routing testing`: all pass on SQLite and PostgreSQL. `ogw code check core`: type check, lint, dependency, secret pass

## spec proposals

none

## review

none

## unverified

none
