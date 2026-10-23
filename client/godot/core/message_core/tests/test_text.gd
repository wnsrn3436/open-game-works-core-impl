extends "res://core/message_core/tests/support/message_test_case.gd"
## Message text: `get_text`, `format`, extra text and the caller's `FormatArgs`.


func test_text_without_format_args_is_get_text_result() -> void:
	set_string("MessageCore.toastResource", TOAST)
	assert_true(await start_prepared())
	MessageCore.show_toast(key_a())
	MessageCore.show_black_box(key_b())
	assert_eq(shown_text(toast()), LocalizationCore.get_text(key_a()))
	assert_eq(shown_text(black_box()), LocalizationCore.get_text(key_b()))


func test_text_with_format_args_is_format_result() -> void:
	set_string("MessageCore.blackBoxResource", BLACK_BOX)
	assert_true(await start_prepared())
	var args: FormatArgs = FormatArgs.new()
	args.set_int("count", 3)
	MessageCore.show_toast(count_key(), args)
	MessageCore.show_black_box(count_key(), args)
	var expected: String = LocalizationCore.format(count_key(), args)
	assert_eq(expected, "3 items for you")
	assert_eq(shown_text(toast()), expected)
	assert_eq(shown_text(black_box()), expected)


func test_extra_text_follows_the_text_after_one_line_break() -> void:
	set_string("MessageCore.toastResource", TOAST)
	assert_true(await start_prepared())
	var args: FormatArgs = FormatArgs.new()
	args.set_int("count", 3)
	MessageCore.show_toast(key_a(), null, "code 42")
	MessageCore.show_black_box(count_key(), args, "code 43")
	assert_eq(shown_text(toast()), LocalizationCore.get_text(key_a()) + "\ncode 42")
	assert_eq(shown_text(black_box()), LocalizationCore.format(count_key(), args) + "\ncode 43")


func test_text_does_not_change_when_caller_changes_format_args_after_request() -> void:
	assert_true(await start_prepared())
	var args: FormatArgs = FormatArgs.new()
	args.set_int("count", 3)
	MessageCore.show_toast(count_key(), args)
	MessageCore.show_black_box(count_key(), args)
	MessageCore.show_black_box(count_key(), args)
	args.clear()
	args.set_int("count", 7)
	assert_eq(shown_text(toast()), "3 items for you")
	assert_eq(shown_text(black_box()), "3 items for you")
	await advance(BLACK_BOX_MS)
	assert_eq(shown_text(black_box()), "3 items for you", "the waiting black box keeps its text")
