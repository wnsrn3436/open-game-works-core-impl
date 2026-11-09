# review SoundCore round 1

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

- The range changes SoundCore only by removing `SoundCoreDev.set_dev_mute`, `SoundCoreDev.set_play_skip` and their state (`_dev_mutes`, `_play_skip`) from `client/godot/core/sound_core/sound_core.gd`, `client/godot/core/sound_core/dev/sound_core_dev.gd`, deleting `client/godot/core/sound_core/tests/test_dev_feedback.gd` and dropping the DEV mute clause from `client/godot/core/sound_core/tests/test_volume.gd`. This matches the current spec, whose `## DEV` has only `get_playing`, `get_haptic_log` and `inject_focus_change`, and whose `reset_volume_settings` test item has no DEV mute clause. A search of the checkout (`.gd`, `.md`, `.json`, `.ts` outside `records/`) finds no remaining reference to `set_dev_mute`, `set_play_skip`, `_dev_mutes`, `_play_skip` or DEV mute; the callers of `SoundCoreDev` outside SoundCore (`qa_builtins.gd`, `cutscene_test_case.gd`) use only `get_playing` and `get_haptic_log`.
- `ogw core test godot SoundCore` passed on this commit (result reused from the cache for the same key). The browser run (`--web`) was not run: the range changes no web-specific file of SoundCore.
- The rest of SoundCore, unchanged by the range, was not reviewed: the commit range limits this round to the problems the changes cause or reveal.
