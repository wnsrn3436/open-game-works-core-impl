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

- The commit range `d4e2728..13408e4` changes no NoticeCore file (`client/godot/core/notice_core/`, `core-spec/NoticeCore.json`), no file of the server `notice` module (`server/core/notice/`, `core-spec/notice.json`), no `BootstrapCore` file, and no contract (`proto/`, `client/godot/generated/contract/`). On the client it changes `UICore`, `TweenCore`, `ScreenEffectCore`, `UnitTestCore`, three `AuthCore` tests, and the generated core settings; on the server it changes `auth` (`login.ts`, `deletion.ts`, a new transaction failure test) and `testing/dev/setting_types.ts`; the rest are run records of other agents
- Checked how the changes reach NoticeCore:
  - `UICore` (in `## dependency`): `client/godot/core/ui_core/ui_core.gd:653` only adds the read-only `is_flow_in_progress`; `open_system_popup`, the hidden callback and `close_all_popups` that the maintenance popup flow of NoticeCore uses are unchanged in the range. NoticeCore code does not call `is_flow_in_progress`
  - `TweenCore`: not in NoticeCore's `## dependency` and not referenced by NoticeCore code; only the test support initializes and releases it (`client/godot/core/notice_core/tests/support/notice_test_case.gd:245`, `:274`). The change only adds the read-only `get_finite_playing_count` (`client/godot/core/tween_core/tween_core.gd:326`), so `init`/`release` behave the same
  - `ScreenEffectCore`: neither NoticeCore code nor its tests reference it; the added `time_basis` parameter has a default value
  - `UnitTestCore` (used by NoticeCore tests for the loopback HTTP server, `advance_clock` and `check_logs`): the change adds the `PUT /started` start signal in `_begin_run` / `_send_init_failure` and the setting `UnitTestCore.startTimeLimitMs`; `start_http_server`, `add_http_response`, `advance_clock` and `check_logs` are unchanged
  - Core settings: the added keys `QACore.captureJpgQuality`, `UnitTestCore.startTimeLimitMs` and the rename `uiQuality.settleMs` → `settleLimitMs` are not read by NoticeCore code or tests; the `NoticeCore.*` and `TimeCore.reachMarginMs` keys are unchanged
- The NoticeCore core tests were not run in this review: the checkout has no GUT addon (`client/godot/addons/` does not exist; `ogw core test` fills it). The conclusions above come from reading the code
- NoticeCore code outside the range (`notice_core.gd`, `notice_core_node.gd`, the image downloaders, `notice_waiter.gd`, `dev/`, the tests) was read only to find its references to the changed modules; it was not checked for problems that existed before the range
