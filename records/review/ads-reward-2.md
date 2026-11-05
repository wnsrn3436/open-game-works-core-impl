# review: ads-reward round 2

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R2-1 | spec | medium | server/core/ads-reward/callback.ts:177 | The changed spec (`open-game-works-core/skills/server-core/modules/ads-reward.md:80`-`82`) runs the ad unit check (1) before the value format check (2) on a callback whose signature matched. `check_signed` was not changed in the range and still runs the reward notify ID check (`callback.ts:177`) and the user ID check (`callback.ts:182`) before the ad unit check (`callback.ts:187`). Run path: test server with `ads-admob`, `set_key_source` key, `environments.<ENV>.adUnits` `ca-app-pub-1/222`; a signed callback with `ad_unit=333`, `custom_data=x`, `user_id=x` fails `NOTIFY_ID.test` at line 177, writes a `kind` `core` `warn` line and returns null, so no `ad_callback_ad_unit` `security` line is written. The spec test (`ads-reward.md:249`, second sentence) requires that `security` line and no `kind` `core` line. No test sends such a callback (`server/core/ads-reward/tests/callback.test.ts:449` only sends valid `custom_data` and `user_id`) | Move the `ads-admob` ad unit check to the top of `check_signed`, and add the `ads-reward.md:249` second-sentence test (fresh server, first callback `ad_unit=333`, `custom_data=x`, `user_id=x` → HTTP 200, one `ad_callback_ad_unit` line with `user_id` null, no `kind` `core` line) | no | 95 |
| R2-2 | spec | medium | server/core/ads-reward/callback.ts:188 | The changed spec (`open-game-works-core/skills/server-core/modules/ads-reward.md:93`) says every `security` log of the callback has `user_id` `null` and is grouped by the truncated IP. `check_signed` writes the `ad_callback_ad_unit` line with `user_id` = the user ID parsed from the callback query (`security_log(core, ip, 'ad_callback_ad_unit', user_id)`). `logging` takes the group key from `entry.user_id` (`server/core/logging/log_line.ts:135`: `user:<id>` when not null), so the line is grouped by user ID instead of IP. Run path: two signed `ads-admob` callbacks from one IP within `logging.securityRepeatWindowMs`, both `ad_unit=333` with valid `custom_data`, with `user_id=1` and `user_id=2`: the code writes two `ad_callback_ad_unit` lines with `user_id` 1 and 2; the spec writes one line with `user_id` null and counts the second one in the IP window. The test at `server/core/ads-reward/tests/callback.test.ts:449` does not check `user_id` of the line (the `ads-reward.md:249` first sentence requires `user_id` `null`) | Pass `null` as `user_id` in the `ad_callback_ad_unit` `security_log` call, and assert `user_id` `null` on that line in `callback.test.ts:449` | no | 95 |
| R2-3 | spec | medium | server/core/ads-reward/tests/grant.test.ts:83 | The changed spec test (`open-game-works-core/skills/server-core/modules/ads-reward.md:250`) requires that the first of the 403 queries (signed with another key) leaves a `security` log `reason` `ad_callback_signature` with `user_id` `null`. The test `grants the query of sign_callback, and answers HTTP 403 to another key and to a key ID not in the key list` checks only the statuses and the balance; no ads-reward test checks `user_id` of an `ad_callback_signature` line (`grant.test.ts:78` checks only its count and that the query is not kept). The code writes `null` (`callback.ts:219`), but changing that argument to the parsed user ID fails no test | Assert in that test that the first 403 query leaves an `ad_callback_signature` `security` line with `user_id` `null` | no | 90 |

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | The problem of R1-1 was that the spec set no order between the two checks. The spec now names the order (`open-game-works-core/skills/server-core/modules/ads-reward.md:80`-`82`: ad unit check, then value format check) and the error table names the precedence (`ads-reward.md:162` "whose ad unit check passed"). The code that does not follow the new order is R2-1 |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | D1 asked the spec to name the order of the two checks. `open-game-works-core/skills/server-core/modules/ads-reward.md:80`-`82` now runs the ad unit check first and the value format check second, and `ads-reward.md:249` sets a test for a callback that fails both. The code still differs from that order; that is R2-1 |

## must fix

none

## unknown

- No code of `server/core/ads-reward/` changed in the commit range `72e3a2d..c1f7455`; only the code that the spec changes of the diff reach was read: `callback.ts` (`check_signed`, `handle_callback`, `process`, the log helpers), `grant.ts` (grant order against the changed `storage` throw and abort rules and the changed `item-ledger` and `mailbox` rules), `deps.ts`, and the `security` grouping and `ip` truncation of `server/core/logging/index.ts` and `log_line.ts`. `tickets.ts`, `adapter.ts`, `adapters/admob.ts`, `dev/` and `index.ts` were not reviewed beyond the calls above
- The changed `storage` rules (a throw of the change function of `run_user_transaction` rolls back and throws; PostgreSQL abort handling in `run_savepoint`) are met by `process` catching the throw as HTTP 500 (`callback.ts:158`) and by `grant_in_savepoint` not catching DB throws; the PostgreSQL abort paths themselves are storage behavior and were not run
- No tests were run. R2-1 and R2-2 follow from the order of the code in `check_signed` and from `log_line.ts:135`; R2-3 from reading every `ad_callback_signature` assert in `server/core/ads-reward/tests/`
