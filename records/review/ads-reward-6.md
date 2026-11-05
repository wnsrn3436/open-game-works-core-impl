# review: ads-reward round 6

## findings

none

## previous

none (the round 5 review file has no `## findings` row and no `open` row)

## out of scope

none

## debt

none

## must fix

none

## unknown

- The only `server/core/ads-reward/` change of the range is the test `answers HTTP 500 with an error log and no grant when the user transaction of the callback fails on the DB, and grants the same callback again` (`server/core/ads-reward/tests/callback.test.ts:333`). Its fake `on_ad_rewarded` now ends the user transaction through `fail_transaction` (`server/core/storage/tests/helpers.ts:334`) as a failed statement of that transaction does, so the run still goes through the `FAILED` branch of `process` (`server/core/ads-reward/callback.ts:145`), which the test asserts by the log `the user transaction failed`, then HTTP 200 and the grant on the resend (`## error` row `DB failure in callback handling` and `### callback` of the ads-reward spec). No defect was restored for it, since no finding names it
- The `storage` changes of the range were read only for their effect on ads-reward. `body` of `server/core/storage/tx.ts:196` now throws, instead of `FAILED`, a lock or connection failure that did not break the transaction (e.g. a `read_db` statement in the transaction function). ads-reward runs no `read_db` statement inside a transaction function: `ticket_state` (`server/core/ads-reward/index.ts:131`) and `read_ip_count` (`server/core/ads-reward/callback.ts:204`) run outside one, and every statement in the transactions of `process`, `counted`, `wait_ad_reward`, `BeginAdReward`, `ClaimAdReward` and `FakeAdCallback` goes through `storage.db(ctx)` or `storage.db(tx)`. A content hook that does so ends in the `catch` of `process` (`callback.ts:141`), which is also HTTP 500 with an error log, as the spec requires. `check_text_param` (`server/core/storage/db/types.ts:99`) refuses unpaired surrogates: the string parameters of ads-reward are reward notify IDs checked against `NOTIFY_ID` before any statement, the once key `ad:<notify ID>`, and the client IP of `routing` (`server/core/routing/http.ts:129`, from Node header and socket values). The `scan_users` change and core schema version 3 do not reach ads-reward. The correctness of these changes as `storage` behavior was not reviewed
- The `mailbox` change of the range (`server/core/mailbox/mail_input.ts:145`, a `once_key` holding U+0000 is `INVALID_INPUT`) does not change the ads-reward grant: its once key is `ad:` plus a `NOTIFY_ID` value (`server/core/ads-reward/grant.ts:97`). Other changes of the range (admin-api, block-report, live-event, matchmaker, mission, nickname, public-profile, push, routing, client cores) were not reviewed
- `ogw core test server ads-reward` was run on the main checkout at the range end `d7f5d28d` and passed. Whether that run included PostgreSQL was not checked
