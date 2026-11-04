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


func test_load_saved_with_no_saved_key_and_no_persist_items_writes_nothing() -> void:
	assert_true(await start_modules())
	assert_true(LocalDataCore.load_user_file(USER_ID))
	assert_true(BadgeCore.set_item(a_badge, 7, 1))
	assert_true(BadgeCore.load_saved())
	await frame_end()
	LocalDataCore.flush()
	assert_false(user_file_exists(), "memory and saved values are both empty: nothing to write")


func test_load_saved_with_equal_values_in_another_order_writes_nothing() -> void:
	assert_true(await start_modules())
	assert_true(LocalDataCore.load_user_file(USER_ID))
	var saved: PackedStringArray = PackedStringArray([
		element(saved_dot_badge, -3, 1), element(saved_badge, 6, 3), element(saved_badge, 5, 1)
	])
	LocalDataCore.set_array_string(LocalDataCore.FileKind.USER, ITEMS_KEY, saved)
	LocalDataCore.flush()
	var written: PackedByteArray = user_file_bytes()
	assert_false(written.is_empty(), "the saved values are on disk")
	assert_true(BadgeCore.set_item(saved_badge, 5, 1))
	assert_true(BadgeCore.load_saved())
	await frame_end()
	assert_eq(BadgeCore.get_item_count(saved_badge, 6), 3)
	assert_eq(BadgeCore.get_item_count(saved_dot_badge, -3), 1)
	assert_eq(saved_items(), saved, "the memory values equal the saved values: kept in their order")
	LocalDataCore.flush()
	assert_eq(user_file_bytes(), written, "not written")
	assert_true(BadgeCore.set_item(saved_badge, 6, 4))
	await frame_end()
	var after: PackedStringArray = saved_items()
	after.sort()
	var expected: PackedStringArray = PackedStringArray([
		element(saved_badge, 5, 1), element(saved_badge, 6, 4), element(saved_dot_badge, -3, 1)
	])
	expected.sort()
	assert_eq(after, expected, "a change after load_saved saves")


func test_duplicate_saved_element_is_saved_away() -> void:
	assert_true(await start_modules())
	assert_true(LocalDataCore.load_user_file(USER_ID))
	LocalDataCore.set_array_string(LocalDataCore.FileKind.USER, ITEMS_KEY,
			PackedStringArray([element(saved_badge, 5, 1), element(saved_badge, 5, 2)]))
	assert_true(BadgeCore.load_saved())
	assert_eq(BadgeCore.get_item_count(saved_badge, 5), 1, "the first element")
	await frame_end()
	assert_eq(saved_items(), PackedStringArray([element(saved_badge, 5, 1)]))


func test_long_limit_item_keys_are_saved_and_read_back() -> void:
	const LONG_MIN: int = -9223372036854775807 - 1
	const LONG_MAX: int = 9223372036854775807
	assert_true(await start_saving())
	assert_true(BadgeCore.set_item(saved_badge, LONG_MIN, 2))
	assert_true(BadgeCore.set_item(saved_badge, LONG_MAX, 3))
	await frame_end()
	assert_eq(saved_items(), PackedStringArray([
		"%d:-9223372036854775808=2" % saved_badge, "%d:9223372036854775807=3" % saved_badge
	]))
	BadgeCore.release()
	assert_true(BadgeCore.init())
	assert_true(BadgeCore.load_saved())
	assert_eq(warns(), 0)
	assert_eq(BadgeCore.get_item_count(saved_badge, LONG_MIN), 2)
	assert_eq(BadgeCore.get_item_count(saved_badge, LONG_MAX), 3)


func test_item_keys_out_of_the_long_range_are_dropped_with_a_warn() -> void:
	assert_true(await start_modules())
	assert_true(LocalDataCore.load_user_file(USER_ID))
	LocalDataCore.set_array_string(LocalDataCore.FileKind.USER, ITEMS_KEY, PackedStringArray([
		"%d:-9223372036854775809=1" % saved_badge, "%d:9223372036854775808=1" % saved_badge
	]))
	assert_true(BadgeCore.load_saved())
	assert_eq(warns(), 2)
	await frame_end()
	assert_eq(saved_items(), PackedStringArray())



func user_file_exists() -> bool:
	return not user_file_name().is_empty()


## Bytes of the `user` file on disk. Empty when there is no `user` file.
func user_file_bytes() -> PackedByteArray:
	var name: String = user_file_name()
	if name.is_empty():
		return PackedByteArray()
	return FileAccess.get_file_as_bytes(CoreBuildInfo.storage_root + "local_data/" + name)


func user_file_name() -> String:
	var folder: String = CoreBuildInfo.storage_root + "local_data/"
	if not DirAccess.dir_exists_absolute(folder):
		return ""
	for name: String in DirAccess.get_files_at(folder):
		if name.begins_with("user_") and name.ends_with(".dat"):
			return name
	return ""
