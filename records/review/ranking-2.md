# review: ranking round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | server/core/ranking/reward.ts:311-312 now runs `if (is_stopped(core)) return;` before `finish_pass`, the same check `close_pass` has at reward.ts:274-275. So once `stop()` has started, the end of reward retry does neither the `Closed` nor the `Retrying` transition (open-game-works-core/skills/server-core/modules/ranking.md:174). Test: server/core/ranking/tests/reward.test.ts:388, which has two cases (a retry row not due yet, and no retry row left after `remove_user`). Restore check: I copied `server/`, `fixtures/`, `settings/`, `proto/`, `test-data/` and `core-spec/` to a scratch folder outside the checkout and deleted line reward.ts:312 there. I ran vitest with `OGW_DEFAULT_DB=sqlite` on `core/ranking` and `-t "Retrying season with"`. Both cases failed at reward.test.ts:414: in the not-due case, `lease_until_at` was `0n` (expected `NEXT_DAY + 60_000 + LEASE_MS`), and in the no-row case, `status` was `Closed` (expected `Retrying`). With the fix put back, all 69 ranking tests pass on SQLite |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | This is the same problem as R1-1, fixed at server/core/ranking/reward.ts:311-312. The run path in D1 (a `Retrying` season whose retry row is not due, `stop()` beginning inside the `take_lease` transaction) is now case 1 of server/core/ranking/tests/reward.test.ts:388. It fails when the fix is removed, as recorded in `## previous` R1-1 |

## must fix

none

## unknown

- The restore check and the full ranking suite were run only with `OGW_DEFAULT_DB=sqlite`. I did not run them on PostgreSQL. The core agent report says both cases fail without the fix and pass with it on SQLite and on PostgreSQL. The vitest run used the `server/build/data` of the main checkout `open-game-works-core-impl/`, because the target checkout has no built data
- I did not run the server modules that depend on ranking. `ogw review run` runs them after each fix
- In `reward_retry`, when the board is missing from data, `close_season` runs with no stop check (server/core/ranking/reward.ts:282-286). `close_pass` does the same for a missing board or for `reward_mail` 0 (reward.ts:256-260). This code is outside the commit range and the change did not touch it. ranking.md:174 does not say whether the stop rule also covers these closes, so I did not judge them. The core agent report lists this as a spec proposal
