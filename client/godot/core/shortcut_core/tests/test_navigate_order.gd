extends "res://core/shortcut_core/tests/support/shortcut_case.gd"
## The stages of `navigate` in order, to a scene with a root panel.


func test_change_scene_root_one_panel_runs_every_stage_once_in_order() -> void:
	assert_true(await start_at(SCENE_ROOT))
	assert_true(ShortcutCore.register_param_builder(PANEL_B, Hooks.build_b))
	TestScene.start_panel = PANEL_X
	await open_popups(1)
	var id: int = shortcut("change_b")
	assert_true(await ShortcutCore.navigate(id))
	assert_in_order(PackedStringArray([
		"judge:a", "builder:b:true", "popup_hidden", "scene_ended:root", "scene_started:root_other",
		"flow:close:r:true", "flow:open:b:true", "navigated:%d" % id,
	]))
	assert_eq(Trace.with_prefix("scene_ended:").size(), 1)
	assert_eq(Trace.with_prefix("flow:close:").size(), 1)
	assert_eq(Trace.with_prefix("judge:").size(), 1)
	assert_eq(Trace.with_prefix("builder:").size(), 1)
	var after_start: PackedStringArray = Trace.entries.slice(Trace.index("scene_started:root_other"))
	var open_flows: int = 0
	for entry: String in after_start:
		if entry.begins_with("flow:open:"):
			open_flows += 1
	assert_eq(open_flows, 1)
	assert_eq(SceneCore.current_scene_key(), SCENE_ROOT_OTHER)
	assert_eq(stack(), "r,b")
	assert_eq(UICore.get_open_popup_count(), 0)


func test_navigated_event_has_the_shortcut_scene_and_panels_after_navigating_ends() -> void:
	assert_true(await start_at(SCENE_ROOT))
	var id: int = shortcut("root_bcd")
	assert_true(await ShortcutCore.navigate(id))
	assert_eq(probe.navigated_ids.size(), 1)
	assert_eq(probe.navigated_ids[0], id)
	assert_eq(probe.navigated_scenes[0], SCENE_ROOT)
	assert_eq(probe.navigated_panels[0], PackedStringArray([PANEL_B, PANEL_C, PANEL_D]))
	assert_false(probe.navigating_at_event)
	assert_false(ShortcutCore.is_navigating())


func test_is_navigating_from_the_row_lookup_to_the_end() -> void:
	assert_true(await start_at(SCENE_ROOT))
	assert_false(ShortcutCore.is_navigating())
	TestPanel.new_gate = Gate.new()
	navigate_later(shortcut("root_c"))
	await wait_trace("panel_gated:c")
	assert_true(ShortcutCore.is_navigating())
	TestPanel.new_gate.open(true)
	await wait_results(1)
	assert_eq(results[0], 1)
	assert_false(ShortcutCore.is_navigating())


func test_change_scene_closes_panels_to_the_root_after_the_scene_change_ends() -> void:
	assert_true(await start_at(SCENE_ROOT))
	TestScene.start_panel = PANEL_X
	assert_true(await ShortcutCore.navigate(shortcut("change_b")))
	assert_in_order(PackedStringArray([
		"scene_start:root_other", "start_panel:x:true", "scene_started:root_other", "flow:close:r:true",
	]))
	assert_true(Trace.has("closed:x:closed"))
	assert_eq(stack(), "r,b")


## With `RequirementCore` released, an `evaluate` call logs a `RequirementCore` error and fails, even for the
## requirement 0. A judge hook does not run for 0, so the trace alone cannot show the call.
func test_requirement_zero_does_not_evaluate() -> void:
	assert_true(await start_at(SCENE_ROOT))
	RequirementCore.release()
	assert_true(await ShortcutCore.navigate(shortcut("root_c")))
	assert_eq(Trace.with_prefix("judge:").size(), 0)
	assert_eq(stack(), "r,c")
	assert_false(await ShortcutCore.navigate(shortcut("change_b")), "a requirement other than 0 is evaluated")
	assert_eq(errors("RequirementCore"), 1)
	assert_eq(stack(), "r,c")
