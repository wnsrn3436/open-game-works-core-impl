extends "res://core/time_core/tests/support/time_test_case.gd"
## DEV frame step: every engine frame is one fixed step of time.

const _PROBE := preload("res://core/time_core/tests/support/time_frame_step_probe.gd")


## Inits TimeCore again without the test clock, so engine frames do not read the test clock, at a frame step of `fps`
## when it is above 0.
func _init_without_test_clock(fps: int) -> void:
	init_modules()
	TimeCore.release()
	TimeCoreDev.set_test_clock(null)
	if fps > 0:
		TimeCoreDev.set_test_frame_step(fps)
	assert_true(TimeCore.init())


## A probe made right after `init`, so its first recorded frame is the first engine frame of TimeCore.
func _add_probe(frames: int) -> _PROBE:
	var probe: _PROBE = _PROBE.new()
	probe.frames = frames
	add_child_autofree(probe)
	return probe


func _wait_probe(probe: _PROBE) -> void:
	for i: int in probe.frames + 10:
		if probe.is_done():
			return
		await UnitTestCore.wait_frames(1)


func test_frames_at_a_frame_step_of_60_add_fixed_steps_whatever_a_frame_takes() -> void:
	_init_without_test_clock(60)
	var probe: _PROBE = _add_probe(60)
	probe.wait_frame = 10
	probe.wait_ms = 50
	var monotonic_start: int = TimeCore.get_monotonic_time()
	await _wait_probe(probe)
	assert_true(probe.is_done())
	assert_eq(TimeCoreDev.get_frame_step_fps(), 60)
	assert_eq(probe.real_time[0], 16, "the probe recorded from the first TimeCore frame")
	var first_increments: PackedInt64Array = [16, 17, 17]
	for i: int in 3:
		assert_eq(probe.real_frame_ms[i], first_increments[i], "real increment of frame %d" % (i + 1))
		assert_eq(probe.game_frame_ms[i], probe.real_frame_ms[i], "game increment of frame %d" % (i + 1))
	assert_eq(probe.real_time[59], 1000, "60 frames add 1 s of real elapsed time")
	assert_eq(probe.game_time[59], 1000, "60 frames add 1 s of game time")
	assert_eq(probe.real_frame_ms[11], 17, "the frame after the 50 ms wait is one step")
	assert_gte(probe.monotonic_time[11] - probe.monotonic_time[10], 50, "the monotonic time follows the device clock")
	assert_gte(probe.monotonic_time[59] - monotonic_start, 50)


func test_the_frame_step_follows_the_time_scale_and_pause() -> void:
	_init_without_test_clock(60)
	TimeCore.set_time_scale(2000)
	var probe: _PROBE = _add_probe(3)
	await _wait_probe(probe)
	assert_eq(probe.game_time[2], 100)
	TimeCore.set_paused(true)
	var game: int = TimeCore.get_game_time()
	var real: int = TimeCore.get_real_time()
	await UnitTestCore.wait_frames(3)
	assert_eq(TimeCore.get_game_time(), game, "pause keeps the game time")
	assert_gt(TimeCore.get_real_time(), real)


func test_a_test_clock_keeps_the_frame_step_from_changing_the_time() -> void:
	TimeCoreDev.set_test_frame_step(60)
	init_modules()
	assert_eq(TimeCoreDev.get_frame_step_fps(), 60)
	await UnitTestCore.wait_frames(5)
	assert_eq(TimeCore.get_real_time(), 0)
	assert_eq(TimeCore.get_game_time(), 0)
	assert_eq(TimeCore.get_real_frame_ms(), 0)
	advance(10)
	assert_eq(TimeCore.get_real_time(), 10, "a test frame keeps its own increment")


func test_step_mode_at_a_frame_step_uses_the_budget_in_steps() -> void:
	_init_without_test_clock(60)
	TimeCoreDev.set_step_mode(true)
	await UnitTestCore.wait_frames(4)
	assert_eq(TimeCore.get_game_time(), 0, "budget 0 keeps the game time")
	assert_gt(TimeCore.get_real_time(), 0)
	# Resumed at a frame start, before the TimeCore frame code of that frame: three TimeCore frames run in the wait.
	TimeCoreDev.add_step_budget(50)
	await UnitTestCore.wait_frames(3)
	assert_eq(TimeCore.get_game_time(), 50)
	assert_eq(TimeCoreDev.get_step_budget(), 0)
	await UnitTestCore.wait_frames(2)
	assert_eq(TimeCore.get_game_time(), 50)


func test_without_a_frame_step_and_after_release_the_frame_increment_is_the_monotonic_difference() -> void:
	const WAIT_MS: int = 40
	_init_without_test_clock(60)
	assert_eq(TimeCoreDev.get_frame_step_fps(), 60)
	TimeCore.release()
	assert_true(TimeCore.init())
	assert_eq(TimeCoreDev.get_frame_step_fps(), 0, "release deletes the frame step")
	await UnitTestCore.wait_frames(1)
	OS.delay_msec(WAIT_MS)
	await UnitTestCore.wait_frames(1)
	assert_gte(TimeCore.get_real_frame_ms(), WAIT_MS)


func test_set_test_frame_step_below_1_or_after_init_is_an_error_and_ignored() -> void:
	assert_true(LogCore.init())
	assert_true(EventCore.init())
	TimeCoreDev.set_test_frame_step(0)
	TimeCoreDev.set_test_frame_step(-30)
	assert_eq(UnitTestCore.check_logs(ERROR, TAG), 2)
	assert_true(TimeCore.init())
	assert_eq(TimeCoreDev.get_frame_step_fps(), 0)
	TimeCoreDev.set_test_frame_step(60)
	assert_eq(UnitTestCore.check_logs(ERROR, TAG), 1)
	assert_eq(TimeCoreDev.get_frame_step_fps(), 0)
	assert_eq(TimeCore._test_frame_step_fps, 0)


func test_the_engine_fps_comes_from_fixed_fps_and_else_from_movie_maker() -> void:
	assert_eq(TimeCore._engine_frame_step_fps(PackedStringArray(["--fixed-fps", "30"]), "", 60), 30)
	assert_eq(TimeCore._engine_frame_step_fps(PackedStringArray(["--fixed-fps", "30"]), "a.avi", 60), 30, "--fixed-fps first")
	assert_eq(TimeCore._engine_frame_step_fps(PackedStringArray(["--write-movie", "a.avi"]), "a.avi", 24), 24)
	assert_eq(TimeCore._engine_frame_step_fps(PackedStringArray(), "", 60), 0, "neither")
	assert_eq(TimeCore._engine_frame_step_fps(PackedStringArray(["--fixed-fps", "-1"]), "", 60), 0, "fps below 1")
	assert_eq(TimeCore._engine_frame_step_fps(PackedStringArray(["--fixed-fps"]), "", 60), 0, "no value")
	assert_eq(TimeCore._engine_frame_step_fps(PackedStringArray(["--fixed-fps", "x"]), "", 60), 0, "not an integer")
	assert_eq(TimeCore._engine_frame_step_fps(PackedStringArray(), "a.avi", "60"), 0, "a setting that is not an int")
