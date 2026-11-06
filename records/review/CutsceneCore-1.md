# review CutsceneCore round 1

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

- No file of `client/godot/core/cutscene_core/` changed in the range de482eec..1c661932, and `## spec changes` is `none`. The range changes the dependencies of CutsceneCore with DEV states that are off at `init` and turned off by `release`: `TweenCoreDev.set_finite_skip` (`client/godot/core/tween_core/tween_core.gd:274`, `client/godot/core/tween_core/tween_core.gd:465`, `client/godot/core/tween_core/tween_core.gd:545`), `SoundCoreDev.set_play_skip` and `set_dev_mute` (`client/godot/core/sound_core/sound_core.gd:372`, `client/godot/core/sound_core/sound_core.gd:623`, `client/godot/core/sound_core/sound_core.gd:866`), `CameraCoreDev.set_shake_skip` (`client/godot/core/camera_core/camera_core.gd:402`), `ScreenEffectCoreDev.set_world_skip` (`client/godot/core/screen_effect_core/screen_effect_core.gd:341`) and `PoolCoreDev.set_effect_skip` (`client/godot/core/pool_core/pool_core.gd:438`). Only the CutsceneCore code that calls the changed operations was read, to see whether these states break it (checked by reading, not run):
  - finite skip: a `Move` tween from `TweenCore.play` (`client/godot/core/cutscene_core/cutscene_core.gd:1106`) gets a valid handle and ends `Completed` at its end state before the frame ends, the same path a cycle-time-0 preset already took; `_update_commands` (`client/godot/core/cutscene_core/cutscene_core.gd:1337`) marks it done through `TweenCore.is_playing`, and `TweenCore.skip_to_end` and `TweenCore.stop` of an ended handle are the existing finalize and stop paths. `CameraCore.move_by_preset` (`client/godot/core/cutscene_core/cutscene_core.gd:1169`) and `ScreenEffectCore.play_preset` on `Cutscene` (`client/godot/core/cutscene_core/cutscene_core.gd:1179`) end through their awaited results, so `Camera` and `ScreenEffect` end and the goal position and preset end state hold
  - play skip: `SoundCore.play` returns `SoundCore.INVALID_HANDLE`. The line voice (`client/godot/core/cutscene_core/cutscene_core.gd:1381`) then sets voice end at `Line` start as for a `Line` that played no line voice; `_play_sound` (`client/godot/core/cutscene_core/cutscene_core.gd:963`) keeps no looping handle; the replay voice and the stops skip the invalid handle (`client/godot/core/cutscene_core/cutscene_core.gd:1435`, `client/godot/core/cutscene_core/cutscene_core.gd:1839`). `play_bgm` is not changed by the range
  - World skip affects only the `World` channel, and CutsceneCore plays only on `Cutscene`. Shake skip changes only `CameraCore.shake`, which CutsceneCore does not call. Effect skip changes only auto-return borrows; CutsceneCore makes staged objects with `PackedScene.instantiate` (`client/godot/core/cutscene_core/cutscene_core.gd:1202`) and the line history items are borrowed by the `UICore` scroll list, not as auto-return effects
- Core tests were not run in this review: no finding needed a run to check, and `ogw review run` runs the core tests of the modules that depend on a fixed target
- Whether a cutscene played while the QACore reward window is open stays correct was checked only by reading the paths above; no CutsceneCore test runs with these DEV states on, and the cutscene-core spec does not require one
- The QACore code that turns these states on (`client/godot/core/qa_core/dev/qa_core.gd`) belongs to the QACore target and was not reviewed
- CutsceneCore code outside the callers of the changed operations was not reviewed, since the commit range is not `none`
