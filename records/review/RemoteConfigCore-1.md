# review RemoteConfigCore round 1

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

- The commit range changes no file under `client/godot/core/remote_config_core/`. Checked the changes of the range in the code RemoteConfigCore calls or that calls it: `client/godot/core/auth_core/auth_core.gd` (storage waits, `release` before `init`, DEV values kept by `release`; `_open_session` and `get_login_remote_config` unchanged), `client/godot/core/auth_core/dev/auth_core_dev.gd` (`clear_dev_values`), `client/godot/core/network_core/network_core.gd` and `client/godot/core/data_core/data_core.gd` (`release` before `init`), `client/godot/core/bootstrap_core/bootstrap_core.gd` (`shutdown` now calls `release` of modules that are not initialized; `RemoteConfigCore.release` before `init` returns without a log or other module call, and RemoteConfigCore has no value set before `init`, as `skills/core/SKILL.md:73` requires) and `client/godot/core/unit_test_core/dev/unit_test_core.gd` (removal of `_clear_pre_init_values`). No change there alters a result RemoteConfigCore observes
- `ogw core test godot RemoteConfigCore` passed in this worktree (native run). The browser run (`--web`) was not run, since no RemoteConfigCore code or web-specific code it uses changed in the range
- Server core `remote-config` changes of the range (`records/review/remote-config-1.md` only) are outside this target
