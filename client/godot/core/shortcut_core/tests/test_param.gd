extends "res://core/shortcut_core/tests/support/shortcut_case.gd"
## Stage 4: the param builders and the params the panels of the path get.


func test_builders_get_the_row_and_the_target_flag_and_the_panels_get_their_params() -> void:
	assert_true(await start_at(SCENE_ROOT))
	assert_true(ShortcutCore.register_param_builder(PANEL_B, Hooks.build_b))
	assert_true(ShortcutCore.register_param_builder(PANEL_C, Hooks.build_c))
	var id: int = shortcut("root_bc")
	assert_true(await ShortcutCore.navigate(id))
	assert_in_order(PackedStringArray(["builder:b:false", "builder:c:true"]))
	assert_eq(Hooks.builder_rows.size(), 2)
	for row: GameData.ShortcutRow in Hooks.builder_rows:
		assert_eq(row, GameData.ShortcutTable.get_row(id))
	assert_eq(stack(), "r,b,c")
	assert_same(TestPanel.shown_params["c"], Hooks.built["c"])
	assert_false(TestPanel.shown_params.has("b"))
	assert_true(await UICore.close_panel())
	assert_same(TestPanel.shown_params["b"], Hooks.built["b"])
	assert_eq(errors(TAG), 0)


func test_a_panel_without_a_builder_gets_none_and_args_need_a_builder_only_on_the_target() -> void:
	assert_true(await start_at(SCENE_ROOT))
	assert_true(ShortcutCore.register_param_builder(PANEL_C, Hooks.build_c))
	assert_true(await ShortcutCore.navigate(shortcut("root_bc")))
	assert_eq(Trace.with_prefix("builder:"), PackedStringArray(["builder:c:true"]))
	assert_same(TestPanel.shown_params["c"], Hooks.built["c"])
	assert_true(await UICore.close_panel())
	assert_true(TestPanel.shown_params.has("b"))
	assert_null(TestPanel.shown_params["b"])
	assert_eq(errors(TAG), 0)


func test_the_target_without_a_builder_and_without_args_gets_none() -> void:
	assert_true(await start_at(SCENE_ROOT))
	assert_true(await ShortcutCore.navigate(shortcut("root_c")))
	assert_true(TestPanel.shown_params.has("c"))
	assert_null(TestPanel.shown_params["c"])
	assert_eq(errors(TAG), 0)
