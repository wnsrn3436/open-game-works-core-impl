extends "res://core/scene_core/tests/support/scene_case.gd"
## The transition: its result, its stage order, its start, its requests and `SceneStartedEvent`.


func test_change_scene_makes_the_new_scene_current() -> void:
	assert_true(await start_booted(SCENE_A))
	var ok: bool = await SceneCore.change_scene(SCENE_B, null)
	assert_true(ok)
	assert_eq(SceneCore.current_scene_key(), SCENE_B)
	var scope: Scope = SceneCore.current_scope()
	assert_not_null(scope)
	if scope != null:
		assert_eq(scope.name, SCENE_B)
		assert_eq(scope.kind, ResourceCore.ScopeKind.SCENE)
	assert_false(SceneCore.is_transitioning())


func test_transition_stages_happen_in_order() -> void:
	assert_true(await start_booted(SCENE_PANEL))
	TestScene.preload_keys = PackedStringArray([PRELOAD_ITEM])
	TestScene.prefill_keys = PackedStringArray([POOL_ITEM])
	Trace.clear()
	var ok: bool = await SceneCore.change_scene(SCENE_OTHER_PANEL, null)
	assert_true(ok)
	var expected: PackedStringArray = PackedStringArray([
		"loading_show",
		"exit:" + SCENE_PANEL,
		"ended:" + SCENE_PANEL,
		"stack:0",
		"destroyed:" + SCENE_PANEL,
		"scope_released:" + SCENE_PANEL,
		"loaded:" + SCENE_OTHER_PANEL,
		"preload:" + SCENE_OTHER_PANEL,
		"pool_item",
		"prepare:" + SCENE_OTHER_PANEL,
		"panel_prepare:OtherPanel",
		"panel:OtherPanel",
		"start:" + SCENE_OTHER_PANEL,
		"loading_hide",
		"started:" + SCENE_OTHER_PANEL,
	])
	assert_eq(Trace.entries, expected)
	assert_true(TestPoolItem.preload_was_loaded, "preload ended before the pool fill")
	assert_eq(probe.started_block_count, 0, "transition block released before SceneStartedEvent")


func test_transition_without_current_scene_has_no_exit() -> void:
	assert_true(await start_modules())
	var ok: bool = await SceneCore.boot_change_scene(SCENE_A, null)
	assert_true(ok)
	assert_false(Trace.has("exit:" + SCENE_A))
	assert_false(Trace.has("ended:" + SCENE_A))
	assert_true(Trace.has("started:" + SCENE_A))


func test_transition_start_leaves_only_the_scene_block_and_closes_popups_and_black_box() -> void:
	assert_true(await start_booted(SCENE_A))
	var popup_result: UICore.PopupOpenResult = await UICore.open_popup(POPUP, null, Callable())
	assert_eq(popup_result, UICore.PopupOpenResult.OPENED)
	MessageCore.show_toast(ReservedString.scene_retry())
	MessageCore.show_black_box(ReservedString.scene_restart())
	InputBlockCore.block("content")
	assert_eq(visible_messages(), 2)
	TestLoading.show_gate = Gate.new()
	var results: PackedInt32Array = PackedInt32Array()
	change_later(SCENE_B, results)
	assert_eq(active_reasons(), PackedStringArray(["scene"]))
	assert_eq(UICore.get_open_popup_count(), 0)
	assert_eq(visible_messages(), 1, "the toast goes on, the black box is closed")
	TestLoading.show_gate.open()
	await wait_trace("started:" + SCENE_B)
	assert_eq(results, PackedInt32Array([1]))


func test_transition_lifts_popup_flow_and_tween_blocks_and_keeps_its_block() -> void:
	assert_true(await start_booted(SCENE_A))
	TestPopup.gate = Gate.new()
	var popup_results: Array[UICore.PopupOpenResult] = []
	_open_popup_later(popup_results)
	var target: Control = Control.new()
	add_child_autofree(target)
	var options: TweenOptions = TweenOptions.new()
	options.input_block = true
	TweenCore.play_preset(BLOCK_TWEEN, ResourceCore.get_global_scope(), target, options)
	var before: PackedStringArray = active_reasons()
	assert_true(before.has("ui"), "popup open flow block")
	assert_true(before.has("tween"), "tween block")
	TestLoading.show_gate = Gate.new()
	var results: PackedInt32Array = PackedInt32Array()
	change_later(SCENE_B, results)
	assert_eq(active_reasons(), PackedStringArray(["scene"]))
	TestPopup.gate.open(true)
	await advance(1000)
	assert_eq(active_reasons(), PackedStringArray(["scene"]))
	TestLoading.show_gate.open()
	await wait_trace("started:" + SCENE_B)
	assert_eq(results, PackedInt32Array([1]))


func test_request_during_transition_warns_and_does_not_change_it() -> void:
	assert_true(await start_booted(SCENE_A))
	TestLoading.show_gate = Gate.new()
	var results: PackedInt32Array = PackedInt32Array()
	change_later(SCENE_B, results)
	var second: bool = await SceneCore.change_scene(SCENE_UI, null)
	assert_false(second)
	assert_eq(warns(TAG), 1)
	var boot_second: bool = await SceneCore.boot_change_scene(SCENE_UI, null)
	assert_false(boot_second)
	assert_eq(warns(TAG), 1)
	TestLoading.show_gate.open()
	await wait_trace("started:" + SCENE_B)
	assert_eq(results, PackedInt32Array([1]))
	assert_eq(SceneCore.current_scene_key(), SCENE_B)
	assert_false(Trace.has("loaded:" + SCENE_UI))


func test_change_scene_before_boot_change_scene_fails() -> void:
	assert_true(await start_modules())
	var ok: bool = await SceneCore.change_scene(SCENE_A, null)
	assert_false(ok)
	assert_eq(errors(TAG), 1)
	assert_false(SceneCore.is_transitioning())
	assert_eq(SceneCore.current_scene_key(), "")
	assert_false(Trace.has("loading_show"))


func test_preload_and_pool_fill_failures_still_end_with_true() -> void:
	assert_true(await start_booted(SCENE_A))
	TestScene.preload_keys = PackedStringArray(["prefab/scene_core_test_missing_item"])
	TestScene.prefill_keys = PackedStringArray(["prefab/scene_core_test_missing_pool"])
	var ok: bool = await SceneCore.change_scene(SCENE_B, null)
	assert_true(ok)
	assert_gt(errors("ResourceCore"), 0)
	UnitTestCore.check_logs(ERROR, "PoolCore")
	assert_eq(SceneCore.current_scene_key(), SCENE_B)


func test_scene_started_event_comes_after_the_transition_with_its_duration() -> void:
	set_int("SceneCore.loadingMinDisplayMs", 300)
	assert_true(await start_booted(SCENE_A))
	var results: PackedInt32Array = PackedInt32Array()
	change_later(SCENE_B, results)
	# The test clock stays while the loading screen loads, so stage 1 starts and the loading screen shows at one time.
	await wait_trace("loading_show")
	await advance(300)
	await wait_trace("started:" + SCENE_B)
	assert_false(probe.started_transitioning)
	assert_eq(probe.started_duration_ms, 300)
	assert_eq(results, PackedInt32Array([1]))


func test_boot_change_scene_has_no_loading_screen_and_waits_no_time() -> void:
	set_int("SceneCore.loadingMinDisplayMs", 500)
	assert_true(await start_modules())
	var ok: bool = await SceneCore.boot_change_scene(SCENE_A, null)
	assert_true(ok)
	assert_eq(TestLoading.made_count, 0)
	assert_false(Trace.has("loading_show"))
	assert_eq(SceneCore._loading_area.get_child_count(), 0)


func test_boot_change_scene_prepare_failure_is_fatal_without_popup() -> void:
	assert_true(await start_modules())
	TestScene.prepare_results = [false]
	var ok: bool = await SceneCore.boot_change_scene(SCENE_A, null)
	assert_false(ok)
	assert_eq(probe.fatal_count, 1)
	assert_eq(errors(TAG), 1)
	await wait_popup_layout()
	assert_false(UICore.is_system_popup_visible())
	assert_eq(probe.restart_count, 0)
	assert_true(SceneCore.is_transitioning())


func _open_popup_later(results: Array[UICore.PopupOpenResult]) -> void:
	var result: UICore.PopupOpenResult = await UICore.open_popup(POPUP, null, Callable())
	results.append(result)
