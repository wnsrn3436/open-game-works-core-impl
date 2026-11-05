# review auth round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | settings/core-settings.schema.json:186 | Debt D2 remains. The auth spec sets `auth.socialVerifyTimeoutMs` to "1 or more" (open-game-works-core/skills/server-core/modules/auth.md:376), but the schema still has `minimum` 0, and `read_settings` only checks that it is an integer (server/core/auth/settings.ts:58-61, :121). `timed` passes the value to `network_time_limit` (server/core/auth/social.ts:41), which throws `RangeError` when ms is below 1 (server/core/server-time/network_time_limit.ts:9). Run path: game settings `auth.socialVerifyTimeoutMs: 0` → the server starts → a social `Login`/`LinkAccount` or a `google` `POST /account/deletion` calls `verify_credential` → `timed` throws before `call` runs, so the request does not end with `SOCIAL_LOGIN_INVALID` or `EXTERNAL_SERVICE_FAILED` as the spec says | Set the schema `minimum` of `auth.socialVerifyTimeoutMs` to 1 so the server rejects 0 at startup, the same way the other period keys were raised. Cover it with server/core/routing/tests/settings-minimum.test.ts | no | 95 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D2 | open | R1-1 | settings/core-settings.schema.json:184-187 still has `"minimum": 0`. server/core/auth/settings.ts:121 does not check the minimum, and server/core/auth/social.ts:41 still calls `network_time_limit` with the value, which throws below 1 (server/core/server-time/network_time_limit.ts:9). The spec side is settled: auth.md:376 says "1 or more" |

## must fix

none

## unknown

- The commit range ab75c82..ab75c82 is empty, so the only code checked was the code at the D2 position and its call path: social.ts `timed`, auth settings.ts `read_settings`, the schema entry, and server-time `network_time_limit`. The other auth code is outside this round's scope and was not reviewed.
- I did not run tests. I confirmed R1-1 by reading the code path, not by running a request with the value 0.
