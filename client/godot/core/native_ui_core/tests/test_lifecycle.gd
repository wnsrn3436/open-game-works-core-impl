extends "res://core/native_ui_core/tests/support/native_ui_test_case.gd"
## Lifecycle: init check, release, the adapter around init and release, and destruction of the core node outside
## release.


func test_is_initialized_before_init_after_init_and_after_release() -> void:
	assert_true(await start_modules(null, false))
	assert_false(NativeUiCore.is_initialized())
	assert_true(NativeUiCore.init())
	assert_true(NativeUiCore.is_initialized())
	NativeUiCore.release()
	assert_false(NativeUiCore.is_initialized())


func test_release_puts_back_the_initial_state() -> void:
	assert_true(await start_modules(FakeNativeUiAdapter.new()))
	assert_eq(NativeUiCore.request_review(), REQUESTED)
	NativeUiCoreDev.set_fake_review_result(false)
	NativeUiCoreDev.set_fake_share_result(SHARE_FAILED)
	var node: Node = NativeUiCore._node
	assert_true(node.is_inside_tree())
	NativeUiCore.release()
	assert_false(node.is_inside_tree())
	assert_false(NativeUiCore._is_initialized)
	assert_null(NativeUiCore._node)
	assert_null(NativeUiCore._session)
	assert_null(NativeUiCore._adapter)
	assert_eq(NativeUiCore._review_min_interval_ms, 0)
	assert_eq(NativeUiCore._share_text_max_chars, 0)
	assert_eq(NativeUiCore._share_image_max_bytes, 0)
	assert_false(NativeUiCore._review_requested)
	assert_null(NativeUiCore._share_wait)
	assert_false(NativeUiCore._in_background)
	assert_eq(NativeUiCore._capture_waits.size(), 0)
	assert_null(NativeUiCore._hidden_layer)
	assert_false(NativeUiCore._hidden_layer_visible)
	assert_true(NativeUiCore._fake_review_result)
	assert_eq(NativeUiCore._fake_share_result, CLOSED)
	assert_eq(last_review_at(), TimeCore.get_device_time(), "the stored value stays")


func test_release_during_a_share_ends_it_failed_and_init_again_has_no_adapter() -> void:
	assert_true(await start_modules(FakeNativeUiAdapter.new()))
	start_share(content("cut"))
	assert_eq(share_results.size(), 0)
	NativeUiCore.release()
	await UnitTestCore.wait_frames(2)
	assert_eq(share_results.size(), 1)
	assert_eq(share_results[0], SHARE_FAILED)
	assert_true(NativeUiCore.init())
	assert_null(NativeUiCore._adapter)
	assert_eq(NativeUiCore.request_review(), REVIEW_UNSUPPORTED)
	assert_eq(await NativeUiCore.share(content("x")), SHARE_UNSUPPORTED)
	assert_eq(errors(), 0)


func test_set_native_adapter_after_init_logs_and_keeps_the_adapter() -> void:
	var fake: FakeNativeUiAdapter = FakeNativeUiAdapter.new()
	assert_true(await start_modules(fake))
	NativeUiCore.set_native_adapter(null)
	assert_eq(errors(), 1)
	assert_eq(NativeUiCore._adapter, fake)
	assert_true(NativeUiCore.can_share())
	NativeUiCore.set_native_adapter(NativeUiAdapter.new())
	assert_eq(errors(), 1)
	assert_eq(NativeUiCore._adapter, fake)


func test_set_native_adapter_before_init_and_after_release_works() -> void:
	assert_true(await start_modules(null, false))
	var fake: FakeNativeUiAdapter = FakeNativeUiAdapter.new()
	NativeUiCore.set_native_adapter(fake)
	assert_true(NativeUiCore.init())
	assert_eq(NativeUiCore._adapter, fake)
	NativeUiCore.release()
	NativeUiCore.set_native_adapter(fake)
	assert_true(NativeUiCore.init())
	assert_true(NativeUiCore.can_share())
	assert_eq(errors(), 0)


func test_operations_before_init_log_an_error() -> void:
	assert_true(await start_modules(FakeNativeUiAdapter.new(), false))
	assert_eq(NativeUiCore.request_review(), REVIEW_FAILED)
	assert_false(NativeUiCore.can_share())
	assert_eq((await NativeUiCore.capture_screen()).size(), 0)
	assert_eq(await NativeUiCore.share(content("x")), SHARE_FAILED)
	assert_false(NativeUiCore.copy_text("x"))
	assert_eq(record().share_count, 0)
	NativeUiCoreDev.set_fake_share_result(CLOSED)
	NativeUiCoreDev.set_fake_review_result(true)
	assert_eq(errors(), 8)
	assert_true(NativeUiCore.init())
	assert_false(NativeUiCore.init())
	assert_eq(errors(), 1)


func test_core_node_destroyed_outside_release_cleans_up_without_errors() -> void:
	assert_true(await start_modules(FakeNativeUiAdapter.new()))
	start_share(content("gone"))
	var node: Node = NativeUiCore._node
	node.get_parent().remove_child(node)
	node.free()
	assert_false(NativeUiCore.is_initialized())
	assert_null(NativeUiCore._adapter)
	await UnitTestCore.wait_frames(2)
	assert_eq(share_results.size(), 1)
	assert_eq(share_results[0], SHARE_FAILED)
	assert_eq(errors(), 0)
