# review: QACore round 1

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

- The range `f3ac5b0..8cc4faa` changes only `client/godot/core/localization_core/localization_core.gd` (`_restore_heading_types`), `client/godot/core/localization_core/tests/test_font_weight.gd` and records. No file under `client/godot/core/qa_core` changed.
- The reach into this target was checked by reading. No file under `client/godot/core/qa_core` names `HeadingLabel`, `HeadingButton`, `HeadingRichTextLabel`, a `Theme` object or `load_fonts`. QACore does not call `_restore_heading_types`. The target names `LocalizationCore.release` once, in the module list at `client/godot/core/qa_core/tests/test_state.gd:330`. `test_state_through_a_boot` (`client/godot/core/qa_core/tests/test_state.gd:45`) boots with that list, so it can reach the changed code through `BootstrapCore`, which calls `LocalizationCore.load_fonts` (`client/godot/core/bootstrap_core/bootstrap_core.gd:400`). That test asserts no theme type, and whether it reached `_restore_heading_types` in the run was not checked.
- QACore reads the theme only per element, in `_font_size` and `_is_clipped` (`client/godot/core/qa_core/dev/qa_query.gd:311`, `client/godot/core/qa_core/dev/qa_query.gd:320`). `get_theme_font` and `get_theme_font_size` follow the type variation of the element, so after a restart `list_ui` reads a style based on a heading type with the font LocalizationCore applied to that style. This was read and not run: no test of the target runs `list_ui` on an element in the `heading` text style, and neither does the range. `open-game-works-core/skills/client-core/modules/qa-core.md` sets no test for that case, so it is not a finding.
- `set_language` (`client/godot/core/qa_core/dev/qa_builtins.gd:813`) only calls `LocalizationCore.select_language` and requests a restart. The range does not change that path.
- Run in this review: `ogw core test godot QACore` passes on the target commit (job mw0uje9h88d308, reused from a passing result of the same key, not run again). `ogw core test godot QACore --web` was not run here. `ogw core dependents LocalizationCore` lists `QACore`. `records/1793718260785-update-core-mw0tjfw196b34a.md` and `records/1793719054821-review-fix-mw0u0gkl5c81ec.md` report that `godot` and `godot --web` pass for `LocalizationCore` and its dependents, without naming `QACore`.
- The QACore code and tests outside that reach were not read, as the range does not change them. Read: part of `client/godot/core/qa_core/dev/qa_query.gd` (the `language` field, `list_ui`, `_font_size`, part of `_is_clipped`) and `_set_language` and `_set_quality_level` of `client/godot/core/qa_core/dev/qa_builtins.gd`. Not read: the rest of those two files, `qa_core.gd`, `qa_input.gd`, `qa_telemetry.gd`, `qa_channel.gd`, `qa_debug_screen.gd`, and the tests. So `## out of scope` being `none` does not state that those files have no problem, and the behavior of `open-game-works-core/skills/client-core/modules/qa-core.md` was not compared with them in this round.
- The dependency specs in `## definition` of the input other than `localization-core.md` and the LocalizationCore row of `godot.md` were not read, as no code on their side changed in the range.
- A project theme loaded from a `.tres`, and the `pong` game with this change, were not run. The core agent report lists the same two as unverified.
