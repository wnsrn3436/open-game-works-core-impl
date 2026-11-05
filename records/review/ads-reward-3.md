# review: ads-reward round 3

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R2-1 | fixed | `check_signed` (`server/core/ads-reward/callback.ts:179`-`182`) now runs the `ads-admob` ad unit check before the reward notify ID check (`callback.ts:184`) and the user ID check (`callback.ts:189`), as `open-game-works-core/skills/server-core/modules/ads-reward.md:80`-`82` orders them. New test `server/core/ads-reward/tests/callback.test.ts:477` covers the second sentence of `ads-reward.md:249` (fresh server, first callback `ad_unit=333`, `custom_data=x`, `user_id=x` → HTTP 200, one `ad_callback_ad_unit` line with `user_id` null, no new `kind` `core` line). Restored in a temporary copy outside the checkout by moving the ad unit block back after the user ID check (still passing `null`): that test failed with `expected [] to have a length of 1 but got +0` (vitest, SQLite run); the same file passes at HEAD |
| R2-2 | fixed | `callback.ts:180` passes `null` as `user_id` to the `ad_callback_ad_unit` `security_log`, so `logging` groups the line by the truncated IP (`ads-reward.md:93`). `callback.test.ts:461` asserts `user_id` null on that line, and new test `callback.test.ts:493` sends two signed callbacks from one IP with `user_id` 1 and 2 and expects one line with `user_id` null. Restored in a temporary copy by passing `parse_user_id(parsed.user_id)` instead of `null`: `callback.test.ts:449` failed (`expected '3701139373741243' to be null`) and `callback.test.ts:493` failed (`expected [ '1', '2' ] to deeply equal [ null ]`) |
| R2-3 | fixed | `server/core/ads-reward/tests/grant.test.ts:83` now starts its own server and asserts that the first 403 query (signed with another key) leaves one `ad_callback_signature` line with `user_id` null (`grant.test.ts:91`-`92`), as `ads-reward.md:250` requires. Restored in a temporary copy by passing `parse_user_id(parsed.user_id)` in the `ad_callback_signature` `security_log` (`callback.ts:221`): that test failed with `expected '7460190807956226' to be null`; `grant.test.ts` passes at HEAD |

## out of scope

none

## debt

none

## must fix

none

## unknown

- Code changed in the range for `ads-reward` is only `check_signed` of `server/core/ads-reward/callback.ts` and the tests in `callback.test.ts` and `grant.test.ts`; those, `handle_callback`, the log helpers and the spec `### callback`, `## error` and `## test` items they reach were read. `grant.ts`, `tickets.ts`, `adapter.ts`, `adapters/admob.ts`, `dev/` and `index.ts` did not change in the range and were not reviewed again. Changes of the range to other modules (`coupon`, records) are outside this target
- The defect restorations ran `callback.test.ts` and `grant.test.ts` with vitest directly on temporary git worktrees of HEAD with the SQLite default DB only (`ogw core test` resolves the checkout to `open-game-works-core-impl/` for a folder outside `worktrees/_core/`, so it ran the unmodified code there). The PostgreSQL run of the restorations was not made. `ogw core test server ads-reward` on this checkout at HEAD passed (SQLite and PostgreSQL)
