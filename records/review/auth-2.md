# review auth round 2

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R2-1 | correctness | medium | server/core/auth/social.ts:41 | `auth.socialVerifyTimeoutMs` has schema `minimum` 0 (settings/core-settings.schema.json:186), and `timed` passes the value to `network_time_limit`, which throws `RangeError` below 1 (server/core/server-time/network_time_limit.ts:9). Run on SQLite in a temporary copy, with a test server started at value 0 and the fake `login-google` adapter: a Google `Login` and a Google `LinkAccount` each return code 8 (`INTERNAL`) with an `unhandled exception` log, and `POST /account/deletion` with method `google` returns 500 with an empty body and the log `route POST /account/deletion failed`. All three stack traces start at `RangeError: network_time_limit: ms 0 is below 1`. The spec sets only rejection, time limit exceeded and communication failure on these paths: `SOCIAL_LOGIN_INVALID` or `EXTERNAL_SERVICE_FAILED` for `Login` and `prepare_link_account` (open-game-works-core/skills/server-core/modules/auth.md:139, :257, :336), and a failure or 502 with `[auth_deletion_retry]` for the web deletion (auth.md:302, :362) | Write `1 or more` in `meaning` of `auth.socialVerifyTimeoutMs` (auth.md:376, D7 of records/review-debt/spec-auth.json), as `push.sendTimeoutMs` has, and give the key schema `minimum` 1, so that server/core/routing/tests/settings-minimum.test.ts covers it at 1. The schema cannot change alone: without a written range, open-game-works-core/skills/core/SKILL.md sets 0 or more | yes | 97 |

## previous

none. Round 1 had no findings

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | `auth.guestSweepIntervalMs` now has schema `minimum` 1 (settings/core-settings.schema.json:153-156, changed from 0 by a4ab109), and the spec writes `1 or more` (open-game-works-core/skills/server-core/modules/auth.md:396). Value 0 no longer passes the schema. server/core/routing/tests/settings-minimum.test.ts starts a server with this key at 1 and `auth.inactiveGuestDeleteAfterMs` at its minimum 0, so job `auth_guest_sweep` is registered. It passed with `ogw core test server routing --file` on SQLite and PostgreSQL |
| D2 | open | R2-1 | Same location and behavior as the item: schema `minimum` is still 0 and auth.md:376 still writes no range. The throw was reproduced by a run, see R2-1. Severity stays `medium`, because it happens only with value 0, which the default 10000 (settings/core-settings.json:81) does not use |

## must fix

none

## unknown

- Scope of this round: the commit range is empty and `## spec changes` is `none`, so only the positions of D1 and D2 and the code they reach were read: social.ts, the `timed` call sites, `begin_start` of auth, `network_time_limit`, `schedule_job`, and the two schema keys. The rest of the auth module was not reviewed in this round
- Tests run: server/core/routing/tests/settings-minimum.test.ts on SQLite and PostgreSQL. No auth test file of the checkout was run
- The R2-1 reproduction ran on SQLite only, with vitest run directly on a temporary copy of the checkout, not through `ogw core test`. Its temporary test was not added to the target. The failure happens before any DB access, in `timed`
- The other two `timed` paths at value 0 were not run: the Google desktop credential `exchange_desktop` and the Apple `verify`, `exchange` and `revoke` calls. For `revoke`, by reading only: `revoke_apple` runs in `storage.after_commit` (server/core/auth/withdraw.ts:25), and open-game-works-core/skills/server-core/modules/storage.md:151 discards an exception of that function, so the `error` log that auth.md:337 sets would be missing. How the implementation handles a rejected promise of that function was not read
- Whether the code alone could give value 0 a defined result (e.g. `timed` returning `timeout` without calling `network_time_limit`) was not tried. `spec change` of R2-1 is `yes` because that result would make every social login fail while the schema still allows the value, and the review list already has the spec side as D7
- The previous review path of the input points to another workspace folder than this one. That file is byte-identical to records/review/auth-1.md of this checkout
