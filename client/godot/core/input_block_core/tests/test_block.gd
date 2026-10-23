extends "res://core/input_block_core/tests/support/input_block_case.gd"
## Blocks and tokens, `release_all`, lifecycle, errors and the DEV operations.

const THIS_FILE: String = "res://core/input_block_core/tests/test_block.gd"
const RunOperation := preload("res://core/input_block_core/tests/support/run_operation.gd")


func test_blocked_state_follows_active_blocks() -> void:
	init_modules()
	assert_false(InputBlockCore.is_blocked())
	var first: int = InputBlockCore.block("content")
	var second: int = InputBlockCore.block("ui")
	assert_true(InputBlockCore.is_blocked())
	assert_true(InputBlockCore.unblock(first))
	assert_true(InputBlockCore.is_blocked())
	assert_true(InputBlockCore.unblock(second))
	assert_false(InputBlockCore.is_blocked())


func test_unblock_of_bad_tokens_fails_and_keeps_other_blocks() -> void:
	init_modules()
	var kept: int = InputBlockCore.block("ui")
	var released: int = InputBlockCore.block("content")
	assert_true(InputBlockCore.unblock(released))
	# released token
	assert_false(InputBlockCore.unblock(released))
	assert_eq(UnitTestCore.check_logs("error", TAG), 1)
	# the slot of the released block is used again by a new block: the old token is still bad
	var reused: int = InputBlockCore.block("content")
	assert_ne(reused, released)
	assert_false(InputBlockCore.is_active(released))
	assert_false(InputBlockCore.unblock(released))
	assert_eq(UnitTestCore.check_logs("error", TAG), 1)
	# invalid token
	assert_false(InputBlockCore.unblock(0))
	assert_false(InputBlockCore.unblock(-1))
	assert_eq(UnitTestCore.check_logs("error", TAG), 2)
	assert_true(InputBlockCore.is_active(kept))
	assert_true(InputBlockCore.is_active(reused))
	assert_eq(InputBlockCoreDev.count_active(), 2)


func test_unblock_of_bad_token_logs_without_dev_code() -> void:
	init_modules()
	var token: int = InputBlockCore.block("content")
	assert_true(InputBlockCore.unblock(token))
	var had_dev_code: bool = CoreBuildInfo.has_dev_code
	CoreBuildInfo.has_dev_code = false
	var ok: bool = InputBlockCore.unblock(token)
	CoreBuildInfo.has_dev_code = had_dev_code
	assert_false(ok)
	assert_eq(UnitTestCore.check_logs("error", TAG), 1)


func test_is_active_of_bad_token_is_false_without_log() -> void:
	init_modules()
	var token: int = InputBlockCore.block("content")
	assert_true(InputBlockCore.is_active(token))
	assert_true(InputBlockCore.unblock(token))
	assert_false(InputBlockCore.is_active(token))
	assert_false(InputBlockCore.is_active(0))
	assert_false(InputBlockCore.is_active(123456789))


func test_release_all_keeps_the_given_tag_and_warns_per_block() -> void:
	init_modules()
	var scene: int = InputBlockCore.block("scene")
	var ui: int = InputBlockCore.block("ui")
	var content: int = InputBlockCore.block("content")
	assert_eq(InputBlockCore.release_all("scene"), 2)
	assert_eq(UnitTestCore.check_logs("warn", TAG), 2)
	assert_true(InputBlockCore.is_active(scene))
	assert_false(InputBlockCore.is_active(ui))
	assert_false(InputBlockCore.is_active(content))
	assert_eq(InputBlockCore.release_all(), 1)
	assert_eq(UnitTestCore.check_logs("warn", TAG), 1)
	assert_false(InputBlockCore.is_blocked())
	assert_eq(InputBlockCore.release_all(), 0)
	assert_eq(UnitTestCore.check_logs("warn", TAG), 0)


func test_release_clears_blocks_and_holds_without_log() -> void:
	init_modules()
	var pass_list: BlockPassList = BlockPassList.new()
	InputBlockCore.block("content", pass_list)
	InputBlockCore.block("scene")
	InputBlockCore.set_timer_hold("ui", true)
	InputBlockCore.release()
	assert_eq(UnitTestCore.check_logs("warn", TAG), 0)
	assert_true(InputBlockCore.init())
	assert_false(InputBlockCore.is_blocked())
	assert_eq(InputBlockCoreDev.count_active(), 0)
	# the hold is off after release: a new block reaches the max duration
	var token: int = InputBlockCore.block("content")
	await advance(MAX_MS)
	assert_false(InputBlockCore.is_active(token))
	assert_eq(UnitTestCore.check_logs("error", TAG), 1)


func test_release_ends_waiting_run_blocked_with_false() -> void:
	init_modules()
	var operation: RunOperation = RunOperation.new()
	add_child_autofree(operation)
	var run: Array[int] = [-1]
	_run(operation, run)
	assert_true(InputBlockCore.is_blocked())
	InputBlockCore.release()
	assert_eq(run[0], 0)
	operation.finish(true)
	assert_eq(run[0], 0)


func test_list_active_fills_every_active_block() -> void:
	init_modules()
	InputBlockCore.block("content")
	await advance(300)
	InputBlockCore.block("scene")
	var released: int = InputBlockCore.block("ui")
	assert_true(InputBlockCore.unblock(released))
	await advance(200)
	var count: int = InputBlockCoreDev.count_active()
	assert_eq(count, 2)
	var buffer: Array[ActiveBlockInfo] = []
	buffer.resize(count)
	assert_eq(InputBlockCoreDev.list_active(buffer), 2)
	assert_eq(buffer.size(), 2)
	var reasons: PackedStringArray = PackedStringArray()
	for info: ActiveBlockInfo in buffer:
		reasons.append(info.reason)
		assert_true(info.caller_location.begins_with(THIS_FILE + ":"), info.caller_location)
		assert_eq(info.elapsed_ms, 500 if info.reason == "content" else 200)
	reasons.sort()
	assert_eq(reasons, PackedStringArray(["content", "scene"]))
	# a buffer filled with entries is reused in place
	var first: ActiveBlockInfo = buffer[0]
	assert_eq(InputBlockCoreDev.list_active(buffer), 2)
	assert_same(buffer[0], first)


func test_list_active_fills_up_to_the_buffer_size() -> void:
	init_modules()
	InputBlockCore.block("content")
	InputBlockCore.block("ui")
	var buffer: Array[ActiveBlockInfo] = [ActiveBlockInfo.new()]
	assert_eq(InputBlockCoreDev.list_active(buffer), 1)
	assert_eq(buffer.size(), 1)
	assert_eq(UnitTestCore.check_logs("error", TAG), 1)


func test_unknown_reason_tags_fail() -> void:
	init_modules()
	assert_eq(InputBlockCore.block("gameplay"), 0)
	assert_eq(UnitTestCore.check_logs("error", TAG), 1)
	var operation: RunOperation = RunOperation.new()
	add_child_autofree(operation)
	var ok: bool = await InputBlockCore.run_blocked("gameplay", operation.operation)
	assert_false(ok)
	assert_eq(operation.calls, 0)
	assert_eq(UnitTestCore.check_logs("error", TAG), 1)
	var kept: int = InputBlockCore.block("content")
	assert_eq(InputBlockCore.release_all("gameplay"), 0)
	assert_eq(UnitTestCore.check_logs("error", TAG), 1)
	assert_true(InputBlockCore.is_active(kept))
	# `step` is a reason tag of `set_timer_hold` only
	assert_eq(InputBlockCore.block("step"), 0)
	assert_eq(UnitTestCore.check_logs("error", TAG), 1)
	InputBlockCore.set_timer_hold("content", true)
	assert_eq(UnitTestCore.check_logs("error", TAG), 1)
	await advance(MAX_MS)
	assert_false(InputBlockCore.is_active(kept))
	assert_eq(UnitTestCore.check_logs("error", TAG), 1)


func test_lifecycle() -> void:
	assert_false(InputBlockCore.is_initialized())
	init_modules()
	assert_true(InputBlockCore.is_initialized())
	assert_false(InputBlockCore.init())
	assert_eq(UnitTestCore.check_logs("error", TAG), 1)
	var node: Node = InputBlockCore._node
	assert_true(node.is_inside_tree())
	assert_eq(node.process_mode, Node.PROCESS_MODE_ALWAYS)
	InputBlockCore.block("content", BlockPassList.new(), node)
	InputBlockCore.set_timer_hold("network", true)
	# a run_blocked call that is waiting, and one whose block was lifted
	var waiting: RunOperation = RunOperation.new()
	var lifted: RunOperation = RunOperation.new()
	add_child_autofree(waiting)
	add_child_autofree(lifted)
	var waiting_run: Array[int] = [-1]
	var lifted_run: Array[int] = [-1]
	_run(lifted, lifted_run)
	assert_eq(InputBlockCore.release_all(), 2)
	assert_eq(UnitTestCore.check_logs("warn", TAG), 2)
	InputBlockCore.block("content", BlockPassList.new(), node)
	_run(waiting, waiting_run)
	assert_eq(InputBlockCore._running_count, 2)
	InputBlockCore.release()
	assert_false(InputBlockCore.is_initialized())
	assert_false(node.is_inside_tree())
	assert_eq(waiting_run[0], 0)
	assert_eq(lifted_run[0], 0)
	_assert_initial_state()
	assert_true(InputBlockCore.init())
	assert_true(InputBlockCore.is_initialized())
	waiting.finish(true)
	lifted.finish(true)
	assert_eq(InputBlockCore._running_count, 0)
	assert_false(InputBlockCore.is_blocked())


func test_core_node_exit_tree_releases() -> void:
	init_modules()
	InputBlockCore.block("content")
	var node: Node = InputBlockCore._node
	node.free()
	assert_false(InputBlockCore.is_initialized())
	_assert_initial_state()
	assert_true(InputBlockCore.init())
	assert_false(InputBlockCore.is_blocked())


func test_operations_before_init_and_after_release_fail() -> void:
	assert_true(LogCore.init())
	assert_true(EventCore.init())
	assert_true(TimeCore.init())
	await _assert_operations_fail()
	assert_true(InputBlockCore.init())
	InputBlockCore.release()
	await _assert_operations_fail()


func _assert_operations_fail() -> void:
	var control: Control = Control.new()
	add_child_autofree(control)
	var buffer: Array[ActiveBlockInfo] = [ActiveBlockInfo.new()]
	assert_eq(InputBlockCore.block("content"), 0)
	assert_false(InputBlockCore.unblock(1 << 20))
	assert_false(InputBlockCore.is_blocked())
	assert_false(InputBlockCore.is_active(1 << 20))
	assert_true(InputBlockCore.pass_action(&"back"))
	assert_true(InputBlockCore.pass_position(Vector2(1, 1)))
	assert_true(InputBlockCore.pass_focus(control))
	assert_eq(InputBlockCore.release_all(), 0)
	InputBlockCore.set_timer_hold("ui", true)
	assert_false(InputBlockCore.restart_timer(1 << 20))
	assert_eq(InputBlockCoreDev.count_active(), 0)
	assert_eq(InputBlockCoreDev.list_active(buffer), 0)
	assert_eq(UnitTestCore.check_logs("error", TAG), 12)
	var operation: RunOperation = RunOperation.new()
	add_child_autofree(operation)
	var ok: bool = await InputBlockCore.run_blocked("content", operation.operation)
	assert_false(ok)
	assert_eq(operation.calls, 0)
	assert_eq(UnitTestCore.check_logs("error", TAG), 1)


func _assert_initial_state() -> void:
	assert_null(InputBlockCore._session)
	assert_null(InputBlockCore._node)
	assert_eq(InputBlockCore._max_duration_ms, 0)
	assert_eq(InputBlockCore._slot_count, 0)
	assert_eq(InputBlockCore._generation.size(), 0)
	assert_eq(InputBlockCore._active.size(), 0)
	assert_eq(InputBlockCore._reason.size(), 0)
	assert_eq(InputBlockCore._caller.size(), 0)
	assert_eq(InputBlockCore._start.size(), 0)
	assert_eq(InputBlockCore._owner_id.size(), 0)
	assert_eq(InputBlockCore._pass_list.size(), 0)
	assert_eq(InputBlockCore._free_slots.size(), 0)
	assert_eq(InputBlockCore._free_count, 0)
	assert_eq(InputBlockCore._active_count, 0)
	assert_eq(InputBlockCore._running.size(), 0)
	assert_eq(InputBlockCore._running_count, 0)
	assert_false(InputBlockCore._hold_ui)
	assert_false(InputBlockCore._hold_network)
	assert_false(InputBlockCore._hold_step)
	assert_eq(InputBlockCore._hold_started_at, 0)
	assert_eq(InputBlockCore._held_total_ms, 0)


func _run(operation: RunOperation, run: Array[int]) -> void:
	var ok: bool = await InputBlockCore.run_blocked("content", operation.operation)
	run[0] = 1 if ok else 0
