# update core: TweenCore (client, Godot)

## done

- `TweenCore` (Godot) `client/godot/core/tween_core/`
  - `get_finite_playing_count` added (`tween_core.gd`). It counts the active slots whose record has a repeat count other than 0. A `play_value` record, a `play_preset` record waiting for loading and the record of a definition without steps (also after a definition check failure) all have repeat count 1, so they are counted. Before `init` and after `release` it leaves an error log and returns `0`. It creates no collection, `Callable` or `String`
  - The other new spec rows were already in the code, and this change adds their core tests: non-member `TimeBasis` of `play` and `play_preset` (invalid handle, checked before any slot or block is taken), the definition check item for a non-member `Easing` (`_check_failure`), a non-member `Easing` of `evaluate_easing` (`0`, error log), and a non-member `TweenValueKind` or first-change `Easing` of `play_value` (invalid handle, error log)
- core tests
  - `tests/test_count.gd` (new): a test for the `## test` item of `get_finite_playing_count`: repeat count 1, a `play_value` whose definition has repeat count 0, a loading `play_preset` and a failed check are counted, infinite repeat is not, and the count goes down by one when each counted tween ends. The count is read inside the completion callback for stop, for the definition check failure end and for `Completed` by progress. Also a no-allocation test (`OBJECT_COUNT` and `MEMORY_STATIC`, 100 warm-up calls and then 1000 calls, after `LogCore.release`)
  - `tests/support/tween_test_case.gd`: `failing_definitions` gets the item `easing not a member`. Both the definition check failure test (`test_progress.gd`) and the `check_definition` test (`test_definition.gd`) use it
  - `tests/test_progress.gd`: `TimeBasis` 99 and −1 for `play` and `play_preset` give the invalid handle with an error log each, no `tween` input block, no callback, no `TweenStartedEvent`, and no value change
  - `tests/test_definition.gd`: `evaluate_easing` with `Easing` 99 and −1 returns `0` with an error log
  - `tests/test_value.gd`: `play_value` with `TweenValueKind` 99, and with a first change whose `Easing` is 99, returns the invalid handle with an error log and does not call the receiver
  - `tests/test_lifecycle.gd`: `get_finite_playing_count` before `init` and after `release` returns `0` with an error log
- `core-spec/TweenCore.json`: written again by `ogw core test` from the spec. It adds the operation `get_finite_playing_count`. `ogw core test` also rewrote `core-spec/ScreenEffectCore.json` and `core-spec/UICore.json` from the 0.3.1 spec changes of those modules. They are not part of this change, so they are not committed
- The open spec debt D1 of TweenCore (non-member `TimeBasis` and `Easing`) is covered by the tests above
- Test runs: `ogw core test godot` and `ogw core test godot --web`, each on TweenCore and the 26 modules that `ogw core dependents TweenCore` lists: all pass. TweenCore has 62 tests (59 before this change). `ogw code check core`: type check, lint, dependency and secret all pass

## spec proposals

none

## review

none

## unverified

- QACore does not call `get_finite_playing_count` yet. Its `finite_tweens` value (`qa-core.md`) is QACore's work and not part of this input
