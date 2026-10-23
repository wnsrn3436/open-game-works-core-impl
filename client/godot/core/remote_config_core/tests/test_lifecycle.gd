extends "res://core/remote_config_core/tests/support/remote_config_test_case.gd"
## Lifecycle of RemoteConfigCore.


func _root_has_core_node() -> bool:
	for child: Node in (Engine.get_main_loop() as SceneTree).root.get_children():
		if child.name == "RemoteConfigCore":
			return true
	return false


func _assert_initial_state() -> void:
	assert_false(RemoteConfigCore._is_initialized)
	assert_eq(RemoteConfigCore._node, null)
	assert_eq(RemoteConfigCore._refresh_interval_ms, 0)
	assert_true(RemoteConfigCore._bools.is_empty())
	assert_true(RemoteConfigCore._ints.is_empty())
	assert_true(RemoteConfigCore._strings.is_empty())
	assert_true(RemoteConfigCore._groups.is_empty())
	assert_false(RemoteConfigCore._has_received)
	assert_eq(RemoteConfigCore._applied_real_ms, 0)
	assert_eq(RemoteConfigCore._background_ms, 0)
	assert_eq(RemoteConfigCore._refresh, null)
	assert_true(RemoteConfigCore._logged_unknown_keys.is_empty())
	assert_true(RemoteConfigCore._logged_type_keys.is_empty())
	assert_true(RemoteConfigCore._logged_entry_keys.is_empty())
	assert_false(_root_has_core_node())


func test_init_and_release() -> void:
	await start(false)
	assert_false(RemoteConfigCore.is_initialized())
	assert_true(RemoteConfigCore.init())
	assert_true(RemoteConfigCore.is_initialized())
	assert_true(_root_has_core_node())
	assert_false(RemoteConfigCore.init(), "init twice")
	assert_eq(error_logs(), 1)
	await login(config([bool_entry(flag, true)], [assignment(exp_a, "treatment")]))
	assert_eq(RemoteConfigCore.get_int(flag), 0)
	assert_eq(error_logs(), 1)
	RemoteConfigCore.release()
	await UnitTestCore.wait_frames(1)
	assert_false(RemoteConfigCore.is_initialized())
	_assert_initial_state()
	assert_true(RemoteConfigCore.init(), "init after release")
	assert_true(RemoteConfigCore.is_initialized())
	RemoteConfigCore.release()


func test_getters_are_default_after_release_and_init() -> void:
	await start()
	await login(config([bool_entry(flag, true), int_entry(count, 42), string_entry(title, "remote")], [assignment(exp_a, "treatment")]))
	assert_true(RemoteConfigCore.get_bool(flag))
	RemoteConfigCore.release()
	assert_true(RemoteConfigCore.init())
	assert_false(RemoteConfigCore.get_bool(flag))
	assert_eq(RemoteConfigCore.get_int(count), 10)
	assert_eq(RemoteConfigCore.get_string(title), "hello")
	assert_eq(RemoteConfigCore.get_group(exp_a), "")
	assert_false(RemoteConfigCore.has_received())


func test_calls_before_init_and_after_release_fail() -> void:
	await start(false)
	assert_false(RemoteConfigCore.get_bool(flag))
	assert_eq(RemoteConfigCore.get_int(count), 10, "failure value: default_value")
	assert_eq(RemoteConfigCore.get_string(title), "hello", "failure value: default_value")
	assert_eq(RemoteConfigCore.get_int(NO_KEY), 0)
	assert_eq(RemoteConfigCore.get_string(count), "", "another type: the unknown key value")
	assert_eq(RemoteConfigCore.get_group(exp_a), "")
	assert_false(RemoteConfigCore.has_received())
	assert_false(await RemoteConfigCore.refresh())
	assert_eq(error_logs(), 8)
	assert_true(RemoteConfigCore.init())
	RemoteConfigCore.release()
	assert_eq(RemoteConfigCore.get_int(count), 10)
	assert_eq(error_logs(), 1)


func test_release_ends_a_refresh_in_progress_with_failure() -> void:
	await start()
	await login(config([]))
	UnitTestCore.add_pending(GET)
	var first: Call = start_refresh()
	var second: Call = start_refresh()
	RemoteConfigCore.release()
	assert_false(await wait_call(first))
	assert_false(await wait_call(second))
	assert_true(RemoteConfigCore.init())
	var latch: UnitTestLatch = UnitTestCore.latch_event(RequestCompletedEvent)
	var released: bool = UnitTestCore.release_pending(
		GET, NetworkCore.TransferResult.DONE, 200, response_bytes(config([bool_entry(flag, true)]))
	)
	assert_true(released)
	await UnitTestCore.wait_latch(latch)
	assert_false(RemoteConfigCore.get_bool(flag), "the response of the ended refresh is not applied")
	assert_false(RemoteConfigCore.has_received())
	assert_eq(changed_events, 0)


func test_core_node_leaving_the_tree_cleans_up() -> void:
	await start()
	await login(config([bool_entry(flag, true)]))
	UnitTestCore.add_pending(GET)
	var call: Call = start_refresh()
	var node: Node = RemoteConfigCore._node
	node.get_parent().remove_child(node)
	node.free()
	assert_false(RemoteConfigCore.is_initialized())
	assert_false(await wait_call(call))
	_assert_initial_state()
