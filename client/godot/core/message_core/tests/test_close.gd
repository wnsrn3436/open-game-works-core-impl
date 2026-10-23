extends "res://core/message_core/tests/support/message_test_case.gd"
## Kind close, `close_black_box`, `close_all` and display failures.


func test_close_black_box_empties_black_boxes_and_toast_goes_on() -> void:
	use_prefabs_with_tweens()
	assert_true(await start_prepared())
	MessageCore.show_toast(key_a())
	MessageCore.show_toast(key_b())
	MessageCore.show_black_box(key_a())
	MessageCore.show_black_box(key_b())
	var tween: int = black_box().tween_handle
	MessageCore.close_black_box()
	assert_nothing_shown(black_box())
	assert_false(MessageCore._black_box_object.visible)
	assert_false(TweenCore.is_playing(tween))
	assert_eq(toast().phase, MessageCore._KIND_STATE.Phase.ENTER)
	assert_eq(toast().waiting_count(), 1)
	await advance(TWEEN_MS)
	await advance(TOAST_MS)
	await advance(TWEEN_MS)
	assert_eq(toast().text, LocalizationCore.get_text(key_b()))
	assert_nothing_shown(black_box())


func test_close_all_lowers_both_kinds_and_returns_borrowed_toast_objects() -> void:
	use_prefabs_with_tweens()
	set_int("PoolCore.defaultPrefillCount", 1)
	assert_true(await start_prepared())
	MessageCore.show_toast(key_a())
	MessageCore.show_toast(key_b())
	MessageCore.show_black_box(key_a())
	MessageCore.show_black_box(key_b())
	var tween: int = toast().tween_handle
	MessageCore.close_all()
	assert_nothing_shown(toast())
	assert_nothing_shown(black_box())
	assert_false(TweenCore.is_playing(tween))
	assert_eq(borrowed_toasts(), 0)
	var pool: Vector2i = PoolCore.get_pool_state(TOAST, ResourceCore.get_global_scope())
	assert_eq(pool.y, 0)
	assert_eq(pool.x, 1)
	MessageCore.show_toast(key_c())
	MessageCore.show_toast(key_a())
	assert_eq(toast().text, LocalizationCore.get_text(key_c()))
	assert_eq(toast().phase, MessageCore._KIND_STATE.Phase.ENTER)
	assert_eq(toast().waiting_count(), 1)
	await advance(TWEEN_MS)
	await advance(TOAST_MS)
	await advance(TWEEN_MS)
	assert_eq(toast().text, LocalizationCore.get_text(key_a()))


func test_black_box_after_its_object_was_destroyed_outside_shows_with_a_new_object() -> void:
	set_string("MessageCore.blackBoxResource", BLACK_BOX)
	assert_true(await start_prepared())
	var old: Control = MessageCore._black_box_object
	old.free()
	MessageCore.show_black_box(key_a())
	assert_eq(black_box().phase, MessageCore._KIND_STATE.Phase.HOLD)
	assert_true(is_instance_valid(MessageCore._black_box_object))
	assert_true(MessageCore._black_box_object.visible)
	assert_eq(shown_text(black_box()), LocalizationCore.get_text(key_a()))


func test_message_object_destroyed_while_shown_ends_with_one_error_and_next_shows() -> void:
	set_string("MessageCore.toastResource", TOAST)
	set_string("MessageCore.blackBoxResource", BLACK_BOX)
	assert_true(await start_prepared())
	MessageCore.show_toast(key_a())
	MessageCore.show_toast(key_b())
	MessageCore.show_black_box(key_a())
	MessageCore.show_black_box(key_b())
	toast().object.free()
	black_box().object.free()
	await UnitTestCore.wait_frames(2)
	assert_eq(errors(MessageCore._TAG), 2)
	assert_gt(errors("PoolCore"), 0)
	assert_eq(toast().text, LocalizationCore.get_text(key_b()))
	assert_eq(black_box().text, LocalizationCore.get_text(key_b()))
	assert_true(is_instance_valid(black_box().object))
	assert_true(InputBlockCore.is_active(black_box().block_token))
	assert_eq(InputBlockCoreDev.count_active(), 1)


func test_toast_whose_object_could_not_be_borrowed_is_dropped_and_next_toast_shows() -> void:
	set_string("MessageCore.toastResource", TOAST)
	assert_true(await start_prepared())
	PoolCore.release()
	MessageCore.show_toast(key_a())
	assert_eq(errors(MessageCore._TAG), 1)
	assert_gt(errors("PoolCore"), 0)
	assert_nothing_shown(toast())
	MessageCore.show_toast(key_b())
	assert_eq(errors(MessageCore._TAG), 1)
	assert_gt(errors("PoolCore"), 0)
	assert_true(PoolCore.init())
	MessageCore.show_toast(key_c())
	assert_eq(toast().phase, MessageCore._KIND_STATE.Phase.HOLD)
	assert_eq(shown_text(toast()), LocalizationCore.get_text(key_c()))


func test_black_box_whose_block_could_not_be_made_is_not_shown() -> void:
	set_string("MessageCore.blackBoxResource", BLACK_BOX)
	assert_true(await start_prepared())
	InputBlockCore.release()
	MessageCore.show_black_box(key_a())
	assert_gt(errors("InputBlockCore"), 0)
	assert_eq(errors(MessageCore._TAG), 0)
	assert_nothing_shown(black_box())
	assert_false(MessageCore._black_box_object.visible)
	assert_true(InputBlockCore.init())
	MessageCore.show_black_box(key_b())
	assert_eq(black_box().phase, MessageCore._KIND_STATE.Phase.HOLD)
	assert_true(MessageCore._black_box_object.visible)


func test_queued_toasts_that_could_not_be_borrowed_are_all_dropped_in_the_same_pass() -> void:
	set_string("MessageCore.toastResource", TOAST)
	assert_true(await start_prepared())
	MessageCore.show_toast(key_a())
	MessageCore.show_toast(key_b())
	MessageCore.show_toast(key_c())
	assert_eq(toast().waiting_count(), 2)
	# PoolCore release destroys the toast object on screen and makes every later borrow fail.
	PoolCore.release()
	await UnitTestCore.wait_frames(2)
	assert_eq(errors(MessageCore._TAG), 3, "the destroyed toast and each queued toast that could not borrow")
	assert_gt(errors("PoolCore"), 0)
	assert_nothing_shown(toast())


func test_queued_black_boxes_whose_blocks_could_not_be_made_are_all_dropped_in_the_same_pass() -> void:
	set_string("MessageCore.blackBoxResource", BLACK_BOX)
	assert_true(await start_prepared())
	MessageCore.show_black_box(key_a())
	MessageCore.show_black_box(key_b())
	MessageCore.show_black_box(key_c())
	assert_eq(black_box().waiting_count(), 2)
	InputBlockCore.release()
	await advance(BLACK_BOX_MS)
	assert_gt(errors("InputBlockCore"), 0)
	assert_eq(errors(MessageCore._TAG), 0)
	assert_nothing_shown(black_box())
	assert_false(MessageCore._black_box_object.visible)
	assert_true(InputBlockCore.init())
	MessageCore.show_black_box(key_a())
	assert_eq(black_box().phase, MessageCore._KIND_STATE.Phase.HOLD)
	assert_true(MessageCore._black_box_object.visible)
