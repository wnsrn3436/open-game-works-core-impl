# review InputCore round 1

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

- The InputCore changes in the range are commit e09ca62 only: the `input_prompt` `name` input prompt token check of `tools/data-tool/src/checks/InputCore.ts` and its tests in `tools/data-tool/tests/input-core-check.test.ts`, the comment of `_on_emulated_mouse` in `client/godot/core/input_core/input_core.gd:662`, the order assert of `test_mouse_input_the_engine_made_from_touch` (`client/godot/core/input_core/tests/test_gesture.gd:294`, with `gui_input_classes` of `tests/support/input_core_test_control.gd`) and `test_a_default_binding_longer_than_the_limit` (`client/godot/core/input_core/tests/test_key_binding.gd:180`). Other files of the range belong to other modules and were not reviewed
- The data check was compared with `## data` of the InputCore spec and the input prompt token rules of the `data` skill. It checks the source text of `name` and the `text` of every translation file other than the source language, which matches how the build takes the source text for the source language (`tools/data-tool/src/build.ts:221`) and how `checkFormats` skips that file. `{action}` without `:` is `bad_prompt` in `tokensOf` and is left to the common `translation_format` check, which the second test covers. `tests/input-core-check.test.ts` was run: 9 passed
- `data/glossary.csv` language cells of `input_prompt` names are not checked by the new rule; they are not text the build shows, so this was not treated as a finding
- The Godot tests (`test_gesture.gd`, `test_key_binding.gd`) were not run in this review (`ogw core test godot` was not started). They were read against the spec: the new key binding test matches the `## test` item on a default binding longer than `InputCore.maxKeysPerAction` (test limit 3, binding of 4 keys and 4 gamepad buttons), and the order assert matches the rule that each mouse input made from touch comes right before the touch input it is made from
