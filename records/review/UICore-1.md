# review UICore round 1

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

- The commit range de482eec..3949cc17 changes no file under client/godot/core/ui_core/ and no UICore spec (input `## spec changes` is `none`). The review covered the changes in that range to the modules UICore depends on and calls, as UICore uses them: TweenCore finite skip (client/godot/core/tween_core/tween_core.gd:274, :465, :545, :555), SoundCore play skip and DEV mute (client/godot/core/sound_core/sound_core.gd:372, :623, :866), PoolCore effect skip (client/godot/core/pool_core/pool_core.gd:436), and the new QACore settings keys in client/godot/generated/core_settings.json
- TweenCore finite skip against UICore: UICore plays its open and close tweens with `TweenCore.play_preset` after loading the presets (client/godot/core/ui_core/ui_core.gd:541, :553, :591, :1310, :1365, :1440, :1654, :1687) and waits through `call_waiter.gd` `start_tween`, which reaches `TweenCore.wait_end` in the same call before the deferred `_flush_end_due` ends the skipped tween, so the wait ends with `Completed` as for a tween with cycle time 0. `TweenCore.stop` of an end-due record in `close_popup`, `close_all_popups` and `reset_panel_stack` goes through the same `_end` path. UICore does not read `TweenStartedEvent` outside its tests. This was read in code, not run with the skip on
- SoundCore play skip and DEV mute against UICore: UICore ignores the handle that `SoundCore.play` of `[ui_button_click]` returns (client/godot/core/ui_core/ui_core.gd:2226), so `INVALID_HANDLE` under the play skip changes no UICore result. Read in code, not run with the skip on
- PoolCore effect skip against UICore: the effect skip acts only on auto-return borrows (pool_core.gd:436). `UIScrollList` borrows item UIs and the loading item as owner-bound borrows (client/godot/core/ui_core/ui_scroll_list.gd:485, :543); a content item prefab whose `PoolObject` has auto return on was not considered, since that already breaks the scroll list without the skip
- `ogw core test godot UICore` was run at 3949cc17 and passed. The core tests of other modules and the whole suite were not run
- The QACore feedback switch (client/godot/core/qa_core/dev/qa_core.gd) and the TweenCore, SoundCore, PoolCore, ScreenEffectCore and CameraCore changes themselves were not reviewed beyond how UICore uses them; they are outside this target. TweenCore round 1 (records/review/TweenCore-1.md) already records the finite skip chain within one frame
