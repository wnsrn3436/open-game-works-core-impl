# review: AuthCore round 1

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

- The commit range `f3ac5b0..0da153b` changes no file under `client/godot/core/auth_core/` and no spec (`## spec changes` is `none`). The only implementation change is `_restore_heading_types` of `client/godot/core/localization_core/localization_core.gd:714`, with its test `client/godot/core/localization_core/tests/test_font_weight.gd`. So AuthCore was read only along the paths that reach that change, and the rest of AuthCore (login, token storage, refresh, consent, account, social adapters) was not reviewed in this round.
- Paths read: AuthCore uses `LocalizationCore` only through `bind_text` (`client/godot/core/auth_core/auth_popup_util.gd:28`) and `get_text` (`client/godot/core/auth_core/adapters/google_desktop_sign_in.gd:86`), and neither reaches `_restore_heading_types`. AuthCore code, tests and test prefabs have no reference to `HeadingLabel`, `HeadingButton`, `HeadingRichTextLabel` or `theme_type_variation`, and no call to `load_fonts`. The only `LocalizationCore.release` call under `client/godot/core/auth_core/` is in `client/godot/core/auth_core/tests/test_plugin_waits.gd:268`; there `_heading_chain` is null because `load_fonts` did not run, so `_clean_up` does not call `_restore_heading_types` (`client/godot/core/localization_core/localization_core.gd:853`).
- The correctness of the `LocalizationCore` change itself was not judged here. It is the target of `records/review/LocalizationCore-1.md` and `records/review/LocalizationCore-2.md`.
- Run in this review: `ogw core test godot AuthCore` passes on the target commit. The result was reused from a passing result of the same key, not run again. The browser run (`--web`) and the modules that depend on AuthCore were not run.
- A theme whose popups use a heading type together with AuthCore popups (a game prefab of `termsPopup`, `agePopup`, `privacyPopup`, `pushConsentPopup` with a heading style, across `release` and another `init`) was not run. No core test resource has such a prefab.
