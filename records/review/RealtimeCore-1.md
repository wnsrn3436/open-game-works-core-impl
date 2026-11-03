# review: RealtimeCore round 1

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

- Scope: the commit range changes no file under `client/godot/core/realtime_core/`, `core-spec/`, `settings/`, `proto/` or `server/`. Outside `records/` it changes only `client/godot/core/localization_core/localization_core.gd` and `client/godot/core/localization_core/tests/test_font_weight.gd`. RealtimeCore does not depend on `LocalizationCore` directly. It reaches it only through `AuthCore`, `NetworkCore`, `UICore` and `MessageCore`.
- Checked along that path: the only implementation change is the private `_restore_heading_types` (`client/godot/core/localization_core/localization_core.gd:714`), called from `_clean_up` (`client/godot/core/localization_core/localization_core.gd:854`) only when `_heading_chain` is not null, so only after `load_fonts` applied fonts. No operation of `LocalizationCore` changed. `client/godot/core/realtime_core/` has no reference to `load_fonts`, `HeadingLabel`, `HeadingButton`, `HeadingRichTextLabel`, `remove_type` or `clear_type_variation`, and outside `localization_core/` only `bootstrap_core/` has one. `client/godot/core/realtime_core/tests/support/realtime_test_case.gd:125` and `:135` run `LocalizationCore.init` and `load_translation` without `load_fonts`, so `LocalizationCore.release` at `client/godot/core/realtime_core/tests/support/realtime_test_case.gd:60` does not run the changed path in the RealtimeCore tests. The callers on the path use only `bind_text` (`client/godot/core/auth_core/auth_popup_util.gd:28`), `get_text` and `format` (`client/godot/core/auth_core/adapters/google_desktop_sign_in.gd:86`, `client/godot/core/message_core/message_core.gd:176`, `client/godot/core/ui_core/ui_core.gd:1808`).
- Run in this review: `ogw core test godot RealtimeCore` and `ogw core test godot RealtimeCore --web` pass on the target commit. The output of both jobs holds the lines `RealtimeCore pass` and `RealtimeCore pass (reused)`, so a result of the same key may have been reused instead of running again.
- Not checked: the implementation and tests of RealtimeCore were not compared with `client-core/modules/realtime-core.md`, because the range does not change them and `## spec changes` is `none`. This round is not a review of the whole target, so no problem that existed before the range was looked for, and `none` in `## out of scope` does not mean there is none. The specs of the modules RealtimeCore depends on, the `matchmaker` and `p2p-signaling` server specs and `client-core/engines/godot.md` were not read for the same reason.
- Not run: a build where `BootstrapCore` calls `load_fonts` and RealtimeCore then runs a match, including the `LocalizationCore.release` after it.
