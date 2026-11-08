# review UserStateCore round 1

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

- The commit range 85f6b36d..451e4c9b changes no file of `client/godot/core/user_state_core/` and no file of `core-spec/UserStateCore.json`. Of the modules it depends on, the range changes `client/godot/core/log_core/log_core.gd` (comments only) and `client/godot/core/time_core/time_core.gd` and `client/godot/core/time_core/dev/time_core_dev.gd` (`make_random_seed`, the DEV random base and the DEV frame step). Checked that these do not reach UserStateCore: UserStateCore calls only `TimeCore.is_synced`, `get_server_time`, `is_reached`, `is_before_end`, `get_day_number` and `get_current_day` (client/godot/core/user_state_core/user_state_core.gd:219, 411, 427, 483, 693, 706, 712, 898, 923, 925, 974, 978), and these read `_server_time_at(_monotonic_now())` (client/godot/core/time_core/time_core.gd:188-223), which the frame step does not change: the frame step changes only the real increment of the game time in `_on_engine_frame` (client/godot/core/time_core/time_core.gd:421-422). The generated contract change adds only `LogoutOtherDevicesRequest` and `LogoutOtherDevicesResponse`, and the core settings change does not touch `TimeCore.reachMarginMs`, the only core settings key UserStateCore reads (client/godot/core/user_state_core/user_state_core.gd:13)
- The code of UserStateCore that the range does not reach was not reviewed again, as a range review takes only problems that the changes of the range cause or reveal
- The core tests of UserStateCore were not run in this review; `ogw review run` runs the core tests of the modules that depend on the changed modules
