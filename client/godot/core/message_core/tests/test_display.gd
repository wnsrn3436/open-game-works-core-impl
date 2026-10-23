extends "res://core/message_core/tests/support/message_test_case.gd"
## Display steps: enter tween, display time, exit tween, real elapsed time and the prefab values of step 1.


func test_toast_exit_starts_after_enter_tween_and_toast_duration() -> void:
	use_prefabs_with_tweens()
	assert_true(await start_prepared())
	MessageCore.show_toast(key_a())
	await _assert_steps(toast(), TOAST_MS)


func test_black_box_exit_starts_after_enter_tween_and_black_box_duration() -> void:
	use_prefabs_with_tweens()
	assert_true(await start_prepared())
	MessageCore.show_black_box(key_a())
	await _assert_steps(black_box(), BLACK_BOX_MS)


func test_display_time_is_real_elapsed_time_under_pause_and_time_scale() -> void:
	use_prefabs_with_tweens()
	assert_true(await start_prepared())
	TimeCore.set_paused(true)
	TimeCore.set_time_scale(2000)
	MessageCore.show_toast(key_a())
	MessageCore.show_black_box(key_a())
	assert_eq(toast().phase, MessageCore._KIND_STATE.Phase.ENTER)
	assert_eq(black_box().phase, MessageCore._KIND_STATE.Phase.ENTER)
	await advance(TWEEN_MS)
	await advance(TOAST_MS - 1)
	assert_eq(toast().phase, MessageCore._KIND_STATE.Phase.HOLD)
	await advance(1)
	assert_eq(toast().phase, MessageCore._KIND_STATE.Phase.EXIT)
	await advance(BLACK_BOX_MS - TOAST_MS - 1)
	assert_eq(black_box().phase, MessageCore._KIND_STATE.Phase.HOLD)
	await advance(1)
	assert_eq(black_box().phase, MessageCore._KIND_STATE.Phase.EXIT)
	await advance(TWEEN_MS)
	assert_nothing_shown(toast())
	assert_nothing_shown(black_box())


func test_empty_tween_keys_skip_enter_and_exit() -> void:
	set_string("MessageCore.toastResource", TOAST)
	set_string("MessageCore.blackBoxResource", BLACK_BOX)
	assert_true(await start_prepared())
	MessageCore.show_toast(key_a())
	MessageCore.show_black_box(key_a())
	assert_eq(toast().phase, MessageCore._KIND_STATE.Phase.HOLD)
	assert_eq(black_box().phase, MessageCore._KIND_STATE.Phase.HOLD)
	assert_false(toast().tweening)
	await advance(TOAST_MS)
	assert_nothing_shown(toast())
	assert_eq(borrowed_toasts(), 0)
	await advance(BLACK_BOX_MS - TOAST_MS)
	assert_nothing_shown(black_box())
	assert_false(MessageCore._black_box_object.visible)


func test_black_box_after_faded_out_black_box_shows_with_prefab_opacity() -> void:
	set_string("MessageCore.blackBoxResource", BLACK_BOX)
	set_tweens("", "", "", FADE_OUT)
	assert_true(await start_prepared())
	var prefab_alpha: float = MessageCore._black_box_object.modulate.a
	MessageCore.show_black_box(key_a())
	MessageCore.show_black_box(key_b())
	await advance(BLACK_BOX_MS)
	assert_eq(black_box().phase, MessageCore._KIND_STATE.Phase.EXIT)
	await advance(TWEEN_MS)
	assert_eq(black_box().text, LocalizationCore.get_text(key_b()))
	assert_eq(black_box().phase, MessageCore._KIND_STATE.Phase.HOLD)
	assert_eq(MessageCore._black_box_object.modulate.a, prefab_alpha)
	assert_true(MessageCore._black_box_object.visible)


## Enter tween for `TWEEN_MS`, then `duration_ms` of display time before the exit tween, then lowered.
func _assert_steps(state: MessageCore._KIND_STATE, duration_ms: int) -> void:
	assert_eq(state.phase, MessageCore._KIND_STATE.Phase.ENTER)
	await advance(TWEEN_MS - 1)
	assert_eq(state.phase, MessageCore._KIND_STATE.Phase.ENTER)
	await advance(1)
	assert_eq(state.phase, MessageCore._KIND_STATE.Phase.HOLD)
	await advance(duration_ms - 1)
	assert_eq(state.phase, MessageCore._KIND_STATE.Phase.HOLD)
	await advance(1)
	assert_eq(state.phase, MessageCore._KIND_STATE.Phase.EXIT)
	assert_true(TweenCore.is_playing(state.tween_handle))
	await advance(TWEEN_MS)
	assert_nothing_shown(state)
