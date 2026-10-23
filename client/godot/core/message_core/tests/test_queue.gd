extends "res://core/message_core/tests/support/message_test_case.gd"
## Queue per kind: order, kinds that do not wait for each other, same text and borrowed toast objects.


func test_three_toasts_show_one_at_a_time_in_request_order() -> void:
	use_prefabs_with_tweens()
	assert_true(await start_prepared())
	await _assert_in_order(toast(), TOAST_MS, true)


func test_three_black_boxes_show_one_at_a_time_in_request_order() -> void:
	use_prefabs_with_tweens()
	assert_true(await start_prepared())
	await _assert_in_order(black_box(), BLACK_BOX_MS, false)


func test_toast_and_black_box_do_not_wait_for_each_other() -> void:
	use_prefabs_with_tweens()
	assert_true(await start_prepared())
	MessageCore.show_toast(key_a())
	MessageCore.show_black_box(key_b())
	assert_eq(black_box().phase, MessageCore._KIND_STATE.Phase.ENTER, "black box during a toast")
	assert_eq(black_box().waiting_count(), 0)
	await advance(TWEEN_MS)
	await advance(TOAST_MS)
	await advance(TWEEN_MS)
	assert_nothing_shown(toast())
	MessageCore.show_toast(key_c())
	assert_eq(toast().phase, MessageCore._KIND_STATE.Phase.ENTER, "toast during a black box")
	assert_eq(toast().waiting_count(), 0)
	assert_eq(black_box().phase, MessageCore._KIND_STATE.Phase.HOLD)


func test_toast_with_same_text_as_shown_or_waiting_toast_is_ignored_and_black_boxes_are_not() -> void:
	set_string("MessageCore.toastResource", TOAST)
	set_string("MessageCore.blackBoxResource", BLACK_BOX)
	assert_true(await start_prepared())
	MessageCore.show_toast(key_a())
	MessageCore.show_toast(key_b())
	MessageCore.show_toast(key_a())
	MessageCore.show_toast(key_b())
	assert_eq(toast().text, LocalizationCore.get_text(key_a()))
	assert_eq(toast().waiting_count(), 1)
	MessageCore.show_black_box(key_a())
	MessageCore.show_black_box(key_a())
	MessageCore.show_black_box(key_a())
	assert_eq(black_box().waiting_count(), 2)
	await advance(TOAST_MS)
	assert_eq(toast().text, LocalizationCore.get_text(key_b()))
	await advance(BLACK_BOX_MS - TOAST_MS)
	assert_eq(black_box().text, LocalizationCore.get_text(key_a()))
	assert_eq(black_box().waiting_count(), 1)
	await advance(2 * TOAST_MS - BLACK_BOX_MS)
	assert_nothing_shown(toast())
	await advance(2 * BLACK_BOX_MS - 2 * TOAST_MS)
	assert_eq(black_box().phase, MessageCore._KIND_STATE.Phase.HOLD)
	assert_eq(black_box().waiting_count(), 0)
	await advance(BLACK_BOX_MS)
	assert_nothing_shown(black_box())


func test_at_most_one_toast_object_is_borrowed_and_none_after_the_last_toast() -> void:
	use_prefabs_with_tweens()
	assert_true(await start_prepared())
	MessageCore.show_toast(key_a())
	MessageCore.show_toast(key_b())
	MessageCore.show_toast(key_c())
	var most: int = 0
	# Three toasts of enter 100 ms, display 1000 ms and exit 100 ms, in 100 ms steps.
	for _i: int in 36:
		most = maxi(most, borrowed_toasts())
		await advance(TWEEN_MS)
	assert_eq(most, 1)
	assert_nothing_shown(toast())
	assert_eq(borrowed_toasts(), 0)


## Three requests of different texts: each shows only after the one before is lowered.
func _assert_in_order(state: MessageCore._KIND_STATE, duration_ms: int, is_toast: bool) -> void:
	var keys: PackedStringArray = PackedStringArray([key_a(), key_b(), key_c()])
	for key: String in keys:
		if is_toast:
			MessageCore.show_toast(key)
		else:
			MessageCore.show_black_box(key)
	for i: int in keys.size():
		var text: String = LocalizationCore.get_text(keys[i])
		assert_eq(state.text, text)
		assert_eq(shown_text(state), text)
		assert_eq(state.waiting_count(), keys.size() - 1 - i)
		await advance(TWEEN_MS)
		await advance(duration_ms)
		assert_eq(state.phase, MessageCore._KIND_STATE.Phase.EXIT)
		assert_eq(state.text, text, "the next message waits for the exit tween")
		await advance(TWEEN_MS)
	assert_nothing_shown(state)
