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

- The commit range 85f6b36d..9808fd47 changes no file of `client/godot/core/cutscene_core/`, `core-spec/CutsceneCore.json`, `tools/data-tool/src/checks/CutsceneCore.ts` or the cutscene test data. The review covered the changed dependency code that CutsceneCore calls: `InputCore` (stick axis inversion and sensitivity), `TimeCore` (`make_random_seed`, DEV random base and frame step), `SoundCore` (`reset_volume_settings`, random seeds from `TimeCore.make_random_seed`), `CameraCore` (shake seed), `LogCore` (comments only), `ScreenEffectCore` (tests only), and the new core settings keys
- InputCore: the stick axis options apply only to `Gameplay` actions (input-core.md:181, `_takes_axis_options` in client/godot/core/input_core/input_core.gd), and `cutscene_advance` and `cutscene_skip` have binding context `Cutscene` (input-core.md:80). So the raw axis value sign that `_is_advance_binding` (client/godot/core/cutscene_core/cutscene_core.gd:1637) compares with the `cutscene_advance` binding still matches how InputCore presses that action. The new required setting `InputCore.padAxisSensitivities` is in settings/core-settings.json and client/godot/generated/core_settings.json, so InputCore `init` in the cutscene tests is unaffected
- TimeCore: CutsceneCore reads only `get_real_time`, `get_game_time`, `is_paused` and `set_paused` (cutscene_core.gd:1349, 1449-1450, 1718-1757). These read the accumulated real and game time, which the DEV frame step changes the same way for every module (time-core.md:175). CutsceneCore draws no random value
- `ogw core test godot CutsceneCore` passes on the checkout at 9808fd47. It wrote no test record because the checkout has uncommitted changes (only this review file)
- Not checked: how the DEV frame step under the engine movie maker interacts with how long a voice plays (`SoundCore.is_playing` follows the audio clock, not TimeCore). It is outside the changes of this range for CutsceneCore and was not run
