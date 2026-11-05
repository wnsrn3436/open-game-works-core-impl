# review: ads-reward round 4

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R4-1 | correctness | medium | server/core/ads-reward/index.ts:131 | `ClaimAdRewardRequest.notify_id` is only `max_len` 36 (`open-game-works-core/skills/server-core/modules/ads-reward.md:43`), so a client can send a string that holds U+0000. `wait_ad_reward` passes it unchecked to `claim_ticket` (`index.ts:132`, `tickets.ts:113`) inside `run_user_transaction`, and `fake_callback` passes it to `read_ticket` (`index.ts:145`, `tickets.ts:84`); `claim_ad_reward` (`index.ts:105`) would do the same. The range added `open-game-works-core/skills/server-core/modules/storage.md:307` "A statement with a `string` parameter that holds U+0000 fails in both DBs" and implemented it for SQLite (`server/core/storage/db/sqlite.ts:49`, sqlite.ts throws `DbError('sql', '22021')`). `body` (`server/core/storage/tx.ts:196`-`207`) rethrows that value, so `wait_ad_reward` rejects and the request ends `INTERNAL` with an `error` log, where `open-game-works-core/skills/server-core/modules/ads-reward.md:101` and `## error` (`open-game-works-core/skills/server-core/modules/ads-reward.md:146`, `open-game-works-core/skills/server-core/modules/ads-reward.md:164`) require `AD_REWARD_NOT_FOUND` (no ticket can have that ID). Reproduced on a temporary worktree of HEAD (vitest, SQLite): `claim(session, 'a\u0000b')` through `drive` returned error 8 (`CORE_ERROR_INTERNAL`) while `claim(session, 'ab')` returned 32 (`AD_REWARD_NOT_FOUND`), and `FakeAdCallback` with `notify_id` `'a\u0000b'` returned 8. Before the range the SQLite run answered `AD_REWARD_NOT_FOUND`; PostgreSQL already rejected such a parameter | In `wait_ad_reward`, `claim_ad_reward` and `fake_callback`, treat a `notify_id` that is not a lower-case UUID v4 (`NOTIFY_ID` of `adapter.ts`, the form `BeginAdReward` issues) as no ticket without running a statement: `wait_ad_reward` returns at once, `ClaimAdReward` and `FakeAdCallback` answer `AD_REWARD_NOT_FOUND`. Add a test that sends U+0000 in `notify_id` to both | no | 90 |

## previous

none. `ads-reward-3.md` has no findings and no `open` rows

## out of scope

none

## debt

none

## must fix

none

## unknown

- No `server/core/ads-reward/` file changed in the range. The review read all of `index.ts`, `tickets.ts`, `grant.ts`, `callback.ts`, `deps.ts` and `dev/index.ts` against the definitions that `## spec changes` changed and that ads-reward reaches. These are: `storage` statement failure and abort rules (`tx.ts` `body`, `run_savepoint` broken check, `mark_broken`), the `read_db` statement failure throw (`handle_callback` IP counter read, `ticket_state`), the U+0000 rule, the `mailbox` `grant_or_mail` `MailArg` and input-type changes (ads-reward passes `[]`), the `item-ledger` `ItemChange` order, overflow and source rules (ads-reward only calls `grant_or_mail` with source `AdReward`), the `logging` changes (`log` level, analytics, `request` field) and the `routing` client IP normalization (`http.ts` `ip_text`). Apart from R4-1, ads-reward behaves as its spec says under them: a statement failure inside the grant savepoint now makes `run_savepoint` throw, and the callback answers HTTP 500 with an `error` log, as `open-game-works-core/skills/server-core/modules/ads-reward.md:79` and `open-game-works-core/skills/server-core/modules/ads-reward.md:160` require
- Changes of the range to other modules (`admin-api`, `auth`, `guild`, `ranking`, the storage PostgreSQL worker and others) were not reviewed, except where ads-reward calls them
- The reproduction and the run of the whole `server/core/ads-reward` test folder (80 tests passed) used vitest directly on a temporary git worktree of HEAD, with the SQLite default DB and the server build data of `open-game-works-core-impl/server/build/data`. No PostgreSQL run was made. On PostgreSQL R4-1 follows from `open-game-works-core/skills/server-core/modules/storage.md:307` and the same `body` path, but this review did not run it
