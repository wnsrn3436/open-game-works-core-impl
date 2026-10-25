# review matchmaker round 1

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

- The commit range d4e2728..c6a1194 changes no file under `server/core/matchmaker/`. The server code it changes is `server/core/auth/login.ts`, `server/core/auth/deletion.ts`, `server/core/auth/dev/index.ts` (the `FAILED`/`WITHDRAWN` handling and error logs of `create_user`, `claim_key`, login, `RefreshToken`, DevLogin and the web deletion page) and the added keys `QACore.captureJpgQuality` and `UnitTestCore.startTimeLimitMs` in `server/core/testing/dev/setting_types.ts`, `settings/core-settings.json` and `settings/core-settings.schema.json`. The matchmaker reaches `auth` only through `auth.verify_access_token` (`server/core/matchmaker/deps.ts:17`, `server/core/matchmaker/index.ts:113`, `server/core/matchmaker/realtime.ts:360`), which the range does not change, and it reads no changed settings key. So the range reaches no matchmaker code path, and the matchmaker code outside the range was not reviewed, because a problem that existed before the range and is unrelated to the changes is not a finding of this round
- Input `## spec changes` is `none`, so no spec diff was checked against the matchmaker code
- The matchmaker tests (`server/core/matchmaker/tests/`) were not run: this checkout has no installed test runner (no `node_modules`). Matchmaker tests that log in through the changed auth code (guest login with `create_user` and `claim_key`) were checked only by reading: the `COMMITTED` paths of `create_user`, `claim_key` and `complete_login` return the same values as before the range
