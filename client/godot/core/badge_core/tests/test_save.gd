extends "res://core/badge_core/tests/support/badge_test_case.gd"
## Saving the item badges of persist badges in the `user` file and `load_saved`.


func test_persist_items_come_back_after_release_init_and_load_saved() -> void:
	assert_true(await start_saving())
	assert_true(BadgeCore.set_item(saved_badge, 5, 2))
	assert_true(BadgeCore.set_item(saved_dot_badge, -3, 1))
	assert_true(BadgeCore.set_item(a_badge, 7, 1))
	await frame_end()
	BadgeCore.release()
	assert_true(BadgeCore.init())
	assert_eq(BadgeCore.get_item_count(saved_badge, 5), 0, "not loaded yet")
	assert_true(BadgeCore.load_saved())
	assert_eq(BadgeCore.get_item_count(saved_badge, 5), 2)
	assert_eq(BadgeCore.get_item_count(saved_dot_badge, -3), 1)
	assert_eq(BadgeCore.get_item_count(a_badge, 7), 0, "persist false")
	await frame_end()
	assert_eq(BadgeCore.get_count(saved_badge), 2)


func test_set_item_before_load_saved_does_not_save_and_merges_with_saved_items() -> void:
	assert_true(await start_modules())
	assert_true(LocalDataCore.load_user_file(USER_ID))
	LocalDataCore.set_array_string(LocalDataCore.FileKind.USER, ITEMS_KEY,
			PackedStringArray([element(saved_badge, 5, 9), element(saved_badge, 6, 3)]))
	assert_true(BadgeCore.set_item(saved_badge, 5, 1))
	await frame_end()
	assert_eq(saved_items(), PackedStringArray([element(saved_badge, 5, 9), element(saved_badge, 6, 3)]),
			"no save before load_saved")
	assert_eq(errors(), 0)
	assert_true(BadgeCore.load_saved())
	assert_eq(BadgeCore.get_item_count(saved_badge, 5), 1, "the memory value")
	assert_eq(BadgeCore.get_item_count(saved_badge, 6), 3, "the item only saved")
	await frame_end()
	assert_eq(saved_items(), PackedStringArray([element(saved_badge, 5, 1), element(saved_badge, 6, 3)]))


func test_malformed_saved_elements_are_dropped_with_a_warn_and_the_rest_are_read() -> void:
	assert_true(await start_modules())
	assert_true(LocalDataCore.load_user_file(USER_ID))
	var saved: PackedStringArray = PackedStringArray([
		"x",
		"%d:2" % saved_badge,
		element(saved_badge, 0, 1),
		element(saved_badge, 3, 0),
		"%d:a=1" % saved_badge,
		"%d:4=2=1" % saved_badge,
		element(saved_badge, 4, 2),
		element(UNKNOWN_BADGE, 1, 1),
		element(a_badge, 1, 1),
	])
	LocalDataCore.set_array_string(LocalDataCore.FileKind.USER, ITEMS_KEY, saved)
	assert_true(BadgeCore.load_saved())
	assert_eq(warns(), 6)
	assert_eq(BadgeCore.get_item_count(saved_badge, 4), 2)
	assert_eq(BadgeCore.get_item_count(a_badge, 1), 0, "a badge whose persist is false is dropped")
	await frame_end()
	assert_eq(saved_items(), PackedStringArray([element(saved_badge, 4, 2)]), "the dropped values are saved away")


func test_removed_persist_item_leaves_the_saved_value() -> void:
	assert_true(await start_saving())
	assert_true(BadgeCore.set_item(saved_badge, 5, 1))
	assert_true(BadgeCore.set_item(saved_badge, 6, 2))
	await frame_end()
	assert_eq(saved_items(), PackedStringArray([element(saved_badge, 5, 1), element(saved_badge, 6, 2)]))
	events = PackedStringArray()
	assert_true(BadgeCore.set_item(saved_badge, 5, 0))
	await frame_end()
	assert_eq(saved_items(), PackedStringArray([element(saved_badge, 6, 2)]))
	assert_eq(events, PackedStringArray([event_text(saved_badge, 5, 0), event_text(saved_badge, 0, 2)]))
	BadgeCore.clear_items(saved_badge)
	await frame_end()
	assert_eq(saved_items(), PackedStringArray())


func test_load_saved_without_the_user_file_fails_and_goes_on_without_saved_values() -> void:
	assert_true(await start_modules())
	assert_false(BadgeCore.load_saved())
	assert_eq(errors(), 1)
	assert_true(BadgeCore.set_item(saved_badge, 5, 1))
	await frame_end()
	assert_eq(BadgeCore.get_count(saved_badge), 1)
	assert_eq(errors(), 0, "no save is tried")
