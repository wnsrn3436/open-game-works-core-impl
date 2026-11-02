# MessageCore review round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/ui_core/ui_core.gd:2374: medium `UICore.is_dimmed` (added in this range) counts only the dims of `UICore`, while the dim of a black box message is a separate element (open-game-works-core/skills/client-core/modules/message-core.md:47), so `list_ui` gives `dimmed` `false` to panel text under a black box dim, and the contrast condition of the UI quality check (open-game-works-core/skills/client-core/modules/qa-core.md:151) still measures that text. This matches the `dimmed` definition (open-game-works-core/skills/client-core/modules/ui-core.md:132), so the fix is a decision in the `UICore`/`QACore` specs. Run path: a content command `<feature>.open_<screen>` calls `MessageCore.show_black_box`; `finite_tweens` is 0 with the default empty tween keys, so the capture runs within the default `MessageCore.blackBoxDurationMs` of 2000 ms, under the default `UICore.dimOpacity` of 0.5. Calculated, not run: text of sRGB grey 0.6 on background 0.1 has contrast 6.1 without the dim and 2.3 under it (assuming sRGB-space blending), below the default `minContrast` of 3, so a screen that passes alone fails the check. No core module calls `show_black_box`, so only content code reaches this path

## debt

none

## must fix

none

## unknown

- The commit range `d4c3ae7f..1792591a` changes no MessageCore code or test (`client/godot/core/message_core/`) and no `core-spec/MessageCore.json`. It changes no code of `LogCore`, `TimeCore`, `ResourceCore`, `PoolCore`, `LocalizationCore`, `ResolutionCore`, `InputBlockCore` or `TweenCore`, and nothing under `settings/`. In `client/godot/generated/core_settings.json` it only removes `uiQuality.maxFlatShare`, which MessageCore does not read
- Of the MessageCore dependencies, the range changes only `UICore`, and that change is additive: `is_dimmed` and its helpers (`client/godot/core/ui_core/ui_core.gd:750`, `client/godot/core/ui_core/ui_core.gd:2374`, `client/godot/core/ui_core/ui_core.gd:2379`). MessageCore does not call them. `UICore.get_layer` and `UICore.get_block_pass_list`, which MessageCore calls, did not change in the range
- For an element on the `Message` layer, `_dim_above` gives `false` for both `UICore` dims, so `dimmed` of a toast or black box text element is `false`. This was checked by reading the code, not by a run
- The `QACore` change adds the `dimmed` field to `list_ui` (`client/godot/core/qa_core/dev/qa_query.gd:271`), and that field is not read by MessageCore. The `QACore` and `UICore` tests of the range were read only as far as they relate to MessageCore; they have no message case
- The Godot core tests were not run in this review, and neither the UI quality check nor the contrast in `## out of scope` was run; the code was only read and the contrast calculated
- Because there is a commit range, the parts of MessageCore that the range does not reach were not audited in full. Display, queue, close and prepare were read, and the `TweenCore.stop`, `TweenCore.is_playing`, `TweenOptions` time basis, `PoolCore.give_back` and missing translation key behavior they rely on were compared with the specs, with no problem found. The coverage of `## test` of the spec by the tests was not audited. This does not mean those parts passed
