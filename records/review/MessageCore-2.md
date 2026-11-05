# review MessageCore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | The fix was a spec change (`spec change` `yes`). The message-core spec `### prepare` (spec changes diff, `open-game-works-core/skills/client-core/modules/message-core.md:60`) now says that the length of a tween preset is cycle time × repeat count "computed from the loaded definition without the `TweenCore` definition check". It also says that static check `tween preset` blocks in the game repo a preset that fails a definition check item that does not depend on the target object. That check is defined in `open-game-works-core/skills/client-content/engines/godot.md:76`, and its items include a repeat count of at least 0 and at most `TweenCore.maxRepeatCount`. `_length_ms` (`client/godot/core/message_core/message_core.gd:471-474`) returns `_cycle_ms(definition) * definition.repeat_count` from the loaded definition without the check, and `_cycle_ms` (`client/godot/core/message_core/message_core.gd:478-488`) sums the largest delay + duration per step, which is the TweenCore cycle time (`open-game-works-core/skills/client-core/modules/tween-core.md:70`, `### progress`). So the -100 length of `client/godot/core/message_core/tests/resources/test_fade_negative_repeat.tres` is the length the spec now defines, and `client/godot/core/message_core/tests/test_prepare.gd:72` (no log, `prepare` `true`) matches it |

## out of scope

none

## debt

none

## must fix

none

## unknown

- I did not run the core tests. No MessageCore code or test changed in the range (`git diff --stat 75e3534e..95fb207a -- client/godot/core/message_core` is empty). The changes are spec changes and records of other targets
- I checked the parts of the spec changes diff that reach MessageCore code. The message-core `### prepare` change is covered by R1-1 above. The new Godot rule that the empty `PoolCore` handle is `Vector4i.ZERO` matches `client/godot/core/message_core/message_core.gd:213` and `client/godot/core/message_core/message_kind_state.gd:27`, `client/godot/core/message_core/message_kind_state.gd:64`. MessageCore does not call `LocalizationCore.bind_text` or `unbind_text`, and does not subscribe to `UICore` events (`UIOpenedEvent`, `PanelFlowFinishedEvent`), so the localization-core and ui-core changes reach no MessageCore code. The CameraCore, GameUpdateCore, NetworkCore and NativeUiCore rows of the godot.md diff are not used by MessageCore
- `_cycle_ms` skips a `null` step or change, and the spec does not say how such a step counts in a length computed without the definition check. Static check `tween preset` blocks a step with no changes in the game repo. I found no core test or caller input that reaches a `null` step through a loaded `.tres` preset, so I wrote no finding
