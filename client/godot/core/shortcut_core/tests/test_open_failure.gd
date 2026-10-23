extends "res://core/shortcut_core/tests/support/shortcut_case.gd"
## A target panel whose `prepare` fails: what the stopped navigation leaves.


func test_root_leaves_the_root_item_and_does_not_reopen_popups() -> void:
	assert_true(await start_at(SCENE_ROOT, PackedStringArray([PANEL_A])))
	await open_popups(2)
	assert_false(await ShortcutCore.navigate(shortcut("root_f")))
	await UnitTestCore.wait_frames(2)
	assert_eq(UICore.get_open_popup_count(), 0)
	assert_eq(stack(), "r")
	assert_eq(probe.navigated_ids.size(), 0)
	UnitTestCore.check_logs(ERROR, "UICore")


func test_top_leaves_the_stack_before_the_navigation() -> void:
	assert_true(await start_at(SCENE_ROOT, PackedStringArray([PANEL_A])))
	assert_false(await ShortcutCore.navigate(shortcut("top_f")))
	assert_eq(stack(), "r,a")
	assert_eq(probe.navigated_ids.size(), 0)
	UnitTestCore.check_logs(ERROR, "UICore")


func test_a_changed_scene_stays_the_target_scene() -> void:
	assert_true(await start_at(SCENE_ROOT, PackedStringArray([PANEL_A])))
	assert_false(await ShortcutCore.navigate(shortcut("change_f")))
	assert_eq(SceneCore.current_scene_key(), SCENE_ROOT_OTHER)
	assert_eq(stack(), "r")
	assert_eq(probe.navigated_ids.size(), 0)
	UnitTestCore.check_logs(ERROR, "UICore")
