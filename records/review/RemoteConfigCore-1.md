# review RemoteConfigCore round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/time_core/time_core.gd:114: medium TimeCore turns the frame step on from the engine arguments `--fixed-fps` and the Movie Maker fps (`_engine_frame_step_fps`, line 442), and its DEV setter is `TimeCoreDev.set_test_frame_step` (client/godot/core/time_core/dev/time_core_dev.gd:124). The defining documents name the setter `TimeCore.set_frame_step` and set the frame step only when it was called before `init` (`time-core.md` `## DEV`), which `BootstrapCore` does from the launch value `OGW_FRAME_STEP_FPS` (`bootstrap-core.md` `passing the frame step`). So a dev run started with `--fixed-fps` but without `OGW_FRAME_STEP_FPS` is at a frame step the spec does not give, and the real elapsed time that RemoteConfigCore uses for its automatic refresh (client/godot/core/remote_config_core/remote_config_core.gd:252) follows that frame step

## debt

none

## must fix

none

## unknown

- The commit range 85f6b36d..e5ed464e changes no file under `client/godot/core/remote_config_core/` and no file of server core `remote-config`. Among the modules RemoteConfigCore depends on, it changes TimeCore (the random seed and the DEV frame step), AuthCore (`logout_other_devices` and the rewrite of the storage item in `link_account`; `get_login_remote_config` is unchanged) and LogCore (comments only), and the generated contract (LogoutOtherDevices and matchmaker messages; no RemoteConfig or experiment message changed). The core settings key `RemoteConfigCore.refreshIntervalMs` is unchanged. None of these changes the values RemoteConfigCore reads or the events it receives, except that `TimeCore.get_real_time` follows a frame step in DEV, which the spec of TimeCore defines and which is written in `## out of scope` for how it is turned on
- The RemoteConfigCore code outside what the range reaches was not reviewed, because a review with a commit range reviews only problems that the range causes or reveals
- `ogw core test godot RemoteConfigCore` in this worktree gave `RemoteConfigCore pass`; it left no test record because of the uncommitted deletion of the previous review file at `output` in this checkout
