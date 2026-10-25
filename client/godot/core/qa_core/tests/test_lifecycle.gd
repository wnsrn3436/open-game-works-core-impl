extends "res://core/qa_core/tests/support/qa_test_case.gd"
## `init`, `release`, the init check, a second `init`, calls before `init` and the cleanup when the core node leaves
## the tree.


func test_init_and_release() -> void:
	assert_false(QACore.is_initialized(), "before init")
	assert_true(await start())
	assert_true(QACore.is_initialized())
	var node: Node = QACore._node
	assert_not_null(node)
	assert_true(node.is_inside_tree(), "the core node is in the tree")
	var debug_layer: CanvasLayer = UICore.get_layer(UICore.UILayer.DEBUG)
	assert_not_null(debug_layer.get_node_or_null("QACoreDebug"), "the debug screen is on the debug layer")
	assert_false(QACore._debug_open, "the debug screen starts closed")
	assert_false(QACore.init(), "a second init fails")
	assert_eq(errors(), 1, "a second init logs an error")
	QACore.release()
	assert_false(QACore.is_initialized(), "after release")
	assert_false(is_instance_valid(node) and node.is_inside_tree(), "the core node left the tree")
	assert_null(debug_layer.get_node_or_null("QACoreDebug"), "release destroys the debug screen")
	assert_initial_state()
	QACore._has_test_launch_values = true
	assert_true(QACore.init(), "init after release")
	assert_eq(JSONR.text(await state(), "boot_stage"), "None", "a new init works as the first one")
	QACore.release()
	QACore.release()
	assert_eq(errors(), 0, "release without init logs nothing")


func test_capture_jpg_quality_out_of_range_fails_init() -> void:
	assert_true(await start(false))
	# The engine takes the JPEG quality in whole percents, so the range is 10 to 1000, as the other settings' ranges.
	for quality: int in [9, 1001]:
		set_int("QACore.captureJpgQuality", quality)
		assert_false(QACore.init(), "quality %d fails init" % quality)
		assert_false(QACore.is_initialized())
		assert_eq(errors(), 1, "quality %d logs an error" % quality)
	for quality: int in [10, 1000]:
		set_int("QACore.captureJpgQuality", quality)
		QACore._has_test_launch_values = true
		assert_true(QACore.init(), "quality %d inits" % quality)
		QACore.release()
	assert_eq(errors(), 0)

func test_release_clears_every_static_var() -> void:
	assert_true(await start())
	assert_true(QACore.register_command("qa.echo", "Echo.", PackedStringArray(), _echo))
	assert_true(QACore.register_invariant("qa.never", _never))
	QACore.set_content_state(_content)
	QACore.mark(QACore.MarkKind.GOAL)
	await run_ok("set_stats_visible", PackedStringArray(["true"]))
	await run_ok("key_down", PackedStringArray(["A"]))
	await UnitTestCore.wait_frames(2)
	assert_eq(errors(), 1, "the invariant failure")
	var session: RefCounted = QACore._session
	QACore.release()
	assert_initial_state()
	assert_ne(QACore._session, session, "a new session")


func test_release_ends_waiting_and_running_commands() -> void:
	assert_true(await start())
	var running: Pending = start_command("key", PackedStringArray(["A", "1000"]))
	var waiting: Pending = start_command("get_state")
	await UnitTestCore.wait_frames(2)
	assert_false(running.done, "key waits for its ms")
	QACore.release()
	await UnitTestCore.wait_frames(1)
	assert_true(running.done and waiting.done, "release ends both")
	assert_false(running.result.ok)
	assert_false(waiting.result.ok)
	assert_eq(warns(), 2, "the two failures are warn logs")


func test_node_exit_without_release() -> void:
	assert_true(await start())
	var node: Node = QACore._node
	node.get_parent().remove_child(node)
	assert_false(QACore.is_initialized(), "the cleanup ran")
	assert_initial_state()
	await UnitTestCore.wait_frames(1)
	assert_false(is_instance_valid(node), "the core node is freed")
	assert_eq(errors(), 0)


func test_operations_before_init() -> void:
	assert_true(await start(false))
	var result: RunCommandResult = await QACore.run_command("get_state", PackedStringArray())
	assert_false(result.ok)
	assert_false(QACore.register_command("qa.echo", "", PackedStringArray(), _echo))
	assert_false(QACore.register_invariant("qa.never", _never))
	QACore.set_content_state(_content)
	QACore.mark(QACore.MarkKind.GOAL)
	assert_eq(errors(), 5, "each call before init logs an error")
	assert_eq(QACore.is_headless(), DisplayServer.get_name() == "headless", "is_headless works before init")


func test_no_launch_values_no_connection() -> void:
	assert_true(await start())
	assert_null(QACore._channel, "no port or token: no connection")
	assert_eq(errors(), 0)
	assert_eq(warns(), 0)
	QACore.release()
	QACore._test_launch_values = {"OGW_AUTOMATION_PORT": "1234", "OGW_AUTOMATION_TOKEN": ""}
	QACore._has_test_launch_values = true
	assert_true(QACore.init())
	assert_null(QACore._channel, "an empty token: no connection")
	assert_eq(errors(), 0, "and no log")


func assert_initial_state() -> void:
	assert_false(QACore._is_initialized)
	assert_null(QACore._node)
	assert_eq(QACore._command_timeout_ms, 0)
	assert_eq(QACore._channel_max_bytes, 0)
	assert_eq(QACore._stats_refresh_ms, 0)
	assert_eq(QACore._text_max_chars, 0)
	assert_eq(QACore._video_fps, 0)
	assert_eq(QACore._video_max_ms, 0)
	assert_eq(QACore._softlock_no_response_ms, 0)
	assert_eq(QACore._softlock_inputs, 0)
	assert_eq(QACore._step_max_ms, 0)
	assert_eq(QACore._time_scale_max_permille, 0)
	assert_eq(QACore._touch_index_count, 0)
	assert_eq(QACore._base_resolution, Vector2i.ZERO)
	assert_true(QACore._softlock_block_ms.is_empty())
	assert_true(QACore._queue.is_empty())
	assert_null(QACore._running)
	assert_null(QACore._video)
	assert_false(QACore._pump_scheduled)
	assert_true(QACore._pump_call.is_null())
	assert_true(QACore._frame_call.is_null())
	assert_false(QACore._frame_scheduled)
	assert_true(QACore._pending_inputs.is_empty())
	assert_true(QACore._pending_commands.is_empty())
	assert_eq(QACore._frame_input_count, 0)
	assert_true(QACore._frame_start_call.is_null())
	assert_eq(QACore._frame_start_count, 0)
	assert_eq(QACore._started_frame_count, 0)
	assert_false(QACore._lockstep_step_running)
	assert_true(QACore._content_names.is_empty())
	assert_true(QACore._content_descriptions.is_empty())
	assert_true(QACore._content_args.is_empty())
	assert_true(QACore._content_handlers.is_empty())
	assert_true(QACore._content_state.is_null())
	assert_true(QACore._content_handler_logged.is_empty())
	assert_false(QACore._content_state_logged)
	assert_true(QACore._invariant_names.is_empty())
	assert_true(QACore._invariant_callbacks.is_empty())
	assert_true(QACore._invariant_failures.is_empty())
	assert_true(QACore._telemetry.inputs.is_empty() and QACore._telemetry.marks.is_empty())
	assert_eq(QACore._telemetry.started_at, 0)
	assert_eq(QACore._last_state_time, 0)
	assert_eq(QACore._inputs_since_state, 0)
	assert_true(QACore._input.keys.is_empty() and QACore._input.touches.is_empty())
	assert_null(QACore._channel)
	assert_null(QACore._debug)
	assert_false(QACore._stats_visible)
	assert_false(QACore._debug_open)
	assert_eq(QACore._refreshed_real_ms, 0)
	assert_eq(QACore._last_result_line, "")
	assert_eq(QACore._last_scene_load_ms, 0)
	assert_eq(QACore._boot_ms, 0)
	assert_eq(QACore._capture_hides, 0)
	assert_true(QACore._test_launch_values.is_empty())
	assert_false(QACore._has_test_launch_values)


func _echo(_args: PackedStringArray) -> RunCommandResult:
	var result: RunCommandResult = RunCommandResult.new()
	result.ok = true
	return result


func _never() -> bool:
	return false


func _content() -> String:
	return "{}"
