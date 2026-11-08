# TutorialCore review round 1

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

- The commit range 85f6b36d..61cdff7a changes no file of `client/godot/core/tutorial_core/` and no file of the server `tutorial` module (`server/core/tutorial/`). The review checked the changes of the range in the modules TutorialCore depends on, at the places TutorialCore calls them.
- `client/godot/core/input_core/input_core.gd`: the changes add the stick axis options (`set_pad_axis_inverted`, `set_pad_axis_sensitivity`, `reset_pad_axes`, `load_keys` of the options) and the required core settings key `InputCore.padAxisSensitivities`. The options apply only to gamepad axis sources of `Gameplay` actions (`_takes_axis_options`), and the `_input` path that calls the UI pointer observer that `TutorialCore.init` sets (`tutorial_core.gd:134`) is unchanged. `client/godot/generated/core_settings.json` has the new key, so `InputCore.init` in the TutorialCore tests still succeeds.
- `client/godot/core/time_core/time_core.gd`: the changes add `make_random_seed` and the DEV frame step. TutorialCore reads only `TimeCore.get_real_time` (`tutorial_core.gd:909`) for `TutorialCore.anchorWaitWarnMs`; with the frame step the real elapsed time is the fixed step, which is the real elapsed time that the TimeCore spec defines.
- `client/godot/core/auth_core/auth_core.gd`: the changes add `logout_other_devices` (which keeps the session) and change the pending token handling of `link_account`. TutorialCore reads only `AuthCore.is_logged_in` (`tutorial_core.gd:438`), and neither change changes the logged in state.
- `client/godot/core/log_core/log_core.gd`: only comments changed.
- `ogw core test godot TutorialCore` passed on HEAD 61cdff7a (job mw7u4g509a4864).
- TutorialCore code and tests that existed before the range and that no change of the range reaches were not reviewed for problems unrelated to the range.
