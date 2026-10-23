extends "res://core/badge_core/tests/support/badge_test_case.gd"
## The error table: per condition, the failure value and the log.


func test_badge_id_not_in_the_table_gives_each_failure_value_and_an_error() -> void:
	assert_true(await start_modules())
	var view: BadgeView = make_view()
	assert_false(BadgeCore.register_evaluator(UNKNOWN_BADGE, Hooks.evaluate))
	assert_false(BadgeCore.set_count(UNKNOWN_BADGE, 1))
	assert_false(BadgeCore.set_item(UNKNOWN_BADGE, 1, 1))
	BadgeCore.clear_item(UNKNOWN_BADGE, 1)
	BadgeCore.clear_items(UNKNOWN_BADGE)
	BadgeCore.refresh(UNKNOWN_BADGE)
	assert_eq(BadgeCore.get_count(UNKNOWN_BADGE), 0)
	assert_eq(BadgeCore.get_item_count(UNKNOWN_BADGE, 1), 0)
	assert_false(view.bind(UNKNOWN_BADGE))
	assert_eq(errors(), 9)
	free_view(view)


func test_second_evaluator_of_a_badge_fails_and_the_first_stays() -> void:
	assert_true(await start_modules())
	Hooks.counts[a_badge] = 2
	assert_true(BadgeCore.register_evaluator(a_badge, Hooks.evaluate))
	assert_false(BadgeCore.register_evaluator(a_badge, Hooks.evaluate_negative))
	assert_eq(errors(), 1)
	await frame_end()
	assert_eq(BadgeCore.get_count(a_badge), 2)
	assert_eq(errors(), 0, "the negative evaluator is not called")


func test_set_count_of_a_badge_with_an_evaluator_fails() -> void:
	assert_true(await start_modules())
	Hooks.counts[a_badge] = 2
	assert_true(BadgeCore.register_evaluator(a_badge, Hooks.evaluate))
	assert_false(BadgeCore.set_count(a_badge, 5))
	assert_eq(errors(), 1)
	await frame_end()
	assert_eq(BadgeCore.get_count(a_badge), 2)


func test_negative_count_fails_and_keeps_the_value() -> void:
	assert_true(await start_modules())
	assert_true(BadgeCore.set_count(a_badge, 2))
	assert_true(BadgeCore.set_item(b_badge, 1, 3))
	assert_false(BadgeCore.set_count(a_badge, -1))
	assert_false(BadgeCore.set_item(b_badge, 1, -1))
	assert_false(BadgeCore.set_item(b_badge, 2, -1))
	assert_eq(errors(), 3)
	assert_eq(BadgeCore.get_item_count(b_badge, 1), 3)
	assert_eq(BadgeCore.get_item_count(b_badge, 2), 0)
	await frame_end()
	assert_eq(BadgeCore.get_count(a_badge), 2)
	assert_eq(BadgeCore.get_count(root_badge), 5)


func test_set_item_with_item_key_zero_fails() -> void:
	assert_true(await start_modules())
	assert_false(BadgeCore.set_item(a_badge, 0, 1))
	assert_eq(errors(), 1)
	await frame_end()
	assert_eq(BadgeCore.get_count(a_badge), 0)


func test_failing_or_negative_evaluator_keeps_own_count_with_an_error() -> void:
	assert_true(await start_modules())
	assert_true(BadgeCore.set_count(a_badge, 2))
	assert_true(BadgeCore.set_count(b_badge, 3))
	assert_true(BadgeCore.register_evaluator(a_badge, Hooks.evaluate_failing))
	assert_true(BadgeCore.register_evaluator(b_badge, Hooks.evaluate_negative))
	await frame_end()
	assert_eq(UnitTestCore.check_script_errors(), 1, "the evaluator stopped on a runtime error")
	assert_eq(Hooks.calls_of(a_badge), 1)
	assert_eq(Hooks.failing_finished, 0, "the evaluator never went past its runtime error")
	assert_eq(errors(), 2)
	assert_eq(BadgeCore.get_count(a_badge), 2)
	assert_eq(BadgeCore.get_count(b_badge), 3)


func test_prepare_with_a_dot_prefab_that_does_not_load_fails_and_uses_the_code_made_circle() -> void:
	set_string("BadgeCore.dotResource", MISSING_DOT)
	assert_true(await start_modules())
	assert_false(await BadgeCore.prepare())
	assert_eq(errors(), 1)
	UnitTestCore.check_logs("error", "ResourceCore")
	var view: BadgeView = make_view()
	assert_true(view.bind(a_badge))
	assert_true(BadgeCore.set_count(a_badge, 1))
	await frame_end()
	assert_true(view._label.get_parent() is Panel, "code made circle")
	free_view(view)


func test_prepare_with_a_dot_prefab_without_control_root_fails() -> void:
	set_string("BadgeCore.dotResource", DOT_NODE2D)
	assert_true(await start_modules())
	assert_false(await BadgeCore.prepare())
	assert_eq(errors(), 1)
	assert_null(BadgeCore._dot_prefab)


func test_load_saved_without_a_readable_user_file_fails_with_an_error() -> void:
	assert_true(await start_modules())
	assert_false(BadgeCore.load_saved())
	assert_eq(errors(), 1)
	assert_true(BadgeCore.set_item(saved_badge, 5, 1))
	await frame_end()
	assert_eq(UnitTestCore.check_logs("error", "LocalDataCore"), 0, "no write to the unloaded user file")
	assert_true(LocalDataCore.load_user_file(USER_ID))
	assert_eq(saved_items(), PackedStringArray())
	assert_true(BadgeCore.set_item(saved_badge, 6, 1))
	await frame_end()
	assert_eq(BadgeCore.get_count(saved_badge), 2)
	assert_eq(saved_items(), PackedStringArray(), "no save after the user file loads")
	assert_eq(errors(), 0)


func test_malformed_saved_element_is_a_warn() -> void:
	assert_true(await start_modules())
	assert_true(LocalDataCore.load_user_file(USER_ID))
	LocalDataCore.set_array_string(LocalDataCore.FileKind.USER, ITEMS_KEY,
			PackedStringArray(["%d:1=x" % saved_badge, element(saved_badge, 1, 1)]))
	assert_true(BadgeCore.load_saved())
	assert_eq(warns(), 1)
	assert_eq(errors(), 0)
	assert_eq(BadgeCore.get_item_count(saved_badge, 1), 1)


func test_clear_item_of_a_missing_item_has_no_log() -> void:
	assert_true(await start_modules())
	BadgeCore.clear_item(a_badge, 3)
	BadgeCore.clear_items(a_badge)
	assert_eq(errors(), 0)
	assert_eq(warns(), 0)
	await frame_end()
	assert_eq(events, PackedStringArray())
