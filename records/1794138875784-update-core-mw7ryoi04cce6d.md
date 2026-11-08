# update core: item-ledger

## done

- server module `item-ledger` (`server/core/item-ledger/`), following the spec change `3417ebc..HEAD` of `skills/server-core/modules/item-ledger.md`
  - `history.ts`: new history counter table `item_ledger_history_seq` (scope `user`, columns `user_id` `int64`, `last_seq` `int64`, key `user_id`, no expiry column, snapshot flag `false`) registered with `storage.register_table`. `insert_history` first runs one upsert on the counter that adds the row count to `last_seq` and returns the new value with `RETURNING`. A user without a counter row starts from `server-time.clock_now`, so the first `seq` is `clock_now` + 1. It reads no history row. Each history row is then written with a plain `INSERT` (the `ON CONFLICT ... DO UPDATE` overwrite and the `MAX(seq)` subquery are removed). If a row with that key already exists, the statement fails and storage rolls the transaction back. No history counter upsert runs when an operation has no history rows
  - `ledger.ts`, `index.ts`: the `Ledger` takes `item-ledger.historyRetentionMs` and `item-ledger.onceKeyRetentionMs` separately. A history row expires at `clock_now` + `historyRetentionMs`, and a `once_key` row at `clock_now` + `onceKeyRetentionMs`
  - `tests/history.test.ts`: tests for the changed and new `## test` items:
    - each retention keeps its rows until its own duration, also when the other duration is shorter (two server instances, one with each retention shorter)
    - a new user's first `seq` is `clock_now` + 1, and later rows continue by 1
    - when every row has expired but has not been swept, `seq` continues and the expired rows keep their values; after the sweep, the next `seq` is the largest + 1
    - for history rows written before the counter existed (with no counter row), new rows start at `clock_now` + 1, `list_history` with the largest earlier `seq` as the cursor returns them, and the earlier rows keep their values
    - when a row with the next key already exists, the request is `FAILED`/`INTERNAL` even though the handler caught the throw, and the balance, the existing rows, the counter and `once_key` stay unchanged
    - `list_history` paging, adapted to `seq` values that are relative to `clock_now`
- `server/generated/core_settings_schema.json`: the generated settings schema that the test run left untracked. It is committed because `ogw core test` leaves no test record while the checkout has untracked files, and `ogw.md` lists it among the generated files that are committed
- Behaviour of the unchanged operations is the same for content code. Only `seq` values change: they start at `clock_now` + 1 instead of 1. Code of other modules was not changed, and no caller needed to follow the change
- Core settings were not changed (keys, values and schema were already on main)
- No engine-specific implementation rules document, and `## <engine> build` of `tools/ogw.md` was not written
- Tests: `ogw core test server item-ledger` passed. Then one `ogw core test server` run on HEAD `2d3e2532` with item-ledger and every server module that `ogw core dependents item-ledger` lists passed on SQLite and PostgreSQL, and left a test record. Those modules are admin-api, ads-reward, attendance, auth, block-report, chat, coupon, friend, gacha, game-update, guild, iap, loot-table, mailbox, matchmaker, migration, mission, nickname, notice, offer, play-session, public-profile, ranking, rating, routing, shop, testing, user-snapshot-clone and validation. `ogw code check core` passed (type check, lint, dependency, secret)

## spec proposals

none

## review

none

## unverified

- Client modules listed by `ogw core dependents item-ledger` (AdCore, AuthCore, BootstrapCore, ChatCore, GameUpdateCore, NoticeCore, PaymentCore, PushCore, QACore, RealtimeCore, RemoteConfigCore, TutorialCore, UnitTestCore) were not run: the input sets the range to `ogw core test server`, and only server code changed
