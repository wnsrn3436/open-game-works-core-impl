extends "res://core/shortcut_core/tests/support/shortcut_case.gd"
## Lifecycle: init check, operations before init, release puts the state back, and init again.


func test_is_initialized_before_init_after_init_and_after_release() -> void:
	assert_true(await start_modules(false))
	assert_false(ShortcutCore.is_initialized())
	assert_true(ShortcutCore.init())
	assert_true(ShortcutCore.is_initialized())
	ShortcutCore.release()
	assert_false(ShortcutCore.is_initialized())


func test_operations_before_init_and_after_release_log_an_error_and_fail() -> void:
	assert_true(await start_modules(false))
	assert_false(ShortcutCore.register_param_builder(PANEL_B, Hooks.build_b))
	assert_false(await ShortcutCore.navigate(shortcut("root_c")))
	assert_false(ShortcutCore.is_navigating())
	assert_eq(errors(TAG), 3)
	assert_true(ShortcutCore.init())
	assert_false(ShortcutCore.init())
	assert_eq(errors(TAG), 1)
	ShortcutCore.release()
	assert_false(await ShortcutCore.navigate(shortcut("root_c")))
	assert_eq(errors(TAG), 1)


func test_release_puts_static_vars_back() -> void:
	assert_true(await start_at(SCENE_ROOT))
	assert_true(ShortcutCore.register_param_builder(PANEL_C, Hooks.build_c))
	TestPanel.new_gate = Gate.new()
	navigate_later(shortcut("root_c"))
	await wait_trace("panel_gated:c")
	assert_true(ShortcutCore.is_navigating())
	ShortcutCore.release()
	assert_false(ShortcutCore._is_initialized)
	assert_null(ShortcutCore._session)
	assert_true(ShortcutCore._param_builders.is_empty())
	assert_false(ShortcutCore._navigating)
	assert_null(ShortcutCore._wait)
	TestPanel.new_gate.open(true)
	await wait_trace("flow:open:c:true")


func test_init_after_release_works_like_the_first_init() -> void:
	assert_true(await start_at(SCENE_ROOT))
	assert_true(ShortcutCore.register_param_builder(PANEL_C, Hooks.build_c))
	ShortcutCore.release()
	assert_true(ShortcutCore.init())
	assert_true(ShortcutCore.register_param_builder(PANEL_C, Hooks.build_d))
	assert_true(await ShortcutCore.navigate(shortcut("root_c")))
	assert_true(Trace.has("builder:d:true"))
	assert_false(Trace.has("builder:c:true"))
	assert_eq(errors(TAG), 0)
