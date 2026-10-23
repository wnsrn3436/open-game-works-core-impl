extends "res://core/time_core/tests/support/time_test_case.gd"
## Game time, real elapsed time, time scale with carry, pause and the engine time scale and pause.

const _FRAME_PROBE := preload("res://core/time_core/tests/support/time_frame_probe.gd")
const _FRAME_START_PROBE := preload("res://core/time_core/tests/support/time_frame_start_probe.gd")


func test_time_scale_2000_doubles_the_game_time_and_frame_increment() -> void:
	init_modules()
	TimeCore.set_time_scale(2000)
	assert_eq(TimeCore.get_time_scale(), 2000)
	advance(1000)
	assert_eq(TimeCore.get_real_time(), 1000)
	assert_eq(TimeCore.get_game_time(), 2000)
	assert_eq(TimeCore.get_real_frame_ms(), 1000)
	assert_eq(TimeCore.get_game_frame_ms(), 2000)


func test_time_scale_333_carries_the_remainder() -> void:
	init_modules()
	TimeCore.set_time_scale(333)
	for i: int in 3:
		advance(1)
		assert_eq(TimeCore.get_game_time(), 0, "frame %d" % (i + 1))
	advance(1)
	assert_eq(TimeCore.get_game_time(), 1)
	assert_eq(TimeCore.get_real_time(), 4)


func test_pause_stops_the_game_time_only() -> void:
	init_modules()
	sync_to(SERVER_TIME)
	advance(100)
	var game: int = TimeCore.get_game_time()
	var real: int = TimeCore.get_real_time()
	TimeCore.set_paused(true)
	assert_true(TimeCore.is_paused())
	advance(1000)
	assert_eq(TimeCore.get_server_time(), SERVER_TIME + 1100)
	assert_eq(TimeCore.get_real_time(), real + 1000)
	assert_eq(TimeCore.get_game_time(), game)
	assert_eq(TimeCore.get_game_frame_ms(), 0)
	TimeCore.set_paused(false)
	assert_false(TimeCore.is_paused())
	advance(10)
	assert_eq(TimeCore.get_game_time(), game + 10)


func test_engine_time_scale_and_pause_follow_and_release_restores_them() -> void:
	init_modules()
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	TimeCore.set_time_scale(500)
	assert_eq(Engine.time_scale, 0.5)
	TimeCore.set_paused(true)
	assert_true(tree.paused)
	TimeCore.set_paused(false)
	assert_false(tree.paused)
	TimeCore.set_paused(true)
	TimeCore.release()
	assert_eq(Engine.time_scale, 1.0)
	assert_false(tree.paused)


func test_a_test_frame_reports_its_own_increment() -> void:
	init_modules()
	TimeCore.set_time_scale(2000)
	advance(10)
	advance(20)
	assert_eq(TimeCore.get_real_frame_ms(), 20)
	assert_eq(TimeCore.get_game_frame_ms(), 40)


func test_engine_frame_increment_is_the_sum_of_the_test_frames_after_the_last_engine_frame() -> void:
	init_modules()
	await UnitTestCore.wait_frames(1)
	advance(10)
	advance(20)
	await UnitTestCore.wait_frames(1)
	assert_eq(TimeCore.get_real_frame_ms(), 30)
	assert_eq(TimeCore.get_game_frame_ms(), 30)
	await UnitTestCore.wait_frames(3)
	assert_eq(TimeCore.get_real_frame_ms(), 0, "no test frame after the last engine frame")
	assert_eq(TimeCore.get_real_time(), 30, "engine frames do not move the real elapsed time")
	assert_eq(TimeCore.get_game_time(), 30, "engine frames do not move the game time")


## Inits TimeCore again without the test clock, so engine frames read the device monotonic time.
func _init_without_test_clock() -> void:
	init_modules()
	TimeCore.release()
	TimeCoreDev.set_test_clock(null)
	assert_true(TimeCore.init())


## A test resumes from `wait_frames` before the TimeCore frame code of that frame, so after it the frame increments are
## those of the engine frame in which the test code before it ran.
func test_engine_frames_without_the_test_clock_follow_the_time_scale() -> void:
	_init_without_test_clock()
	TimeCore.set_time_scale(2000)
	await UnitTestCore.wait_frames(1)
	for i: int in 3:
		OS.delay_msec(20)
		await UnitTestCore.wait_frames(1)
		assert_gte(TimeCore.get_real_frame_ms(), 20, "frame %d: the real increment holds the delay" % i)
		assert_eq(TimeCore.get_game_frame_ms(), TimeCore.get_real_frame_ms() * 2, "frame %d" % i)
	assert_gte(TimeCore.get_real_time(), 60)
	assert_eq(TimeCore.get_game_time(), TimeCore.get_real_time() * 2)


## TimeCore increments the frame before the other process callbacks, so a process callback reads the increment of its
## own frame: the frame after the wait holds the wait and not a second frame. The bound starts in the frame start
## signal of the frame of the wait, before TimeCore reads the device monotonic time for that frame.
func test_a_process_callback_reads_the_increment_of_its_own_frame() -> void:
	const WAIT_MS: int = 20
	_init_without_test_clock()
	TimeCore.set_time_scale(2000)
	await UnitTestCore.wait_frames(1)
	var probe: _FRAME_PROBE = _FRAME_PROBE.new()
	probe.wait_ms = WAIT_MS
	add_child_autofree(probe)
	for i: int in 10:
		if probe.real_frame_ms >= 0:
			break
		await UnitTestCore.wait_frames(1)
	assert_gte(probe.real_frame_ms, WAIT_MS)
	assert_lte(probe.real_frame_ms, probe.read_frame_monotonic_ms - probe.wait_frame_monotonic_ms,
			"the real increment is at most the device monotonic time from the frame start signal of F to the process callback of F+1")
	assert_eq(probe.game_frame_ms, probe.real_frame_ms * 2)


## The frame start signal runs before the process callbacks of its frame and TimeCore increments before the other
## process callbacks, so a process callback reads a frame increment that holds the wait in the signal of its own frame.
func test_a_process_callback_reads_a_wait_in_the_frame_start_signal_of_its_own_frame() -> void:
	const WAIT_MS: int = 20
	_init_without_test_clock()
	await UnitTestCore.wait_frames(1)
	var probe: _FRAME_START_PROBE = _FRAME_START_PROBE.new()
	probe.wait_ms = WAIT_MS
	add_child_autofree(probe)
	for i: int in 10:
		if probe.read_frame >= 0:
			break
		await UnitTestCore.wait_frames(1)
	assert_gte(probe.wait_frame, 0, "the frame start signal came")
	assert_eq(probe.read_frame, probe.wait_frame, "the process callback read in the frame of the wait")
	assert_gte(probe.real_frame_ms, WAIT_MS)
	assert_gte(probe.real_time - probe.real_time_at_signal, WAIT_MS, "TimeCore incremented after the signal and before the process callback")


func test_engine_background_time_stays_out_of_the_next_engine_frame() -> void:
	const BACKGROUND_MS: int = 300
	_init_without_test_clock()
	await UnitTestCore.wait_frames(1)
	var real: int = TimeCore.get_real_time()
	var game: int = TimeCore.get_game_time()
	var node: Node = TimeCore._node
	node.propagate_notification(Node.NOTIFICATION_APPLICATION_PAUSED)
	OS.delay_msec(BACKGROUND_MS)
	node.propagate_notification(Node.NOTIFICATION_APPLICATION_RESUMED)
	assert_gte(TimeCore.get_last_background_ms(), BACKGROUND_MS)
	await UnitTestCore.wait_frames(1)
	assert_lt(TimeCore.get_real_frame_ms(), BACKGROUND_MS, "the frame after the return does not hold the background")
	assert_lt(TimeCore.get_game_frame_ms(), BACKGROUND_MS)
	await UnitTestCore.wait_frames(1)
	assert_lt(TimeCore.get_real_time() - real, BACKGROUND_MS)
	assert_lt(TimeCore.get_game_time() - game, BACKGROUND_MS)
