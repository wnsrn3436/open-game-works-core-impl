# MessageCore review round 1

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

- The commit range changes no MessageCore code or test, and no `MessageCore.*`, `UICore.dimOpacity` or `InputBlockCore.maxDurationMs` settings value (`settings/core-settings.json`, `client/godot/generated/core_settings.json` only add `SoundCore.*`, `public-profile.findPerMinute` and `uiQuality`). Of the MessageCore dependencies, only TweenCore code changed: `Position`, `Rotation` and `Scale` of an arranged element (a `Control` whose parent is a `Container`) now go to its offset transform, decided when a change starts (`client/godot/core/tween_core/tween_core.gd:644`, `client/godot/core/tween_core/tween_core.gd:1021`). The MessageCore side of that change was checked: MessageCore plays presets only on the message object root (`client/godot/core/message_core/message_core.gd:251`, `client/godot/core/message_core/message_core.gd:296`), and that root is always a child of a toast or black box holder made by `_make_holder`, which is a plain `Control`, not a `Container` (`client/godot/core/message_core/message_core.gd:203`, `client/godot/core/message_core/message_core.gd:217`, `client/godot/core/message_core/message_core.gd:237`, `client/godot/core/message_core/message_core.gd:589`). So the root is never an arranged element, TweenCore writes `position`, `rotation` and `scale` as before, and `_put_back_tween_properties` (`client/godot/core/message_core/message_core.gd:348`) still puts back every property the presets can change. The `TweenCore.play_preset`, `is_playing`, `stop` and `get_preset_kind` signatures that MessageCore calls did not change in the range
- The Godot core tests were not run in this review; the code was only read
- Because there is a commit range, the parts of MessageCore that the range does not reach were not audited in full. This does not mean those parts passed
