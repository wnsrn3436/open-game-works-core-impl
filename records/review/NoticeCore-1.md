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

- The commit range `2ef5ae8..e51f274` changes no NoticeCore file (`client/godot/core/notice_core/`, `core-spec/NoticeCore.json`) and no file of the server `notice` module (`server/core/notice/`, `core-spec/notice.json`). On the client it changes `AuthCore` and `BootstrapCore` (public code in the ban and deletion code popups, `client/godot/core/bootstrap_core/bootstrap_core.gd:966`, `:1003`), `SoundCore` (SFX pitch and volume variation, voice duck of the `Bgm` bus, five new core settings), `TweenCore` (offset transform for arranged elements, `client/godot/core/tween_core/tween_core.gd:1020`), the generated contract and the generated core settings; on the server it changes `auth`, `public-profile`, `storage`, `routing` and many tests; the rest are run records of other agents
- Checked how the changes reach NoticeCore:
  - Contract: `proto/ogw/core.proto` adds `BanDetail.public_code`, `AuthResult.public_code`, `PublicProfileEntry.public_code` and the RPC `FindUserByPublicCode` with its two messages; `Notice`, `NoticeKind`, `GetNoticesRequest` and `GetNoticesResponse` are unchanged. Requests are routed by name (`request_name()`, e.g. `core/FindUserByPublicCode` in `client/godot/generated/contract/core_contract.gd`), not by service position, so the new RPC inserted in the middle of `service Core` does not shift `GetNotices` that `NoticeCore._send_fetch` sends (`client/godot/core/notice_core/notice_core.gd:360`)
  - `BootstrapCore`: the changed code is only the ban and deletion code failure popups after a failed login (`_login_failed`, `_on_deletion_pressed`); the `NoticeCore.wait_maintenance_clear` call of the `Login` stage (`client/godot/core/bootstrap_core/bootstrap_core.gd:542`) is unchanged
  - `SoundCore` and `TweenCore` are not in NoticeCore's `## dependency` and NoticeCore code does not reference them; only the test support initializes and releases them (`client/godot/core/notice_core/tests/support/notice_test_case.gd:244`, `:274`, `:277`). The new `SoundCore` settings that `SoundCore.init` now requires are present in `settings/core-settings.json` and in the generated `client/godot/generated/core_settings.json` / `core_settings_types.json`, so the test support's `SoundCore.init` still has its settings
  - Server `routing`: the ban step now fills `BanDetail.public_code` (`server/core/routing/pipeline.ts:588`) and `REQUEST_PREPARE` gains `core/FindUserByPublicCode`; neither touches `GetNotices` or the server `notice` module
- The NoticeCore core tests were not run in this review: the checkout has no GUT addon (`client/godot/addons/` is filled only by `ogw core test`, which writes generated files into the checkout). The conclusion above comes from reading the code
- NoticeCore code outside the range (`notice_core.gd`, `notice_core_node.gd`, the image downloaders, `notice_waiter.gd`, `dev/`, the tests) was read only to find its calls into the changed modules; it was not checked for problems that existed before the range
- Whether `TweenCore`'s new offset transform path changes how `UICore` animates the maintenance system popup that NoticeCore opens with `UICore.open_system_popup` was not checked; it is a `UICore`/`TweenCore` presentation concern and NoticeCore's behavior (open, close, button handling) does not read tween values
