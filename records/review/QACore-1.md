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

- The range 97851fcb..0b3952ab changes no QACore code or test; it changes only UICore (`client/godot/core/ui_core/ui_core.gd`, `client/godot/core/ui_core/system_popup_view.gd` and their tests) and records. Only the QACore paths that reach the changed UICore behavior were checked: input injection at frame start through `InputCoreDev.inject_device_input` (`client/godot/core/qa_core/dev/qa_core.gd:604`), the `key` / `key_down` commands and the focus mode test (`client/godot/core/qa_core/tests/test_input.gd:256`), `list_ui` `focused` (`client/godot/core/qa_core/dev/qa_query.gd:246`), `focus_ui` (`client/godot/core/qa_core/dev/qa_builtins.gd:671`), the debug screen input (`client/godot/core/qa_core/dev/qa_core_node.gd:56`) and telemetry feedback kinds. The deferred focus start lands before the frame ends, so the commands that end at frame end still see the focus
- `ogw core test godot QACore` ran the headless pass: 136 tests, 136 passed. The render pass did not run because the macOS screen was locked or the display slept, so the QACore render-pass tests were not run on this range
- The UICore changes themselves were not reviewed: they belong to the UICore review target (`records/review/UICore-1.md`)
