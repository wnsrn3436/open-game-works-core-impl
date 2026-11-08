## done

- TimeCore (Godot), following harness commit dd86197 (frame step fps is a launch value that BootstrapCore passes):
  - `client/godot/core/time_core/dev/time_core_dev.gd`: `set_test_frame_step` renamed to `set_frame_step`. It still works only before `init`. A call after `init` leaves an `error` log and is ignored, and so does a call with fps < 1. The log messages now name `set_frame_step`.
  - `client/godot/core/time_core/time_core.gd`: removed the engine fps read: `_engine_frame_step_fps`, the `_FIXED_FPS_ARG` and `_MOVIE_FPS_SETTING` constants, and the `OS.get_cmdline_args()`, `Engine.get_write_movie_path()` and `editor/movie_writer/fps` reads in `init`. `init` now sets the frame step only from the `set_frame_step` value. The stored value `_test_frame_step_fps` is renamed to `_set_frame_step_fps`, and `release` still clears it. Nothing else in TimeCore changed.
- Callers updated:
  - `client/godot/core/time_core/tests/test_frame_step.gd`: calls renamed. The misuse test is renamed to `test_set_frame_step_below_1_or_after_init_is_an_error_and_ignored`. The engine fps test `test_the_engine_fps_comes_from_fixed_fps_and_else_from_movie_maker` is removed.
  - `client/godot/core/time_core/tests/test_lifecycle.gd`: renamed call in `_set_before_init`, and renamed field in the release check.
  - `client/godot/core/qa_core/tests/test_memory_stats.gd`: renamed calls in the two `frame_step_fps` tests.
  - No other caller in core: BootstrapCore does not call it yet (that is the BootstrapCore job), and the benchmark has no caller.
- Tests (all on commit 279c6798):
  - `ogw core test godot TimeCore` and `--web`: pass.
  - `ogw core test godot <every module of ogw core dependents TimeCore>`: native and `--web` both pass, with these exceptions, which then passed when rerun alone:
    - Native UnitTestCore failed once in the full run: `test_run.gd::test_run_sends_started_once_with_its_run_id_before_the_result_of_its_first_test`. The nested run hit its 600 ms run time limit before its first test.
    - Web RealtimeCore failed once in the full run: `test_p2p.gd::test_a_member_whose_room_returned_to_matching_in_one_poll_takes_the_match_found_and_fails_at_the_connect_time_limit`.
- `ogw code check core`: type check, lint, dependency and secret all pass.
- No engine-specific implementation rules document was written, and `## <engine> build` of `tools/ogw.md` was not written.

## spec proposals

none

## review

none

## unverified

- The cause of the two one-time failures in the full dependents run was not reproduced. Each passed when its module was rerun alone. I did not change their tests or time limits.
  - UnitTestCore: a nested run with a 600 ms run time limit that ran out before its first test. The native and web full runs were running at the same time, so this looks like host load, but that is not checked.
  - RealtimeCore web: a connect time limit test.
  - Neither test calls `set_frame_step`. The removed engine read only changed runs started with `--fixed-fps` or Movie Maker, and core tests start with neither.
- No real dev run with `OGW_FRAME_STEP_FPS` was done: BootstrapCore does not pass it to `set_frame_step` yet (the BootstrapCore job).
