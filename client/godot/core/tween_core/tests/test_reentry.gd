extends "res://core/tween_core/tests/support/tween_test_case.gd"
## Receivers and property writes that end their own tween, or start another one, during its frame or end processing:
## each tween ends once and the later tweens play on.

const _END_VALUE: float = 10.0

## What `_act_on_end_value` does when it gets the end value: "stop", "skip" or "replay".
var _action: String = ""
var _handle: int = 0
## The value tween "replay" starts.
var _replayed: int = 0
var _end_values: int = 0
var _control: Control = null


func before_each() -> void:
	super()
	_action = ""
	_handle = 0
	_replayed = 0
	_end_values = 0
	_control = null


func test_a_receiver_that_stops_its_tween_on_the_last_frame_value_ends_it_once() -> void:
	start()
	_action = "stop"
	_handle = _play_value(50)
	recorder.wait(_handle, 0)
	await advance(50)
	assert_false(TweenCore.is_playing(_handle))
	assert_eq(recorder.waits, {0: TweenCore.TweenEndReason.STOPPED})
	assert_eq(_end_values, 1)
	_assert_no_tween()
	await _assert_a_later_tween_completes()


func test_a_receiver_that_skips_its_tween_on_the_last_frame_value_ends_it_once() -> void:
	start()
	_action = "skip"
	_handle = _play_value(50)
	recorder.wait(_handle, 0)
	await advance(50)
	assert_false(TweenCore.is_playing(_handle))
	assert_eq(recorder.waits, {0: TweenCore.TweenEndReason.SKIPPED})
	assert_eq(_end_values, 2, "the last frame value and the end state")
	_assert_no_tween()
	await _assert_a_later_tween_completes()


func test_a_receiver_that_skips_its_tween_again_in_the_end_state_ends_it_once() -> void:
	start()
	_action = "skip"
	_handle = _play_value(100)
	recorder.wait(_handle, 0)
	TweenCore.skip_to_end(_handle)
	assert_false(TweenCore.is_playing(_handle))
	assert_eq(_end_values, 1)
	await frame_end()
	assert_eq(recorder.waits, {0: TweenCore.TweenEndReason.SKIPPED})
	_assert_no_tween()
	await _assert_a_later_tween_completes()


func test_a_receiver_that_stops_its_tween_and_plays_another_on_the_last_value_does_not_end_the_new_one() -> void:
	start()
	_action = "replay"
	_handle = _play_value(50)
	recorder.wait(_handle, 0)
	await advance(50)
	assert_eq(recorder.waits, {0: TweenCore.TweenEndReason.STOPPED})
	assert_ne(_replayed, 0)
	assert_true(TweenCore.is_playing(_replayed), "the new tween in the freed slot plays on")
	recorder.wait(_replayed, 1)
	await advance(100)
	assert_eq(recorder.waits[1], TweenCore.TweenEndReason.COMPLETED)
	assert_eq(recorder.floats[recorder.floats.size() - 1], 4.0)
	_assert_no_tween()


func test_a_property_write_that_stops_its_tween_on_the_last_value_ends_it_once() -> void:
	start()
	_control = keep(Control.new()) as Control
	_control.item_rect_changed.connect(_stop_on_target_value)
	_handle = TweenCore.play(move(50), _control, options())
	await advance(50)
	assert_eq(_control.position.x, 100.0)
	assert_eq(recorder.reasons, PackedInt32Array([TweenCore.TweenEndReason.STOPPED]))
	_assert_no_tween()
	_control.item_rect_changed.disconnect(_stop_on_target_value)
	await _assert_a_later_tween_completes()


func _play_value(duration: int) -> int:
	return TweenCore.play_value(
		TweenCore.TweenValueKind.FLOAT, Vector4.ZERO, Vector4(_END_VALUE, 0, 0, 0), move(duration), _act_on_end_value
	)


func _act_on_end_value(value: float) -> void:
	if value != _END_VALUE:
		return
	_end_values += 1
	match _action:
		"stop":
			TweenCore.stop(_handle)
		"skip":
			TweenCore.skip_to_end(_handle)
		"replay":
			TweenCore.stop(_handle)
			_action = ""
			_replayed = TweenCore.play_value(
				TweenCore.TweenValueKind.FLOAT, Vector4.ZERO, Vector4(4, 0, 0, 0), move(100), recorder.on_float
			)


func _stop_on_target_value() -> void:
	if _control.position.x == 100.0:
		TweenCore.stop(_handle)


func _assert_no_tween() -> void:
	assert_eq(TweenCore._active_count, 0)
	assert_eq(TweenCore._free_count, TweenCore._slot_count, "every slot is free once")
	assert_eq(TweenCore._property_count, 0)


func _assert_a_later_tween_completes() -> void:
	var target: Node2D = node_2d()
	recorder.reasons.clear()
	var later: int = TweenCore.play(move(50), target, options())
	await advance(50)
	assert_false(TweenCore.is_playing(later))
	assert_eq(target.position.x, 100.0)
	assert_eq(recorder.reasons, PackedInt32Array([TweenCore.TweenEndReason.COMPLETED]))
	_assert_no_tween()
