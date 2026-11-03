## findings

none

## previous

none

## out of scope

- settings/core-settings.schema.json:155: medium `auth.guestSweepIntervalMs` has schema minimum 0, but `server-time.schedule_job` rejects a period below 1 (server/core/server-time/scheduler.ts:164, skills/server-core/modules/server-time.md:90). Input: `auth.guestSweepIntervalMs` 0 with a non-null `auth.inactiveGuestDeleteAfterMs` passes the schema, server/core/auth/index.ts:150 registers job `auth_guest_sweep` with period 0, and the server does not start. The range gave `routing.storageSweepIntervalMs` minimum 1 for this same problem and did not change this key. Read from the code, not run

## debt

none

## must fix

none

## unknown

- The range 9b1e14b5..07923ffe changes no file under `server/core/auth/`, and input `## spec changes` is `none`. The auth code as a whole was not reviewed, only what the range reaches
- Checked for the range: `server/core/Dockerfile` removes `core/*/dev` and `core/*/tests` on STG and PROD, and no non-DEV, non-test file under `server/core/` has a static import of a `dev/` or `tests/` path. The `core-spec/` changes removed `supportedLanguages` from `validation.json` only; `core-spec/auth.json` still declares it with `sourceLanguage`, `routing.maxBodyBytes`, `routing.bodyReadTimeoutMs`, `routing.externalMaxResponseBytes`. The matchmaker and coupon changes add no call to auth. Their `node:crypto` mock of `randomInt` lives in their own test files, and auth's only `randomInt` call is server/core/auth/account.ts:79, which those tests do not reach with a script (read from the tests, not traced at run time)
- `ogw core test server auth` passed at 07923ffe, as reported by the tool, without a view of whether that was a new run or a kept result of the same key
- Not run: auth in a built server image. No image test logs in, calls `GET /account/deletion` or reads a page translation from `build/data/` in a container. The test only checks that `build/data/client_data_version` is in the STG image, so web account deletion in an image was not checked
- Dynamic imports and DEV code loading through `use_dev` (server/core/auth/index.ts:79) on an image without `core/auth/dev` were read as far as the static import search and the image test of `routing`, which starts the STG image only as far as the DEV code refusal and then a start failure without secrets or PostgreSQL. A full STG start of auth with its secrets was not run
- `records/review-debt/spec-auth.json` items D2 to D6 are spec review items and were not input `## debt` items, so they get no result here. D6 is the same problem as the `## out of scope` line above
