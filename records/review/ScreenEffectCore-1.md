# review ScreenEffectCore round 1

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

- The range de482eec..eee0a6db changes ScreenEffectCore only by adding World skip: `client/godot/core/screen_effect_core/screen_effect_core.gd` (`_world_skip`, `_is_skipped`, `_skipped_handle`, the skip branches of `fade`, `flash` and `play_preset`, the reset in `_reset_state`), `client/godot/core/screen_effect_core/dev/screen_effect_core_dev.gd` (`set_world_skip`), `client/godot/core/screen_effect_core/tests/test_world_skip.gd` and `client/godot/core/screen_effect_core/tests/test_lifecycle.gd`. These were checked against `## DEV` and `## test` of the spec. The skip is decided after the full input check, so the error rows stay as they are. The skipped handle is never put in `_current`, so `skip_to_end`, `clear_handle`, `clear_owner` and the frame check do not touch the overlay or the playing `World` handle. `release` and app exit reset the flag through `_clean_up` → `_reset_state`. The flag is a `_` static var of the module class that `ScreenEffectCoreDev` writes, as `client-core/engines/godot.md` `## DEV code` requires. The other modules this range changes are outside this target. The one caller of `set_world_skip`, `client/godot/core/qa_core/dev/qa_core.gd:1271`, calls it only while ScreenEffectCore is initialized, and it was not reviewed further
- I did not restore defects in a temporary copy, since round 1 has no `test evidence` finding to settle. Reading the tests: the second test of `test_world_skip.gd` would fail if a skipped request replaced the current `World` handle (the playing fade's recorded result count would change), and `test_release_turns_the_skip_off` would fail if `_reset_state` did not reset `_world_skip`
- `ogw core test godot ScreenEffectCore` reported `pass`. I did not confirm which checkout it ran against (this worktree or the `paths.coreImpl` checkout). The tests of the modules that depend on ScreenEffectCore were not run
- Code outside the range (the playback, cleanup and input-check paths from before de482eec) was read only where the World skip calls it or is called from it
