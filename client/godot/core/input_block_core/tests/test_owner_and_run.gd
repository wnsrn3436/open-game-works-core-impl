extends "res://core/input_block_core/tests/support/input_block_case.gd"
## Owner objects and `run_blocked`.

const RunOperation := preload("res://core/input_block_core/tests/support/run_operation.gd")
const RefCountedOperation := preload("res://core/input_block_core/tests/support/ref_counted_operation.gd")
const PENDING: int = -1


func test_owner_destruction_releases_only_its_block_without_log() -> void:
	init_modules()
	var destroyed_owner: Node = Node.new()
	var kept_owner: Node = Node.new()
	add_child_autofree(kept_owner)
	var destroyed: int = InputBlockCore.block("content", null, destroyed_owner)
	var kept: int = InputBlockCore.block("content", null, kept_owner)
	var no_owner: int = InputBlockCore.block("content")
	destroyed_owner.free()
	await next_frame()
	assert_false(InputBlockCore.is_active(destroyed))
	assert_true(InputBlockCore.is_active(kept))
	assert_true(InputBlockCore.is_active(no_owner))
	assert_eq(UnitTestCore.check_logs("warn", TAG), 0)


func test_block_with_destroyed_owner_fails() -> void:
	init_modules()
	var owner: Node = Node.new()
	owner.free()
	assert_eq(InputBlockCore.block("content", null, owner), 0)
	assert_eq(UnitTestCore.check_logs("error", TAG), 1)
	var operation: RunOperation = RunOperation.new()
	add_child_autofree(operation)
	var ok: bool = await InputBlockCore.run_blocked("content", operation.operation, null, owner)
	assert_false(ok)
	assert_eq(operation.calls, 0)
	assert_eq(UnitTestCore.check_logs("error", TAG), 1)
	assert_false(InputBlockCore.is_blocked())


func test_run_blocked_holds_the_block_while_waiting_and_returns_success() -> void:
	init_modules()
	var operation: RunOperation = RunOperation.new()
	add_child_autofree(operation)
	var run: Array[int] = [PENDING]
	_run(operation.operation, null, run)
	assert_eq(operation.calls, 1)
	assert_true(InputBlockCore.is_blocked())
	await next_frame()
	assert_true(InputBlockCore.is_blocked())
	assert_eq(run[0], PENDING)
	operation.finish(true)
	assert_eq(run[0], 1)
	assert_false(InputBlockCore.is_blocked())


func test_run_blocked_returns_false_on_failure_and_cancel() -> void:
	init_modules()
	var operation: RunOperation = RunOperation.new()
	add_child_autofree(operation)
	var failed: Array[int] = [PENDING]
	_run(operation.operation, null, failed)
	assert_true(InputBlockCore.is_blocked())
	operation.finish(false)
	assert_eq(failed[0], 0)
	assert_false(InputBlockCore.is_blocked())
	var cancelled: Array[int] = [PENDING]
	_run(operation.operation, null, cancelled)
	assert_true(InputBlockCore.is_blocked())
	operation.cancel()
	assert_eq(cancelled[0], 0)
	assert_false(InputBlockCore.is_blocked())


func test_run_blocked_with_operation_that_does_not_wait() -> void:
	init_modules()
	var operation: RunOperation = RunOperation.new()
	add_child_autofree(operation)
	var ok: bool = await InputBlockCore.run_blocked("content", operation.immediate)
	assert_true(ok)
	assert_eq(operation.calls, 1)
	assert_false(InputBlockCore.is_blocked())


func test_run_blocked_with_operation_of_a_ref_counted_object_holds_the_block() -> void:
	init_modules()
	var operation: RefCountedOperation = RefCountedOperation.new()
	var run: Array[int] = [PENDING]
	_run_with_owner(operation.operation, null, run)
	assert_eq(operation.calls, 1)
	await next_frame()
	assert_true(InputBlockCore.is_blocked())
	operation.finish(true)
	assert_eq(run[0], 1)
	assert_false(InputBlockCore.is_blocked())
	var owned: Array[int] = [PENDING]
	_run_with_owner(operation.operation, RefCounted.new(), owned)
	assert_eq(operation.calls, 2)
	operation.finish(true)
	assert_eq(owned[0], 1)
	var ok: bool = await InputBlockCore.run_blocked("content", RefCountedOperation.immediate)
	assert_true(ok)
	assert_false(InputBlockCore.is_blocked())
	assert_eq(UnitTestCore.check_logs("error", TAG), 0)


func test_block_with_a_ref_counted_owner_holds_the_block() -> void:
	init_modules()
	var owner: RefCounted = RefCounted.new()
	var token: int = InputBlockCore.block("content", null, owner)
	await next_frame()
	assert_true(InputBlockCore.is_active(token))
	assert_true(InputBlockCore.unblock(token))
	assert_eq(UnitTestCore.check_logs("error", TAG), 0)


func test_run_blocked_ends_when_owner_is_destroyed() -> void:
	init_modules()
	var operation: RunOperation = RunOperation.new()
	add_child_autofree(operation)
	var owner: Node = Node.new()
	var run: Array[int] = [PENDING]
	_run(operation.operation, owner, run)
	var other: int = InputBlockCore.block("content")
	owner.free()
	await next_frame()
	assert_eq(run[0], 0)
	assert_true(InputBlockCore.is_active(other))
	assert_eq(InputBlockCoreDev.count_active(), 1)
	# the result of the operation that ends later is not used
	operation.finish(true)
	assert_eq(run[0], 0)
	assert_true(InputBlockCore.is_active(other))
	assert_eq(UnitTestCore.check_logs("warn", TAG), 0)


func test_run_blocked_ends_when_object_of_operation_is_destroyed() -> void:
	init_modules()
	var operation: RunOperation = RunOperation.new()
	var run: Array[int] = [PENDING]
	_run(operation.operation, null, run)
	assert_true(InputBlockCore.is_blocked())
	operation.free()
	await next_frame()
	assert_eq(run[0], 0)
	assert_false(InputBlockCore.is_blocked())
	assert_eq(UnitTestCore.check_logs("warn", TAG), 0)


func test_run_blocked_after_forced_release_ends_without_log() -> void:
	init_modules()
	var operation: RunOperation = RunOperation.new()
	add_child_autofree(operation)
	var run: Array[int] = [PENDING]
	_run(operation.operation, null, run)
	await advance(MAX_MS)
	assert_false(InputBlockCore.is_blocked())
	assert_eq(UnitTestCore.check_logs("error", TAG), 1)
	# a new block takes the slot of the released one; ending the operation does not lift it
	var other: int = InputBlockCore.block("content")
	operation.finish(true)
	assert_eq(run[0], 1)
	assert_true(InputBlockCore.is_active(other))


func test_run_blocked_after_release_all_ends_without_log() -> void:
	init_modules()
	var operation: RunOperation = RunOperation.new()
	add_child_autofree(operation)
	var run: Array[int] = [PENDING]
	_run(operation.operation, null, run)
	assert_eq(InputBlockCore.release_all(), 1)
	assert_eq(UnitTestCore.check_logs("warn", TAG), 1)
	var other: int = InputBlockCore.block("content")
	operation.finish(false)
	assert_eq(run[0], 0)
	assert_true(InputBlockCore.is_active(other))
	assert_eq(UnitTestCore.check_logs("warn", TAG), 0)


func test_owner_destruction_after_release_all_ends_run_blocked_without_log() -> void:
	init_modules()
	var operation: RunOperation = RunOperation.new()
	add_child_autofree(operation)
	var owner: Node = Node.new()
	var run: Array[int] = [PENDING]
	_run(operation.operation, owner, run)
	assert_eq(InputBlockCore.release_all("scene"), 1)
	assert_eq(UnitTestCore.check_logs("warn", TAG), 1)
	var other: int = InputBlockCore.block("content")
	owner.free()
	await next_frame()
	assert_eq(run[0], 0)
	assert_eq(InputBlockCore._running_count, 0)
	assert_true(InputBlockCore.is_active(other))
	# the result of the operation that ends later is not used
	operation.finish(true)
	assert_eq(run[0], 0)
	assert_true(InputBlockCore.is_active(other))
	assert_eq(UnitTestCore.check_logs("warn", TAG), 0)
	assert_eq(UnitTestCore.check_logs("error", TAG), 0)


func test_owner_destructions_in_one_frame_end_each_run_blocked_and_keep_the_others_waiting() -> void:
	init_modules()
	var operation: RunOperation = RunOperation.new()
	add_child_autofree(operation)
	var kept_owner: Node = Node.new()
	add_child_autofree(kept_owner)
	var first_owner: Node = Node.new()
	var second_owner: Node = Node.new()
	var first_run: Array[int] = [PENDING]
	var kept_run: Array[int] = [PENDING]
	var second_run: Array[int] = [PENDING]
	_run(operation.operation, first_owner, first_run)
	_run(operation.operation, kept_owner, kept_run)
	_run(operation.operation, second_owner, second_run)
	assert_eq(InputBlockCore.release_all(), 3)
	assert_eq(UnitTestCore.check_logs("warn", TAG), 3)
	first_owner.free()
	second_owner.free()
	await next_frame()
	assert_eq(first_run[0], 0)
	assert_eq(second_run[0], 0)
	assert_eq(kept_run[0], PENDING)
	assert_eq(InputBlockCore._running_count, 1)
	operation.finish(true)
	assert_eq(kept_run[0], 1)
	assert_eq(first_run[0], 0)
	assert_eq(second_run[0], 0)
	assert_eq(InputBlockCore._running_count, 0)
	assert_eq(UnitTestCore.check_logs("error", TAG), 0)


func test_destruction_of_object_of_operation_after_release_all_ends_run_blocked_without_log() -> void:
	init_modules()
	var operation: RunOperation = RunOperation.new()
	var run: Array[int] = [PENDING]
	_run(operation.operation, null, run)
	assert_eq(InputBlockCore.release_all(), 1)
	assert_eq(UnitTestCore.check_logs("warn", TAG), 1)
	operation.free()
	await next_frame()
	assert_eq(run[0], 0)
	assert_eq(InputBlockCore._running_count, 0)
	assert_eq(UnitTestCore.check_logs("warn", TAG), 0)
	assert_eq(UnitTestCore.check_logs("error", TAG), 0)


func test_owner_destruction_after_forced_release_ends_run_blocked_without_log() -> void:
	init_modules()
	var operation: RunOperation = RunOperation.new()
	add_child_autofree(operation)
	var owner: Node = Node.new()
	var run: Array[int] = [PENDING]
	_run(operation.operation, owner, run)
	await advance(MAX_MS)
	assert_false(InputBlockCore.is_blocked())
	assert_eq(UnitTestCore.check_logs("error", TAG), 1)
	assert_eq(run[0], PENDING)
	owner.free()
	await next_frame()
	assert_eq(run[0], 0)
	assert_eq(InputBlockCore._running_count, 0)
	# the result of the operation that ends later is not used
	var other: int = InputBlockCore.block("content")
	operation.finish(true)
	assert_eq(run[0], 0)
	assert_true(InputBlockCore.is_active(other))
	assert_eq(UnitTestCore.check_logs("warn", TAG), 0)
	assert_eq(UnitTestCore.check_logs("error", TAG), 0)


func test_release_after_release_all_ends_run_blocked_with_false() -> void:
	init_modules()
	var operation: RunOperation = RunOperation.new()
	add_child_autofree(operation)
	var run: Array[int] = [PENDING]
	_run(operation.operation, null, run)
	assert_eq(InputBlockCore.release_all(), 1)
	InputBlockCore.release()
	assert_eq(run[0], 0)
	# the result of the operation that ends later is not used
	operation.finish(true)
	assert_eq(run[0], 0)


func test_release_after_forced_release_ends_run_blocked_with_false() -> void:
	init_modules()
	var operation: RunOperation = RunOperation.new()
	add_child_autofree(operation)
	var run: Array[int] = [PENDING]
	_run(operation.operation, null, run)
	await advance(MAX_MS)
	assert_false(InputBlockCore.is_blocked())
	assert_eq(UnitTestCore.check_logs("error", TAG), 1)
	InputBlockCore.release()
	assert_eq(run[0], 0)
	operation.finish(true)
	assert_eq(run[0], 0)


func test_release_ends_run_blocked_whose_operation_never_ends() -> void:
	init_modules()
	var operation: RunOperation = RunOperation.new()
	var owner: Node = Node.new()
	add_child_autofree(owner)
	var run: Array[int] = [PENDING]
	_run(operation.operation, owner, run)
	assert_eq(InputBlockCore.release_all(), 1)
	assert_eq(UnitTestCore.check_logs("warn", TAG), 1)
	# the operation's object is destroyed after its block was lifted, so the operation never resumes; the owner object
	# lives, so the call waits until release
	operation.free()
	await next_frame()
	assert_eq(run[0], PENDING)
	InputBlockCore.release()
	assert_eq(run[0], 0)


func test_release_before_the_first_await_of_the_operation_ends_run_blocked_with_false() -> void:
	init_modules()
	var operation: RunOperation = RunOperation.new()
	add_child_autofree(operation)
	var run: Array[int] = [PENDING]
	_run(operation.release_then_wait, null, run)
	assert_eq(operation.calls, 1)
	assert_false(InputBlockCore.is_initialized())
	# the operation has not ended
	assert_eq(run[0], 0)
	operation.finish(true)
	assert_eq(run[0], 0)
	assert_eq(UnitTestCore.check_logs("warn", TAG), 0)


func test_release_in_an_operation_that_ends_without_waiting_ends_run_blocked_with_false() -> void:
	init_modules()
	var operation: RunOperation = RunOperation.new()
	add_child_autofree(operation)
	var run: Array[int] = [PENDING]
	_run(operation.release_then_succeed, null, run)
	assert_eq(operation.calls, 1)
	assert_eq(run[0], 0)


func test_run_blocked_calls_that_end_in_any_order_keep_the_others_waiting() -> void:
	init_modules()
	var first: RunOperation = RunOperation.new()
	var second: RunOperation = RunOperation.new()
	var third: RunOperation = RunOperation.new()
	add_child_autofree(first)
	add_child_autofree(second)
	add_child_autofree(third)
	var first_run: Array[int] = [PENDING]
	var second_run: Array[int] = [PENDING]
	var third_run: Array[int] = [PENDING]
	_run(first.operation, null, first_run)
	_run(second.operation, null, second_run)
	_run(third.operation, null, third_run)
	first.finish(true)
	assert_eq(first_run[0], 1)
	assert_eq(InputBlockCore.release_all(), 2)
	third.finish(false)
	assert_eq(third_run[0], 0)
	# the call left waiting is still woken by release
	InputBlockCore.release()
	assert_eq(second_run[0], 0)
	second.finish(true)
	assert_eq(second_run[0], 0)


func _run(operation: Callable, owner: Node, run: Array[int]) -> void:
	var ok: bool = await InputBlockCore.run_blocked("content", operation, null, owner)
	run[0] = 1 if ok else 0


func _run_with_owner(operation: Callable, owner: RefCounted, run: Array[int]) -> void:
	var ok: bool = await InputBlockCore.run_blocked("content", operation, null, owner)
	run[0] = 1 if ok else 0
