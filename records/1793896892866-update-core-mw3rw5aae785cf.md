# update core: coupon

## done

- coupon: removed `'M\u0000'` from the `after_code` list of the test "list_coupon_codes compares an after_code with lowercase letters and other characters in byte order" (`server/core/coupon/tests/admin.test.ts:213`). The admin-api spec (`### body rules`) now refuses a string holding U+0000 with 400 `bad_request`, and the coupon spec `after_code` does not ask for U+0000. No coupon code changed
- `ogw core test server coupon`: pass on SQLite and PostgreSQL
- `ogw code check core`: type check, lint, dependency, secret pass
- No engine-specific implementation rules document written; `## <engine> build` of `tools/ogw.md` not written

## spec proposals

none

## review

none

## unverified

- The last `ogw core test` ran only `server coupon`, the range the input set. The dependents that `ogw core dependents coupon` lists (`routing`, `testing`) were not run; only a coupon test file changed
