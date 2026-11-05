# review: ads-reward round 5

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R4-1 | fixed | `server/core/ads-reward/index.ts:108` `is_notify_id` tests the value against `NOTIFY_ID` of `server/core/ads-reward/adapter.ts:81` (lower-case UUID v4, anchored with `^`/`$`, no `m` flag), the only form `BeginAdReward` issues (`randomUUID`, `index.ts:97`). `claim_ad_reward` (`index.ts:113`) and `fake_callback` (`index.ts:155`) return `AD_REWARD_NOT_FOUND` and `wait_ad_reward` (`index.ts:139`) returns before `run_user_transaction` for any other value, so a `notify_id` holding U+0000 no longer reaches `read_ticket` / `claim_ticket` (`tickets.ts:84`, `tickets.ts:113`). A ticket can only exist under a `NOTIFY_ID` value, so the early answer equals the spec answer for "no ticket" (`open-game-works-core/skills/server-core/modules/ads-reward.md:101`, `## error` unusable ticket and the `FakeAdCallback` row). Run on a temporary git worktree of HEAD (vitest, SQLite): the whole `server/core/ads-reward/tests` folder passed (82 tests). With the three `is_notify_id` lines removed in that copy, `claim.test.ts:103` and `fake-callback.test.ts:41` both failed with `expected 8 to be 32` (`INTERNAL` instead of `AD_REWARD_NOT_FOUND`) |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The `server/core/ads-reward/` changes of the range are only the `is_notify_id` check and its two tests; the review read them against `index.ts`, `tickets.ts` and the ads-reward spec. The `item-ledger` changes of the range (`items.ts` `read_encoded`, `ledger.ts` zero-amount handling of the timed cap, balance limit and `Convert`) were read only for their effect on the ads-reward grant through `mailbox.grant_or_mail`: the grant amounts and the `ClaimAdReward` output encoding are not changed in a way that differs from the ads-reward spec. Their correctness as `item-ledger` behavior was not reviewed. Changes of the range to `nickname`, `mailbox` tests and the generated data files were not reviewed
- Only SQLite was run (the default DB of the run, with the server build data of `open-game-works-core-impl/server/build/data`). No PostgreSQL run was made; the new check runs before any statement, so the DB does not take part in that path
