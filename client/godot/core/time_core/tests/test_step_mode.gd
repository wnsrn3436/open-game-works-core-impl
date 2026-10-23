extends "res://core/time_core/tests/support/time_test_case.gd"
## DEV step mode.


func test_step_mode_moves_the_game_time_by_the_budget_only() -> void:
	init_modules()
	TimeCoreDev.set_step_mode(true)
	assert_true(TimeCoreDev.is_step_mode())
	assert_eq(TimeCoreDev.get_step_budget(), 0)
	advance(16)
	assert_eq(TimeCore.get_game_time(), 0, "budget 0 keeps the game time")
	assert_eq(TimeCore.get_real_time(), 16, "the real elapsed time moves")
	TimeCoreDev.add_step_budget(100)
	assert_eq(TimeCoreDev.get_step_budget(), 100)
	for i: int in 7:
		advance(16)
	assert_eq(TimeCore.get_game_time(), 100)
	assert_eq(TimeCoreDev.get_step_budget(), 0)


func test_step_budget_added_while_paused_waits_for_the_pause_to_end() -> void:
	init_modules()
	TimeCoreDev.set_step_mode(true)
	TimeCore.set_paused(true)
	TimeCoreDev.add_step_budget(100)
	var game: int = TimeCore.get_game_time()
	for i: int in 7:
		advance(16)
	assert_eq(TimeCore.get_game_time(), game, "the pause keeps the game time")
	assert_eq(TimeCoreDev.get_step_budget(), 100, "the pause does not use the budget")
	TimeCore.set_paused(false)
	for i: int in 7:
		advance(16)
	assert_eq(TimeCore.get_game_time(), game + 100)
	assert_eq(TimeCoreDev.get_step_budget(), 0)


func test_step_budget_outside_step_mode_is_an_error_and_step_mode_off_restores_the_game_time() -> void:
	init_modules()
	TimeCoreDev.add_step_budget(100)
	assert_eq(UnitTestCore.check_logs(ERROR, TAG), 1)
	assert_eq(TimeCoreDev.get_step_budget(), 0)
	TimeCoreDev.set_step_mode(true)
	TimeCoreDev.add_step_budget(0)
	assert_eq(UnitTestCore.check_logs(ERROR, TAG), 1, "ms below 1")
	TimeCoreDev.add_step_budget(50)
	TimeCoreDev.set_step_mode(false)
	assert_false(TimeCoreDev.is_step_mode())
	assert_eq(TimeCoreDev.get_step_budget(), 0)
	var game: int = TimeCore.get_game_time()
	advance(16)
	assert_eq(TimeCore.get_game_time(), game + 16)
	advance(16)
	assert_eq(TimeCore.get_game_time(), game + 32)


func test_step_mode_applies_after_time_scale_and_pause_and_does_not_carry_the_cut() -> void:
	init_modules()
	TimeCore.set_time_scale(2000)
	TimeCoreDev.set_step_mode(true)
	TimeCoreDev.add_step_budget(30)
	advance(10)
	assert_eq(TimeCore.get_game_time(), 20)
	advance(10)
	assert_eq(TimeCore.get_game_time(), 30)
	TimeCoreDev.add_step_budget(5)
	advance(1)
	assert_eq(TimeCore.get_game_time(), 32, "the cut increment is not carried")
	TimeCore.set_paused(true)
	advance(10)
	assert_eq(TimeCore.get_game_time(), 32)
	assert_eq(TimeCoreDev.get_step_budget(), 3, "pause does not use the budget")
	TimeCore.set_paused(false)


func test_step_mode_keeps_server_and_real_time() -> void:
	init_modules()
	sync_to(SERVER_TIME)
	TimeCoreDev.set_step_mode(true)
	advance(500)
	assert_eq(TimeCore.get_server_time(), SERVER_TIME + 500)
	assert_eq(TimeCore.get_real_time(), 500)


func test_negative_test_frame_is_an_error_and_does_nothing() -> void:
	init_modules()
	TimeCoreDev.step_test_frame(-1, false, false)
	TimeCoreDev.step_test_frame(-1, true, false)
	assert_eq(UnitTestCore.check_logs(ERROR, TAG), 2)
	assert_eq(TimeCore.get_real_time(), 0)
	assert_eq(TimeCore.get_resume_count(), 0)


func test_step_mode_stops_the_engine_features_while_the_budget_is_0() -> void:
	init_modules()
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	var feature: Node = Node.new()
	feature.process_mode = Node.PROCESS_MODE_PAUSABLE
	add_child_autofree(feature)
	TimeCoreDev.set_step_mode(true)
	assert_true(tree.paused, "step mode with budget 0 stops the engine features")
	assert_false(feature.can_process())
	assert_false(TimeCore.is_paused(), "is_paused is the set_paused value only")
	TimeCoreDev.add_step_budget(100)
	assert_false(tree.paused, "a budget runs the engine features")
	assert_true(feature.can_process())
	for i: int in 7:
		advance(16)
	assert_eq(TimeCoreDev.get_step_budget(), 0)
	assert_false(tree.paused, "the frame in which the budget reaches 0 runs to its end")
	await UnitTestCore.wait_frames(1)
	assert_true(tree.paused, "stopped in the frame after the budget reached 0")
	assert_false(feature.can_process())
	assert_false(TimeCore.is_paused())
	TimeCore.set_paused(true)
	TimeCore.set_paused(false)
	assert_true(tree.paused, "set_paused(false) with budget 0 keeps the engine features stopped")
	assert_false(feature.can_process())
	assert_false(TimeCore.is_paused())
	TimeCoreDev.add_step_budget(100)
	TimeCore.set_paused(true)
	assert_true(tree.paused, "set_paused(true) stops the engine features with budget left")
	assert_true(TimeCore.is_paused())
	TimeCore.set_paused(false)
	assert_false(tree.paused)
	TimeCore.set_paused(true)
	TimeCoreDev.set_step_mode(false)
	assert_true(tree.paused, "step mode off follows set_paused(true)")
	TimeCore.set_paused(false)
	assert_false(tree.paused, "step mode off follows set_paused(false)")


func test_a_budget_added_in_the_frame_it_reached_0_keeps_the_engine_features_running() -> void:
	init_modules()
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	TimeCoreDev.set_step_mode(true)
	TimeCoreDev.add_step_budget(16)
	advance(16)
	assert_eq(TimeCoreDev.get_step_budget(), 0)
	TimeCoreDev.add_step_budget(16)
	await UnitTestCore.wait_frames(1)
	assert_false(tree.paused)


func test_release_in_step_mode_runs_the_engine_features_and_a_late_stop_does_nothing() -> void:
	init_modules()
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	TimeCoreDev.set_step_mode(true)
	TimeCoreDev.add_step_budget(16)
	advance(16)
	TimeCore.release()
	assert_false(tree.paused)
	assert_true(TimeCore.init())
	# Other code stops the engine features in the new session; the stop deferred from the released session would
	# write `false` over it.
	tree.paused = true
	await UnitTestCore.wait_frames(1)
	assert_true(tree.paused, "the stop deferred from the released session does nothing")
	tree.paused = false
