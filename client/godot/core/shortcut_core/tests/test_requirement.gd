extends "res://core/shortcut_core/tests/support/shortcut_case.gd"
## Stage 3: the requirement check and the lock notice.


func test_a_failed_requirement_with_a_guide_text_shows_one_toast_and_stops() -> void:
	assert_true(await start_at(SCENE_ROOT))
	await open_popups(1)
	assert_false(await ShortcutCore.navigate(shortcut("locked")))
	assert_in_order(PackedStringArray(["judge:b", "guide_args"]))
	await UnitTestCore.wait_frames(2)
	var args: FormatArgs = FormatArgs.new()
	args.set_int(Hooks.GUIDE_ARG_NAME, Hooks.GUIDE_ARG_VALUE)
	assert_eq(visible_message_texts(), PackedStringArray([LocalizationCore.format(guide_key(), args)]))
	assert_eq(UICore.get_open_popup_count(), 1)
	assert_false(Trace.has("popup_hidden"))
	assert_eq(Trace.with_prefix("scene_ended:").size(), 0)
	assert_eq(flows().size(), 0)
	assert_eq(probe.navigated_ids.size(), 0)
	assert_eq(errors(TAG), 0)
	assert_eq(warns(TAG), 0)
	assert_false(ShortcutCore.is_navigating())


func test_a_failed_requirement_without_a_guide_text_shows_no_toast() -> void:
	assert_true(await start_at(SCENE_ROOT))
	await open_popups(1)
	assert_false(await ShortcutCore.navigate(shortcut("locked_silent")))
	assert_true(Trace.has("judge:c"))
	assert_false(Trace.has("guide_args"))
	await UnitTestCore.wait_frames(2)
	assert_eq(visible_message_texts().size(), 0)
	assert_eq(UICore.get_open_popup_count(), 1)
	assert_eq(flows().size(), 0)
	assert_eq(probe.navigated_ids.size(), 0)


func test_a_passed_requirement_moves_on() -> void:
	assert_true(await start_at(SCENE_ROOT))
	Hooks.flag_b = true
	assert_true(await ShortcutCore.navigate(shortcut("locked")))
	assert_true(Trace.has("judge:b"))
	assert_false(Trace.has("guide_args"))
	assert_eq(SceneCore.current_scene_key(), SCENE_ROOT_OTHER)
	assert_eq(stack(), "r,b")
