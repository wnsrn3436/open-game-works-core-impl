# ScreenEffectCore review round 1

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

- The commit range changes ScreenEffectCore only in f614a4a0: removal of `ScreenEffectCoreDev.set_world_skip`, `_world_skip`, `_is_skipped`, `_skipped_handle`, their calls in `fade`, `flash` and `play_preset`, the reset in `_reset_state`, `tests/test_world_skip.gd`, and the `set_world_skip` call and its error in `tests/test_lifecycle.gd` (error count 13 to 12). The spec `## DEV` has only `get_overlay_state`, so the removal matches it. No reference to the removed names remains under `client/`, `server/`, `core-spec/` or `settings/`. `ogw core test godot ScreenEffectCore` passed (result reused by its key). Code of the module outside the changed places and their callers was not reviewed, as the commit range is not `none`
- The browser run (`--web`) was not run: the range changes no web-specific file of the module
