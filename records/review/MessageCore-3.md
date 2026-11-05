# review MessageCore round 3

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

- I did not run the core tests. No MessageCore code or test changed in the range (`git diff --stat 95fb207a..9b486200 -- client/godot/core/message_core` is empty). The changes in the range are spec changes and code, tests and records of other targets
- The review file of round 2 has no `## findings` rows and no `open` rows in `## previous`, so `## previous` has no rows
- I checked each hunk of the spec changes diff in `message-core.md` against the code. `### prepare` now says only that the length of a tween preset is cycle time × repeat count of `TweenCore`. `_length_ms` (`client/godot/core/message_core/message_core.gd:471-474`) returns `_cycle_ms(definition) * definition.repeat_count`, and `_cycle_ms` (`client/godot/core/message_core/message_core.gd:478-488`) sums per step the largest delay + duration, the cycle time of `open-game-works-core/skills/client-core/modules/tween-core.md:70`. The spec no longer says whether a preset that fails the `TweenCore` definition check (e.g. repeat count -1 in `client/godot/core/message_core/tests/resources/test_fade_negative_repeat.tres`) counts with its loaded values (-100 ms, what the code does) or as the definition without steps that `TweenCore` plays (0 ms). The two differ only when `MessageCore.blackBoxDurationMs` alone is `InputBlockCore.maxDurationMs` or more while the negative lengths bring the sum below it. `client/godot/core/message_core/tests/test_prepare.gd:72` (no log, `prepare` `true`) holds under both readings with the test settings. Static check `tween preset` still blocks such a preset in the game repo (`open-game-works-core/skills/client-content/engines/godot.md:76`), and by the new rule of `open-game-works-core/skills/core/SKILL.md` what nothing relies on is left to the implementation, so I wrote no finding
- `### close` now says "the tweens it played". The code plays at most one tween per message at a time (the exit tween starts only after the enter tween stops playing, `client/godot/core/message_core/message_core.gd:278-283`), and `_lower` and `_drop_destroyed` stop the tween held in `tween_handle` (`client/godot/core/message_core/message_core.gd:307-308`, `client/godot/core/message_core/message_core.gd:321-322`). `client/godot/core/message_core/tests/test_close.gd:16` and `client/godot/core/message_core/tests/test_close.gd:38` check that the tween stops
- `### display failure` now says only that MessageCore judges destruction before each operation on the message object. The code judges it in `_advance` each frame before the exit tween and step 5 (`client/godot/core/message_core/message_core.gd:274`), and in `_close_kind` before lowering (`client/godot/core/message_core/message_core.gd:340`), which matches it and the Godot rule of judging each frame (`open-game-works-core/skills/client-core/engines/godot.md:283`). The removed sentence about the log of a kind close or `release` that finds the object destroyed, and the removed `## test` item about `close_all` in the frame the code made toast is destroyed, leave the code in `_close_kind` and `_drop_destroyed` (`client/godot/core/message_core/message_core.gd:320-346`) and the tests at `client/godot/core/message_core/tests/test_close.gd:202-258`. They still match the `## error` row "toast object made by code or black box object destroyed outside while on display" (error log, display failure) and the kind close, which empties the queue
- The other hunks of the diff (godot.md rows of SceneCore, CameraCore, LocalizationCore, NativeUiCore, RealtimeCore; localization-core.md `bind_text` and `unbind_text`; ui-core.md system popup areas, event order and open errors; core SKILL.md and command.md) reach no MessageCore code: MessageCore calls only `UICore.get_layer` and `UICore.get_block_pass_list` of UICore, does not call `LocalizationCore.bind_text` or `unbind_text`, and does not use the other modules
