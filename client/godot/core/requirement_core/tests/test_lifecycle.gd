extends "res://core/requirement_core/tests/support/requirement_test_case.gd"
## Lifecycle: `init`, `release`, a tree teardown, `init` again, `init` before `DataCore.load`, and the operations
## before `init` and after `release`.


func test_lifecycle_init_release_and_initial_static_state() -> void:
	assert_false(RequirementCore.is_initialized())
	await start()
	assert_true(RequirementCore.is_initialized())
	var node: Node = RequirementCore._node
	assert_true(node != null and node.is_inside_tree(), "the core node is in the tree")
	assert_eq(node.process_mode, Node.PROCESS_MODE_ALWAYS, "the batch evaluation runs during the pause")
	assert_false(RequirementCore.init(), "init of an initialized module")
	assert_eq(errors(), 1)
	register_flags()
	answer(false)
	var recorder: Recorder = Recorder.new()
	var owner: Node = Node.new()
	add_child_autofree(owner)
	assert_true(RequirementCore.watch(id_of(NESTED_1), triggers(content_trigger()), recorder.on_result, owner))
	RequirementCore.evaluate(999999999)
	assert_eq(errors(), 1)
	publish_content()
	RequirementCore.release()
	assert_false(RequirementCore.is_initialized())
	_assert_initial_state()
	assert_false(node.is_inside_tree(), "the core node left the tree")
	assert_eq(recorder.count(), 0, "release calls no callback")
	await frame()
	assert_false(is_instance_valid(node), "the core node is freed")
	RequirementCore.release()
	assert_eq(errors(), 0, "release of a released module logs nothing")


func _assert_initial_state() -> void:
	assert_eq(RequirementCore._session, null)
	assert_eq(RequirementCore._node, null)
	assert_eq(RequirementCore._max_rounds, 0)
	assert_eq(RequirementCore._recheck_ms, 0)
	assert_eq(RequirementCore._judges.size(), 0)
	assert_eq(RequirementCore._entries.size(), 0)
	assert_eq(RequirementCore._entry_list.size(), 0)
	assert_eq(RequirementCore._building.size(), 0)
	assert_eq(RequirementCore._zero.passed, false)
	assert_eq(RequirementCore._watches.size(), 0)
	assert_eq(RequirementCore._pending_count, 0)
	assert_eq(RequirementCore._owner_watch_count, 0)
	assert_eq(RequirementCore._time_watch_count, 0)
	assert_eq(RequirementCore._recheck_at, 0)
	assert_eq(RequirementCore._kind_counts, PackedInt32Array([0, 0, 0, 0, 0]))
	assert_eq(RequirementCore._content_counts.size(), 0)
	assert_eq(RequirementCore._logged_ids.size(), 0)
	assert_eq(RequirementCore._logged_types.size(), 0)


func test_a_tree_teardown_without_release_cleans_up_like_release() -> void:
	await start()
	register_flags()
	var recorder: Recorder = Recorder.new()
	assert_true(RequirementCore.watch(id_of(SINGLE), triggers(content_trigger()), recorder.on_result))
	var node: Node = RequirementCore._node
	node.get_parent().remove_child(node)
	assert_false(RequirementCore.is_initialized())
	_assert_initial_state()
	assert_eq(EventCore.count_subscriptions(node), 0, "the subscriptions of the core node ended")
	node.free()
	assert_eq(errors(), 0)


func test_init_after_release_has_no_previous_hook_watch_or_cache() -> void:
	await start()
	register_flags()
	answer(true)
	var recorder: Recorder = Recorder.new()
	var single: int = id_of(SINGLE)
	assert_true(RequirementCore.watch(single, triggers(content_trigger()), recorder.on_result))
	assert_true(RequirementCore.evaluate(single).passed)
	RequirementCore.release()
	assert_true(RequirementCore.init())
	assert_result(RequirementCore.evaluate(single), false, single, "", "no judge hook: the cached pass is gone")
	assert_eq(errors(), 1, "the type without a hook")
	put_tutorial()
	publish_content()
	await frame()
	assert_eq(recorder.count(), 0, "no previous watch")
	assert_true(RequirementCore.watch(single, triggers(content_trigger()), recorder.on_result), "the same watch again")
	assert_true(RequirementCore.register_judge(FLAG_A, Hooks.flag, [] as Array[GDScript], GUIDE_A), "the same type again")
	assert_eq(Hooks.count(FLAG_A), 1)
	assert_true(RequirementCore.evaluate(single).passed)
	assert_eq(Hooks.count(FLAG_A), 2, "judged by the new hook")


func test_init_before_data_core_load_reads_no_container_and_logs_nothing() -> void:
	await start(SERVER_TIME, false)
	assert_eq(errors(), 0)
	assert_eq(RequirementCore._entries.size(), 0)
	assert_true(await DataCore.load(null), "DataCore.load")
	register_flags()
	answer(true)
	assert_result(RequirementCore.evaluate(id_of(SINGLE)), true, 0, "")
	answer(false)
	assert_result(RequirementCore.evaluate(id_of(OTHER_A)), false, id_of(OTHER_A), GUIDE_A)
	assert_eq(errors(), 0)


func test_operations_before_init_log_an_error_and_give_the_failure_value() -> void:
	assert_true(LogCore.init())
	assert_true(EventCore.init())
	_check_failures(1)


func test_operations_after_release_log_an_error_and_give_the_failure_value() -> void:
	await start()
	RequirementCore.release()
	_check_failures(id_of(SINGLE))


func _check_failures(single: int) -> void:
	assert_result(RequirementCore.evaluate(single), false, single, "", "evaluate")
	assert_eq(errors(), 1, "evaluate")
	assert_false(RequirementCore.register_judge(FLAG_A, Hooks.flag, [] as Array[GDScript], GUIDE_A))
	assert_eq(errors(), 1, "register_judge")
	var recorder: Recorder = Recorder.new()
	assert_false(RequirementCore.watch(single, triggers(content_trigger()), recorder.on_result))
	assert_eq(errors(), 1, "watch")
	RequirementCore.unwatch(single, recorder.on_result)
	assert_eq(errors(), 1, "unwatch")
	var args: FormatArgs = FormatArgs.new()
	RequirementCore.fill_guide_args(RequirementCore._failure(single), args)
	assert_eq(errors(), 1, "fill_guide_args")
	assert_false(RequirementCore.is_initialized())
