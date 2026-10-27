# NoticeCore review round 1

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

- The commit range `cf89b7f..1b34dcd` changes no NoticeCore file (`client/godot/core/notice_core/`, `core-spec/NoticeCore.json`), no file of the server `notice` module (`server/core/notice/`, `core-spec/notice.json`), no file of the client modules in NoticeCore's `## dependency` (`LogCore`, `EventCore`, `TimeCore`, `LocalDataCore`, `LocalizationCore`, `NetworkCore`, `UICore`, `BadgeCore`), and no contract (`proto/`, `client/godot/generated/contract/`). On the client it changes `QACore` (`dev/qa_core.gd`, `dev/qa_telemetry.gd`, a telemetry test), one `AuthCore` test, the `ogw-secure-storage` macOS plugin and its `engine.json` item, and the generated core settings; on the server it changes `ads-reward`, `routing`, `storage`, `testing/dev/setting_types.ts` and test fixtures of `coupon`, `idempotency`, `item-ledger`, `mailbox`; the rest are README files and run records of other agents
- Checked how the changes reach NoticeCore:
  - `QACore`: not in NoticeCore's `## dependency`; neither NoticeCore code nor its tests reference it (no match for `QACore` or `qa_core` under `client/godot/core/notice_core/`). The change only routes release inputs (`touch_up`, `key_up`, `mouse_up`, `pad_button_up`) to `add_release` in telemetry
  - `ogw-secure-storage` plugin and the `AuthCore` plugin test: NoticeCore code and tests do not reference secure storage
  - Core settings: the changed `routing.ipRateLimitPerMinute` and the added `storage.sweepBatchSize`, `storage.sweepTableBudgetMs` are server keys that NoticeCore code and tests do not read; the `NoticeCore.*` keys are unchanged
  - Server `storage` (`sweep_expired` in batches, expiry column index, `CREATE INDEX IF NOT EXISTS`): the server `notice` module registers its notice table with expiry column `end_at` (`server/core/notice/index.ts:456`), so its expired rows are swept as before; the change alters only how many rows one statement deletes, the added index and the return type of `sweep_expired`, not which rows are deleted, so the notice list that NoticeCore fetches is unchanged. The server `notice` module itself is a separate review target and was not reviewed here
  - Server `routing` (IP rate limit default 60 → 300, `storage_sweep` error log): raising the limit does not change any response NoticeCore handles
- The NoticeCore core tests were not run in this review: the checkout has no GUT addon (`client/godot/addons/` does not exist; `ogw core test` fills it). The conclusions above come from reading the code and the diff
- NoticeCore code outside the range was read only to find its references to the changed modules; it was not checked for problems that existed before the range
