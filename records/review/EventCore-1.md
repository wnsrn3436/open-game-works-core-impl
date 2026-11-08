# review EventCore round 1

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

- The commit range 85f6b36d..d79c51fd changes no file of `client/godot/core/event_core/` (`git log 85f6b36d..d79c51fd -- client/godot/core/event_core` is empty). The only change in the dependency `LogCore` (`client/godot/core/log_core/log_core.gd`) adds comments and does not change behavior. So no change of the range causes or reveals an EventCore problem; `client/godot/core/event_core/event_core.gd`, `event_type_state.gd` and `dev/event_core_dev.gd` were read against the spec and no `critical`, `high` or `medium` problem was found.
- The new callers of `EventCore.acquire` and `EventCore.publish` in the range (`client/godot/core/accessibility_core/accessibility_core.gd`, `client/godot/core/input_core/input_core.gd`, their tests) were read only for how they call EventCore; their own behavior belongs to the reviews of those modules.
- The tests of `client/godot/core/event_core/tests/` were not run, because the range changes no EventCore code or test.
- Whether `LogCore` drops the `debug` log of `publish` in the environments that exclude DEV code was not checked; `event_core.gd:204` logs it in every environment and relies on `LogCore` level filtering.
