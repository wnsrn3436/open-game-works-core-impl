# review auth round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | settings/core-settings.schema.json:184-187 now has `"minimum": 1` for `auth.socialVerifyTimeoutMs`, which matches the auth spec "1 or more" (open-game-works-core/skills/server-core/modules/auth.md:376). Overridden values are checked against `core-settings.schema.json` (open-game-works-core/skills/core/SKILL.md:120), so a value of 0 is now rejected there and cannot reach `network_time_limit` (server/core/server-time/network_time_limit.ts:9) through `timed` (server/core/auth/social.ts:41). The new test `gives auth.socialVerifyTimeoutMs the minimum 1 in core-settings.schema.json` (server/core/auth/tests/social.test.ts:80-82) checks that schema value, so it fails if the minimum goes back to 0. The time limit test (server/core/auth/tests/social.test.ts:58-78) now also starts a server at the minimum 1 and expects `EXTERNAL_SERVICE_FAILED` there, and server/core/routing/tests/settings-minimum.test.ts starts a server with this key at its schema minimum, which is now 1 |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D2 | fixed | none | The schema minimum is 1 (settings/core-settings.schema.json:186), so the value 0 that made `timed` throw through `network_time_limit` is no longer an allowed value. The test at server/core/auth/tests/social.test.ts:80-82 covers the schema value, and the time limit test covers the call at 1 |

## must fix

none

## unknown

- In the commit range, the only auth changes are settings/core-settings.schema.json:186 and server/core/auth/tests/social.test.ts. The gacha changes (server/core/gacha/) and the other review records in the range are not part of auth and were not reviewed.
- I did not run tests: this worktree has no `server/node_modules`. Both points are confirmed by reading the code only: that the time limit test passes at limit 1, and that the schema test fails when the minimum is set back to 0. The core agent report says `ogw core test server auth matchmaker rating routing testing` passed.
- As in round 1, the server does not check the schema minimum itself when it reads settings (server/core/auth/settings.ts:121 checks only that the value is an integer). The value range is checked where overridden values are checked against the schema, as open-game-works-core/skills/core/SKILL.md:120 says. This is the same as for the other core settings keys.
