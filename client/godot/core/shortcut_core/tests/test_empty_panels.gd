extends "res://core/shortcut_core/tests/support/shortcut_case.gd"
## A shortcut whose panel path is empty.


func test_root_in_the_current_scene_closes_popups_and_panels_down_to_the_root() -> void:
	assert_true(await start_at(SCENE_ROOT, PackedStringArray([PANEL_A])))
	assert_true(ShortcutCore.register_param_builder(PANEL_B, Hooks.build_b))
	await open_popups(1)
	var id: int = shortcut("root_empty")
	assert_true(await ShortcutCore.navigate(id))
	assert_in_order(PackedStringArray(["popup_hidden", "flow:close:r:true", "navigated:%d" % id]))
	assert_eq(flows(), PackedStringArray(["flow:close:r:true"]))
	assert_eq(Trace.with_prefix("builder:").size(), 0)
	assert_eq(Trace.with_prefix("scene_ended:").size(), 0)
	assert_eq(probe.navigated_panels.size(), 1)
	assert_eq(probe.navigated_panels[0], PackedStringArray())
	assert_eq(UICore.get_open_popup_count(), 0)
	assert_eq(stack(), "r")


func test_root_in_a_scene_without_a_root_panel_keeps_the_stack() -> void:
	assert_true(await start_at(SCENE_PLAIN, PackedStringArray([PANEL_A])))
	await open_popups(1)
	assert_true(await ShortcutCore.navigate(shortcut("plain_empty")))
	assert_eq(flows().size(), 0)
	assert_eq(Trace.count("popup_hidden"), 1)
	assert_eq(probe.navigated_ids.size(), 1)
	assert_eq(UICore.get_open_popup_count(), 0)
	assert_eq(stack(), "a")


func test_top_in_the_current_scene_keeps_the_stack() -> void:
	assert_true(await start_at(SCENE_ROOT, PackedStringArray([PANEL_A])))
	await open_popups(1)
	assert_true(await ShortcutCore.navigate(shortcut("top_empty")))
	assert_eq(flows().size(), 0)
	assert_eq(Trace.count("popup_hidden"), 1)
	assert_eq(probe.navigated_panels.size(), 1)
	assert_eq(probe.navigated_panels[0], PackedStringArray())
	assert_eq(UICore.get_open_popup_count(), 0)
	assert_eq(stack(), "r,a")
