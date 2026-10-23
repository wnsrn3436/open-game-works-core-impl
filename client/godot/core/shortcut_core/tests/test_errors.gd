extends "res://core/shortcut_core/tests/support/shortcut_case.gd"
## The error table: each condition gives its log and `false`, and the stages after it do not run.

## Tags of the modules that log a scene change to a scene that cannot be loaded.
const _SCENE_FAILURE_TAGS: PackedStringArray = ["SceneCore", "ResourceCore", "UICore", "PoolCore"]


func test_navigate_while_navigating_is_refused_and_does_not_change_the_running_one() -> void:
	assert_true(await start_at(SCENE_ROOT))
	TestScene.prepare_gate = Gate.new()
	navigate_later(shortcut("change_b"))
	await wait_trace("scene_gated:root_other")
	Trace.clear()
	assert_false(await ShortcutCore.navigate(shortcut("root_c")))
	assert_eq(warns(TAG), 1)
	assert_true(Trace.entries.is_empty())
	TestScene.prepare_gate.open(true)
	await wait_results(1)
	assert_eq(results[0], 1)
	assert_eq(stack(), "r,b")
	assert_eq(probe.navigated_ids, PackedInt64Array([shortcut("change_b")]))


## No scene or panel transition runs while the popups close in stage 5: only the navigating check refuses the inner
## call.
func test_navigate_while_navigating_without_a_transition_is_refused() -> void:
	assert_true(await start_at(SCENE_ROOT, PackedStringArray([PANEL_A])))
	var result: UICore.PopupOpenResult = await UICore.open_popup(POPUP, null, _navigate_inside)
	assert_eq(result, UICore.PopupOpenResult.OPENED)
	Trace.clear()
	var id: int = shortcut("root_c")
	assert_true(await ShortcutCore.navigate(id))
	assert_true(Trace.has("inner_navigate"))
	assert_eq(results, PackedInt32Array([0]))
	assert_eq(warns(TAG), 1)
	await UnitTestCore.wait_frames(2)
	assert_eq(flows(), PackedStringArray(["flow:close:r:true", "flow:open:c:true"]))
	assert_eq(stack(), "r,c")
	assert_eq(probe.navigated_ids, PackedInt64Array([id]))
	assert_false(ShortcutCore.is_navigating())


func test_navigate_during_a_scene_transition_is_refused() -> void:
	assert_true(await start_at(SCENE_ROOT))
	TestScene.prepare_gate = Gate.new()
	_change_scene_later(SCENE_ROOT_OTHER)
	await wait_trace("scene_gated:root_other")
	Trace.clear()
	assert_false(await ShortcutCore.navigate(shortcut("change_b")))
	assert_eq(warns(TAG), 1)
	assert_false(Trace.has("judge:a"))
	assert_false(ShortcutCore.is_navigating())
	TestScene.prepare_gate.open(true)
	await wait_trace("scene_started:root_other")
	assert_eq(probe.navigated_ids.size(), 0)


func test_navigate_during_a_panel_transition_is_refused() -> void:
	assert_true(await start_at(SCENE_ROOT))
	await open_popups(1)
	TestPanel.new_gate = Gate.new()
	open_panel_later(PANEL_A)
	await wait_trace("panel_gated:a")
	assert_false(await ShortcutCore.navigate(shortcut("change_b")))
	assert_eq(warns(TAG), 1)
	assert_false(Trace.has("judge:a"))
	assert_eq(UICore.get_open_popup_count(), 1)
	TestPanel.new_gate.open(true)
	await wait_trace("flow:open:a:true")
	assert_eq(probe.navigated_ids.size(), 0)


func test_a_shortcut_id_not_in_the_table_is_an_error() -> void:
	assert_true(await start_at(SCENE_ROOT))
	await open_popups(1)
	assert_false(await ShortcutCore.navigate(0))
	assert_false(await ShortcutCore.navigate(2147483647))
	assert_eq(errors(TAG), 2)
	assert_eq(UICore.get_open_popup_count(), 1)
	assert_true(Trace.entries.is_empty())
	assert_false(ShortcutCore.is_navigating())


func test_a_builder_that_returns_none_stops_before_closing_popups() -> void:
	assert_true(await start_at(SCENE_ROOT))
	assert_true(ShortcutCore.register_param_builder(PANEL_B, Hooks.build_b))
	Hooks.builder_returns_none = true
	await open_popups(1)
	assert_false(await ShortcutCore.navigate(shortcut("change_b")))
	assert_eq(errors(TAG), 1)
	assert_true(Trace.has("builder:b:true"))
	assert_eq(UICore.get_open_popup_count(), 1)
	assert_eq(Trace.with_prefix("scene_ended:").size(), 0)
	assert_eq(flows().size(), 0)
	assert_eq(probe.navigated_ids.size(), 0)
	assert_false(ShortcutCore.is_navigating())


func test_a_builder_that_returns_no_ui_param_is_an_error() -> void:
	assert_true(await start_at(SCENE_ROOT))
	assert_true(ShortcutCore.register_param_builder(PANEL_C, Hooks.build_wrong_type))
	await open_popups(1)
	assert_false(await ShortcutCore.navigate(shortcut("root_c")))
	assert_eq(errors(TAG), 1)
	assert_true(Trace.has("builder:wrong_type"))
	assert_eq(UICore.get_open_popup_count(), 1)
	assert_eq(flows().size(), 0)


func test_a_builder_that_throws_stops_with_an_error_and_the_next_navigate_calls_it_again() -> void:
	assert_true(await start_at(SCENE_ROOT))
	assert_true(ShortcutCore.register_param_builder(PANEL_C, Hooks.build_throwing))
	await open_popups(1)
	assert_false(await ShortcutCore.navigate(shortcut("root_c")))
	assert_eq(UnitTestCore.check_script_errors(), 1, "the param builder threw")
	assert_eq(errors(TAG), 1)
	assert_eq(UICore.get_open_popup_count(), 1)
	assert_eq(flows().size(), 0)
	assert_false(await ShortcutCore.navigate(shortcut("root_c")))
	assert_eq(UnitTestCore.check_script_errors(), 1, "the next navigate called the param builder again")
	assert_eq(errors(TAG), 1)
	assert_eq(Trace.count("builder:throwing"), 2)
	assert_false(ShortcutCore.is_navigating())


func test_args_on_a_target_without_a_builder_is_an_error() -> void:
	assert_true(await start_at(SCENE_ROOT))
	await open_popups(1)
	assert_false(await ShortcutCore.navigate(shortcut("root_c_args")))
	assert_eq(errors(TAG), 1)
	assert_eq(UICore.get_open_popup_count(), 1)
	assert_eq(flows().size(), 0)
	assert_eq(probe.navigated_ids.size(), 0)


func test_a_transition_after_closing_popups_stops_with_a_warning() -> void:
	assert_true(await start_at(SCENE_ROOT))
	var result: UICore.PopupOpenResult = await UICore.open_popup(POPUP, null, _start_panel_transition)
	assert_eq(result, UICore.PopupOpenResult.OPENED)
	Trace.clear()
	assert_false(await ShortcutCore.navigate(shortcut("change_b")))
	assert_eq(warns(TAG), 1)
	assert_eq(errors(TAG), 0)
	assert_eq(Trace.with_prefix("scene_ended:").size(), 0)
	await wait_trace("flow:open:x:true")
	assert_eq(flows(), PackedStringArray(["flow:open:x:true"]))
	assert_eq(probe.navigated_ids.size(), 0)


func test_a_failed_scene_change_stops_without_a_shortcut_log() -> void:
	assert_true(await start_at(SCENE_ROOT))
	assert_false(await ShortcutCore.navigate(shortcut("missing_scene")))
	assert_eq(errors(TAG), 0)
	assert_eq(warns(TAG), 0)
	assert_eq(Trace.with_prefix("flow:close:").size(), 0)
	assert_eq(Trace.with_prefix("flow:open:b").size(), 0)
	assert_eq(probe.navigated_ids.size(), 0)
	assert_false(ShortcutCore.is_navigating())
	_check_failed_scene_logs()


func test_a_failed_return_to_the_root_stops_before_opening() -> void:
	assert_true(await start_at(SCENE_ROOT, PackedStringArray([PANEL_A])))
	TestPanel.returned_gate = Gate.new()
	navigate_later(shortcut("root_c"))
	await wait_trace("panel_gated:r")
	UICore.reset_panel_stack()
	TestPanel.returned_gate.open(true)
	await wait_results(1)
	assert_eq(results[0], 0)
	await UnitTestCore.wait_frames(2)
	assert_eq(Trace.with_prefix("flow:open:").size(), 0)
	assert_eq(errors(TAG), 0)
	assert_eq(probe.navigated_ids.size(), 0)
	UnitTestCore.check_logs(ERROR, "UICore")


func test_a_failed_open_stops_without_a_shortcut_log() -> void:
	assert_true(await start_at(SCENE_ROOT))
	assert_false(await ShortcutCore.navigate(shortcut("root_f")))
	assert_eq(flows(), PackedStringArray(["flow:open:f:false"]))
	assert_eq(errors(TAG), 0)
	assert_eq(probe.navigated_ids.size(), 0)
	UnitTestCore.check_logs(ERROR, "UICore")


func test_a_second_builder_for_a_panel_key_is_an_error_and_the_first_stays() -> void:
	assert_true(await start_at(SCENE_ROOT))
	assert_true(ShortcutCore.register_param_builder(PANEL_C, Hooks.build_c))
	assert_false(ShortcutCore.register_param_builder(PANEL_C, Hooks.build_d))
	assert_eq(errors(TAG), 1)
	assert_true(await ShortcutCore.navigate(shortcut("root_c")))
	assert_eq(Trace.with_prefix("builder:"), PackedStringArray(["builder:c:true"]))


func test_a_builder_that_is_not_a_static_func_is_an_error() -> void:
	assert_true(await start_at(SCENE_ROOT))
	assert_false(ShortcutCore.register_param_builder(PANEL_C, func(_row: GameData.ShortcutRow, _t: bool) -> UIParam: return null))
	assert_false(ShortcutCore.register_param_builder(PANEL_C, Hooks.build_c.bind(true)))
	assert_false(ShortcutCore.register_param_builder(PANEL_C, _instance_builder))
	assert_eq(errors(TAG), 3)
	assert_true(ShortcutCore.register_param_builder(PANEL_C, Hooks.build_c))


func _instance_builder(_row: GameData.ShortcutRow, _is_target: bool) -> UIParam:
	return null


## Hidden callback of a popup: starts a panel transition that the test does not wait for.
func _start_panel_transition() -> void:
	open_panel_later(PANEL_X)


## Hidden callback of a popup: a `navigate` to `top_b` while the running navigation closes the popups.
func _navigate_inside() -> void:
	Trace.add("inner_navigate")
	navigate_later(shortcut("top_b"))


func _change_scene_later(scene_key: String) -> void:
	await SceneCore.change_scene(scene_key, null)


## Marks the error logs of the modules that report a scene that cannot be loaded as checked.
func _check_failed_scene_logs() -> void:
	for tag: String in _SCENE_FAILURE_TAGS:
		UnitTestCore.check_logs(ERROR, tag)
