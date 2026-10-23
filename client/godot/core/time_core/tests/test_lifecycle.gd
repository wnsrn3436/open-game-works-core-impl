extends "res://core/time_core/tests/support/time_test_case.gd"
## `init`, `release`, the init check, operations outside `init` and the core node.


func test_init_check_and_release() -> void:
	assert_true(LogCore.init())
	assert_true(EventCore.init())
	assert_false(TimeCore.is_initialized())
	assert_true(TimeCore.init())
	assert_true(TimeCore.is_initialized())
	assert_false(TimeCore.init(), "init of an initialized module fails")
	assert_eq(UnitTestCore.check_logs(ERROR, TAG), 1)
	var node: Node = TimeCore._node
	assert_true(node.is_inside_tree())
	assert_eq(node.process_mode, Node.PROCESS_MODE_ALWAYS)
	_make_state()
	TimeCore.release()
	assert_false(TimeCore.is_initialized())
	_assert_initial_state()
	assert_false(is_instance_valid(node) and node.is_inside_tree(), "the core node is not in the tree")
	assert_true(TimeCore.init(), "init again after release")
	assert_eq(TimeCore.get_real_time(), 0)
	assert_false(TimeCore.is_synced())


func test_core_node_exit_tree_releases() -> void:
	init_modules()
	_make_state()
	var node: Node = TimeCore._node
	node.free()
	assert_false(TimeCore.is_initialized())
	_assert_initial_state()
	assert_true(TimeCore.init())
	assert_false(TimeCore.is_synced())


func test_release_without_init_logs_nothing() -> void:
	assert_true(LogCore.init())
	TimeCore.release()
	assert_false(TimeCore.is_initialized())


func test_set_test_clock_after_init_is_an_error_and_ignored() -> void:
	init_modules()
	var monotonic: int = TimeCore.get_monotonic_time()
	var clock: DevTestClock = DevTestClock.new()
	clock.monotonic_ms = monotonic + 99999
	TimeCoreDev.set_test_clock(clock)
	assert_eq(UnitTestCore.check_logs(ERROR, TAG), 1)
	assert_eq(TimeCore.get_monotonic_time(), monotonic)


## The test clock stays in TimeCore as the object `set_test_clock` got, read through static functions: a lambda of
## another script left in a static var at engine exit makes the engine abort.
func test_set_test_clock_keeps_the_clock_and_reads_it_without_a_lambda() -> void:
	var clock: DevTestClock = DevTestClock.new()
	clock.monotonic_ms = 4321
	clock.device_time_ms = 1700000000123
	TimeCoreDev.set_test_clock(clock)
	assert_same(TimeCore._test_clock, clock)
	assert_true(TimeCore._test_monotonic_ms.is_standard(), "the monotonic time reader is not a lambda")
	assert_true(TimeCore._test_device_time_ms.is_standard(), "the device time reader is not a lambda")
	init_modules()
	assert_eq(TimeCore.get_monotonic_time(), 4321)
	assert_eq(TimeCore.get_device_time(), 1700000000123)
	clock.monotonic_ms = 5000
	assert_eq(TimeCore.get_monotonic_time(), 5000, "reads the clock at each call")
	TimeCore.release()
	TimeCoreDev.set_test_clock(clock)
	TimeCoreDev.set_test_clock(null)
	assert_null(TimeCore._test_clock)
	assert_false(TimeCore._test_monotonic_ms.is_valid() or TimeCore._test_device_time_ms.is_valid())


func test_operations_before_init_and_after_release_fail() -> void:
	assert_true(LogCore.init())
	assert_true(EventCore.init())
	_assert_operations_fail()
	assert_true(TimeCore.init())
	TimeCore.release()
	_assert_operations_fail()


func _assert_operations_fail() -> void:
	TimeCore.sync_server_time(SERVER_TIME, 0, 0)
	assert_false(TimeCore.is_synced())
	assert_eq(TimeCore.get_server_time(), 0)
	assert_eq(TimeCore.get_device_time(), 0)
	assert_eq(TimeCore.get_monotonic_time(), 0)
	assert_false(TimeCore.is_reached(0))
	assert_false(TimeCore.is_before_end(SERVER_TIME))
	assert_eq(TimeCore.get_remaining_ms(SERVER_TIME), 0)
	assert_eq(TimeCore.get_day_start(SERVER_TIME), 0)
	assert_eq(TimeCore.get_next_day_boundary(SERVER_TIME), 0)
	assert_false(TimeCore.is_same_day(SERVER_TIME, SERVER_TIME))
	assert_eq(TimeCore.get_current_day(), 0)
	assert_eq(TimeCore.get_day_number(SERVER_TIME), 0)
	assert_eq(TimeCore.get_period_start(GameData.ResetCycle.DAILY, SERVER_TIME), 0)
	assert_eq(TimeCore.get_next_reset(GameData.ResetCycle.DAILY, SERVER_TIME), 0)
	assert_eq(TimeCore.get_game_time(), 0)
	assert_eq(TimeCore.get_game_frame_ms(), 0)
	assert_eq(TimeCore.get_real_time(), 0)
	assert_eq(TimeCore.get_real_frame_ms(), 0)
	TimeCore.set_time_scale(2000)
	assert_eq(TimeCore.get_time_scale(), 1000)
	TimeCore.set_paused(true)
	assert_false(TimeCore.is_paused())
	assert_eq(TimeCore.get_resume_count(), 0)
	assert_eq(TimeCore.get_last_background_ms(), 0)
	assert_eq(UnitTestCore.check_logs(ERROR, TAG), 25)
	TimeCoreDev.step_test_frame(10, false, false)
	TimeCoreDev.set_step_mode(true)
	assert_false(TimeCoreDev.is_step_mode())
	TimeCoreDev.add_step_budget(10)
	assert_eq(TimeCoreDev.get_step_budget(), 0)
	TimeCoreDev.set_test_clock_read_step(2)
	assert_eq(TimeCore._test_clock_read_step_ms, 0)
	assert_eq(UnitTestCore.check_logs(ERROR, TAG), 6)
	assert_false((Engine.get_main_loop() as SceneTree).paused)
	assert_eq(Engine.time_scale, 1.0)


## Moves every state of TimeCore away from its initial value.
func _make_state() -> void:
	sync_to(SERVER_TIME)
	advance(100)
	TimeCore.set_time_scale(1500)
	TimeCoreDev.set_step_mode(true)
	TimeCoreDev.add_step_budget(10)
	advance(3)
	UnitTestCore.advance_clock(1000, true)
	TimeCore.set_paused(true)
	TimeCoreDev.set_test_clock_read_step(1)


func _assert_initial_state() -> void:
	assert_null(TimeCore._session)
	assert_null(TimeCore._node)
	assert_eq(TimeCore._reach_margin_ms, 0)
	assert_eq(TimeCore._jump_threshold_ms, 0)
	assert_eq(TimeCore._offset_ms, 0)
	assert_false(TimeCore._synced)
	assert_eq(TimeCore._base_server_ms, 0)
	assert_eq(TimeCore._base_monotonic_ms, 0)
	assert_eq(TimeCore._recorded_day, 0)
	assert_eq(TimeCore._game_time_ms, 0)
	assert_eq(TimeCore._real_time_ms, 0)
	assert_eq(TimeCore._game_frame_ms, 0)
	assert_eq(TimeCore._real_frame_ms, 0)
	assert_eq(TimeCore._carry, 0)
	assert_eq(TimeCore._time_scale, 1000)
	assert_false(TimeCore._paused)
	assert_eq(TimeCore._last_frame_monotonic_ms, 0)
	assert_false(TimeCore._in_background)
	assert_eq(TimeCore._background_monotonic_ms, 0)
	assert_eq(TimeCore._background_device_ms, 0)
	assert_eq(TimeCore._resume_count, 0)
	assert_eq(TimeCore._last_background_ms, 0)
	assert_null(TimeCore._test_clock)
	assert_false(TimeCore._test_monotonic_ms.is_valid())
	assert_false(TimeCore._test_device_time_ms.is_valid())
	assert_eq(TimeCore._test_clock_read_step_ms, 0)
	assert_eq(TimeCore._pending_real_ms, 0)
	assert_eq(TimeCore._pending_game_ms, 0)
	assert_false(TimeCore._step_mode)
	assert_eq(TimeCore._step_budget_ms, 0)
	assert_eq(Engine.time_scale, 1.0)
	assert_false((Engine.get_main_loop() as SceneTree).paused)
