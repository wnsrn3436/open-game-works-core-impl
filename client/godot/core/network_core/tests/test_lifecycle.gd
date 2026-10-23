extends "res://core/network_core/tests/support/network_test_case.gd"
## Lifecycle of NetworkCore.


func _root_has_core_node() -> bool:
	for child: Node in (Engine.get_main_loop() as SceneTree).root.get_children():
		if child.name == "NetworkCore":
			return true
	return false


func _assert_initial_state() -> void:
	assert_false(NetworkCore._is_initialized)
	assert_eq(NetworkCore._node, null)
	assert_eq(NetworkCore._crypto, null)
	assert_true(NetworkCore._due_call.is_null())
	assert_false(NetworkCore._due_queued)
	for value: int in [NetworkCore._request_timeout_ms, NetworkCore._retry_count, NetworkCore._retry_delay_ms, NetworkCore._retry_delay_factor_permille,
			NetworkCore._retry_delay_max_ms, NetworkCore._max_retry_age_ms, NetworkCore._loading_icon_delay_ms, NetworkCore._response_max_bytes,
			NetworkCore._dev_request_record_count, NetworkCore._next_handle, NetworkCore._block_token, NetworkCore._block_started_at,
			NetworkCore._loading_token, NetworkCore._forced_delay_ms]:
		assert_eq(value, 0)
	assert_eq(NetworkCore._transport, null)
	assert_eq(NetworkCore._active_transport, null)
	assert_false(NetworkCore._has_server_info)
	assert_eq(NetworkCore._base_url, "")
	assert_eq(NetworkCore._app_version, "")
	assert_eq(NetworkCore._platform, "")
	assert_eq(NetworkCore._provider, null)
	assert_false(NetworkCore._had_provider)
	assert_false(NetworkCore._session_ended)
	assert_false(NetworkCore._full_resync)
	assert_true(NetworkCore._queue.is_empty())
	assert_eq(NetworkCore._current, null)
	assert_false(NetworkCore._current_processing)
	assert_false(NetworkCore._pumping)
	assert_true(NetworkCore._live.is_empty())
	assert_true(NetworkCore._waiters.is_empty())
	assert_false(NetworkCore._blocked)
	assert_false(NetworkCore._loading_shown)
	assert_true(NetworkCore._error_display_hook.is_null())
	assert_eq(NetworkCore._forced_failure, -1)
	assert_eq(NetworkCore._dev_access, "")
	assert_true(NetworkCore._request_records.is_empty())
	for hook: Callable in [NetworkCore._dev_attempt_hook, NetworkCore._dev_received_hook, NetworkCore._dev_header_hook]:
		assert_true(hook.is_null(), "release drops the DEV hooks")
	assert_false(_root_has_core_node())


func test_init_and_release() -> void:
	assert_false(NetworkCore.is_initialized())
	await start_network()
	assert_true(NetworkCore.is_initialized())
	assert_true(_root_has_core_node())
	assert_false(NetworkCore.init(), "init twice")
	assert_eq(error_logs(), 1)
	add_ok(INTERACTION)
	assert_true(await NetworkCore.send(request(INTERACTION)))
	NetworkCoreDev.force_failure(-1)
	NetworkCoreDev.force_delay(0)
	NetworkCoreDev.set_dev_access("dev-access")
	NetworkCore.release()
	await UnitTestCore.wait_frames(1)
	assert_false(NetworkCore.is_initialized())
	_assert_initial_state()
	assert_true(NetworkCore.init(), "init after release")
	assert_true(NetworkCore.is_initialized())
	NetworkCore.release()


func test_calls_before_init_and_after_release_fail() -> void:
	await start_network()
	NetworkCore.release()
	assert_false(NetworkCore.set_server_info(BASE_URL, APP_VERSION, CoreBuildInfo.platform))
	assert_false(await NetworkCore.send(request(INTERACTION)))
	assert_false(await NetworkCore.resync())
	assert_false((await NetworkCore.send_auth(request("core/Login"), AuthSendOptions.new())).ok)
	NetworkCore.set_session_provider(FakeProvider.new())
	NetworkCore.notify_server_error(CoreContract.CoreError.CORE_ERROR_BANNED)
	assert_false(NetworkCore.register_error_display(_static_display))
	assert_eq(error_logs(), 7)
	assert_eq(request_count(), 0)


func test_core_node_leaving_the_tree_cleans_up() -> void:
	await start_network()
	UnitTestCore.add_pending(INTERACTION)
	var sent: Sent = start_send(request(INTERACTION))
	var node: Node = NetworkCore._node
	node.get_parent().remove_child(node)
	node.free()
	assert_false(NetworkCore.is_initialized())
	assert_false(await wait_sent(sent))
	assert_false(InputBlockCore.is_blocked())
	_assert_initial_state()


func test_register_error_display_takes_one_static_func() -> void:
	await start_network()
	assert_false(NetworkCore.register_error_display(func(_c: int, _n: String) -> ErrorDisplay: return null), "lambda")
	assert_false(NetworkCore.register_error_display(_instance_display), "instance method")
	assert_false(NetworkCore.register_error_display(_StaticDisplay.display.bind(1)), "bound")
	assert_true(NetworkCore.register_error_display(_StaticDisplay.display))
	assert_false(NetworkCore.register_error_display(_StaticDisplay.display), "second registration")
	assert_eq(error_logs(), 4)


func test_error_display_hook_with_a_wrong_output_falls_back() -> void:
	await start_network()
	assert_true(NetworkCore.register_error_display(_StaticDisplay.wrong))
	add_error(INTERACTION, CoreContract.CoreError.CORE_ERROR_NICKNAME_TAKEN)
	assert_false(await NetworkCore.send(request(INTERACTION)))
	await UnitTestCore.wait_frames(2)
	assert_true(popup_shows(ReservedString.network_error_general()))
	assert_eq(error_logs(), 2)


func test_error_display_hook_that_throws_falls_back_and_the_next_failure_calls_it_again() -> void:
	await start_network()
	assert_true(NetworkCore.register_error_display(_StaticDisplay.throwing))
	add_error(INTERACTION, CoreContract.CoreError.CORE_ERROR_NICKNAME_TAKEN)
	assert_false(await NetworkCore.send(request(INTERACTION)))
	await UnitTestCore.wait_frames(2)
	assert_eq(UnitTestCore.check_script_errors(), 1, "the hook threw")
	assert_true(popup_shows(ReservedString.network_error_general()))
	assert_eq(error_logs(), 2)
	add_error(INTERACTION, CoreContract.CoreError.CORE_ERROR_NICKNAME_TAKEN)
	assert_false(await NetworkCore.send(request(INTERACTION)))
	await UnitTestCore.wait_frames(2)
	assert_eq(UnitTestCore.check_script_errors(), 1, "the next failure called the hook again")
	assert_eq(error_logs(), 2)


func _instance_display(_code: int, _request_name: String) -> ErrorDisplay:
	return ErrorDisplay.new()


static func _static_display(_code: int, _request_name: String) -> ErrorDisplay:
	return ErrorDisplay.new()


class _StaticDisplay extends RefCounted:
	static func display(_code: int, _request_name: String) -> ErrorDisplay:
		var out: ErrorDisplay = ErrorDisplay.new()
		out.kind = NetworkCore.ErrorDisplayKind.NONE
		return out

	static func wrong(_code: int, _request_name: String) -> ErrorDisplay:
		return null

	## Stops on a GDScript runtime error, an out-of-bounds read.
	static func throwing(_code: int, _request_name: String) -> ErrorDisplay:
		var none: Array[ErrorDisplay] = []
		return none[0]
