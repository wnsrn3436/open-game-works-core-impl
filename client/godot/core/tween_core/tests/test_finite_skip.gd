extends "res://core/tween_core/tests/support/tween_test_case.gd"
## The DEV finite skip of `TweenCoreDev.set_finite_skip`.

## Number of tweens in a chain of skipped tweens.
const CHAIN_LENGTH: int = 5
const _RECEIVER := preload("res://core/tween_core/tests/support/tween_test_receiver.gd")
const _STATS := preload("res://core/tween_core/tests/support/tween_test_receiver_stats.gd")


## Waits until the load of the tween preset `key` has ended.
func load_end(key: String) -> void:
	await ResourceCore.load(key, TweenCore.get_preset_kind(), ResourceCore.get_global_scope())
	await frame_end()


func test_finite_tween_requested_during_the_skip_completes_at_its_end_state_in_the_frame_without_started_event(
) -> void:
	start()
	TweenCoreDev.set_finite_skip(true)
	var target: Node2D = node_2d()
	var handle: int = TweenCore.play(move(500, 2), target, options())
	recorder.wait(handle, 0)
	assert_true(TweenCore.is_playing(handle), "playing when the operation returns")
	assert_eq(recorder.reasons.size(), 0)
	await frame_end()
	assert_eq(target.position, Vector2(100, 0))
	assert_false(TweenCore.is_playing(handle))
	assert_eq(recorder.reasons, PackedInt32Array([TweenCore.TweenEndReason.COMPLETED]))
	assert_eq(recorder.waits, {0: TweenCore.TweenEndReason.COMPLETED})
	assert_eq(recorder.started_count, 0)


func test_value_tween_during_the_skip_calls_the_receiver_with_the_end_value_once() -> void:
	start()
	TweenCoreDev.set_finite_skip(true)
	var handle: int = TweenCore.play_value(
		TweenCore.TweenValueKind.FLOAT, Vector4(10, 0, 0, 0), Vector4(20, 0, 0, 0), move(500), recorder.on_float
	)
	recorder.wait(handle, 0)
	await frame_end()
	assert_eq(recorder.floats, PackedFloat64Array([20.0]))
	assert_eq(recorder.waits, {0: TweenCore.TweenEndReason.COMPLETED})
	assert_eq(recorder.started_count, 0)


func test_forever_tween_and_tween_started_before_the_skip_play_on() -> void:
	start()
	var before: Node2D = node_2d()
	var earlier: int = TweenCore.play(move(100), before, options())
	assert_eq(recorder.started_count, 1)
	TweenCoreDev.set_finite_skip(true)
	var forever_target: Node2D = node_2d()
	var forever: int = TweenCore.play(move(500, 0), forever_target, options())
	assert_eq(recorder.started_count, 2, "a forever tween publishes TweenStartedEvent")
	await advance(50)
	assert_almost_eq(before.position.x, 50.0, 0.001, "the earlier tween keeps progressing")
	assert_true(TweenCore.is_playing(earlier))
	assert_almost_eq(forever_target.position.x, 10.0, 0.001, "the forever tween plays")
	await advance(50)
	assert_eq(before.position, Vector2(100, 0))
	assert_false(TweenCore.is_playing(earlier))
	assert_true(TweenCore.is_playing(forever))
	TweenCore.stop(forever)


func test_input_block_of_a_skipped_tween_is_lifted_when_it_ends() -> void:
	start()
	TweenCoreDev.set_finite_skip(true)
	var handle: int = TweenCore.play(move(500, 2), node_2d(), options("", true))
	assert_eq(tween_blocks(), 1)
	await frame_end()
	assert_false(TweenCore.is_playing(handle))
	assert_eq(tween_blocks(), 0)


func test_tween_after_the_skip_is_turned_off_progresses_over_its_duration() -> void:
	start()
	TweenCoreDev.set_finite_skip(true)
	TweenCoreDev.set_finite_skip(false)
	var target: Node2D = node_2d()
	var handle: int = TweenCore.play(move(500, 2), target, options())
	assert_eq(recorder.started_count, 1)
	await advance(250)
	assert_almost_eq(target.position.x, 50.0, 0.001)
	assert_true(TweenCore.is_playing(handle))
	await advance(500)
	assert_true(TweenCore.is_playing(handle), "the second cycle plays")
	assert_almost_eq(target.position.x, 50.0, 0.001)
	await advance(250)
	assert_false(TweenCore.is_playing(handle))
	assert_eq(target.position, Vector2(100, 0))
	assert_eq(recorder.reasons, PackedInt32Array([TweenCore.TweenEndReason.COMPLETED]))


func test_skip_of_a_loading_preset_is_decided_at_its_request() -> void:
	start()
	var scope: Scope = ResourceCore.get_global_scope()
	var before: Node2D = node_2d()
	var earlier: int = TweenCore.play_preset(MOVE, scope, before, options())
	TweenCoreDev.set_finite_skip(true)
	var during: Node2D = node_2d()
	var skipped: int = TweenCore.play_preset(MOVE, scope, during, options())
	TweenCoreDev.set_finite_skip(false)
	assert_true(TweenCore.is_playing(skipped), "playing while it loads")
	await load_end(MOVE)
	assert_eq(during.position, Vector2(100, 0))
	assert_false(TweenCore.is_playing(skipped))
	assert_eq(recorder.reasons, PackedInt32Array([TweenCore.TweenEndReason.COMPLETED]))
	assert_eq(recorder.started_count, 1, "only the preset requested before the skip starts")
	assert_true(TweenCore.is_playing(earlier))
	await advance(50)
	assert_almost_eq(before.position.x, 50.0, 0.001)


func test_preset_requested_before_the_skip_plays_when_its_load_ends_while_the_skip_is_on() -> void:
	start()
	var target: Node2D = node_2d()
	var handle: int = TweenCore.play_preset(MOVE, ResourceCore.get_global_scope(), target, options())
	recorder.wait(handle, 0)
	assert_eq(recorder.started_count, 0, "the preset is loading")
	TweenCoreDev.set_finite_skip(true)
	await load_end(MOVE)
	assert_eq(recorder.started_count, 1, "TweenStartedEvent is published when the playback starts")
	assert_true(TweenCore.is_playing(handle))
	await advance(50)
	assert_almost_eq(target.position.x, 50.0, 0.001)
	assert_true(TweenCore.is_playing(handle))
	assert_eq(recorder.reasons.size(), 0)
	await advance(50)
	assert_eq(target.position, Vector2(100, 0))
	assert_false(TweenCore.is_playing(handle))
	assert_eq(recorder.reasons, PackedInt32Array([TweenCore.TweenEndReason.COMPLETED]))
	assert_eq(recorder.waits, {0: TweenCore.TweenEndReason.COMPLETED})


## Process frames of the `Completed` ends of a chain of skipped tweens.
var _chain_frames: PackedInt64Array = PackedInt64Array()
var _chain_target: Node2D = null


func _replay(reason: TweenCore.TweenEndReason) -> void:
	if reason != TweenCore.TweenEndReason.COMPLETED:
		return
	_chain_frames.append(Engine.get_process_frames())
	if _chain_frames.size() < CHAIN_LENGTH:
		TweenCore.play(move(100), _chain_target, _chain_options())


func _chain_options() -> TweenOptions:
	var made: TweenOptions = options()
	made.callback = _replay
	return made


## Plays a finite tween and waits for its `wait_end`, `CHAIN_LENGTH` times. Not awaited by the caller.
func _play_and_wait_loop(target: Node2D) -> void:
	for i: int in CHAIN_LENGTH:
		var handle: int = TweenCore.play(move(100), target, options())
		var reason: TweenCore.TweenEndReason = await TweenCore.wait_end(handle)
		if reason != TweenCore.TweenEndReason.COMPLETED:
			return
		_chain_frames.append(Engine.get_process_frames())


## Each `Completed` of the chain is in the frame after the one before it.
func assert_one_end_per_frame() -> void:
	assert_eq(_chain_frames.size(), CHAIN_LENGTH, "every tween of the chain completed")
	for i: int in range(1, _chain_frames.size()):
		assert_eq(_chain_frames[i] - _chain_frames[i - 1], 1, "one Completed per frame (end %d)" % i)


func test_completion_callback_that_plays_a_finite_tween_again_gets_one_completed_per_frame() -> void:
	start()
	TweenCoreDev.set_finite_skip(true)
	_chain_frames.clear()
	_chain_target = node_2d()
	var first: int = Engine.get_process_frames()
	TweenCore.play(move(100), _chain_target, _chain_options())
	await UnitTestCore.wait_frames(CHAIN_LENGTH + 2)
	assert_one_end_per_frame()
	assert_eq(_chain_frames[0], first, "the first tween ends in the frame it was requested")
	assert_eq(_chain_target.position, Vector2(100, 0))
	assert_eq(recorder.started_count, 0)


func test_loop_that_plays_a_finite_tween_and_waits_for_its_wait_end_gets_one_completed_per_frame() -> void:
	start()
	TweenCoreDev.set_finite_skip(true)
	_chain_frames.clear()
	var target: Node2D = node_2d()
	var first: int = Engine.get_process_frames()
	_play_and_wait_loop(target)
	await UnitTestCore.wait_frames(CHAIN_LENGTH + 2)
	assert_one_end_per_frame()
	assert_eq(_chain_frames[0], first, "the first tween ends in the frame it was requested")
	assert_eq(recorder.started_count, 0)


## Process frames of the tween that requested a pair of skipped tweens (`first`) and of the pair (`a`, `b`).
var _pair_frames: Dictionary[String, int] = {}
var _pair_targets: Array[Node2D] = []


func _play_pair(reason: TweenCore.TweenEndReason) -> void:
	if reason != TweenCore.TweenEndReason.COMPLETED:
		return
	_pair_frames["first"] = Engine.get_process_frames()
	var names: PackedStringArray = PackedStringArray(["a", "b"])
	for i: int in names.size():
		var made: TweenOptions = options()
		made.callback = _mark_pair.bind(names[i])
		TweenCore.play(move(100), _pair_targets[i], made)


func _mark_pair(reason: TweenCore.TweenEndReason, name: String) -> void:
	if reason == TweenCore.TweenEndReason.COMPLETED:
		_pair_frames[name] = Engine.get_process_frames()


func test_completion_callback_that_plays_two_finite_tweens_ends_both_in_the_next_frame() -> void:
	start()
	TweenCoreDev.set_finite_skip(true)
	_pair_frames.clear()
	# the first tween frees the lowest slot before its callback: `a` takes it again and `b` takes a higher one
	_pair_targets = [node_2d(), node_2d()]
	var made: TweenOptions = options()
	made.callback = _play_pair
	var first: int = Engine.get_process_frames()
	TweenCore.play(move(100), node_2d(), made)
	await UnitTestCore.wait_frames(3)
	var ended: Dictionary[String, int] = {"first": first, "a": first + 1, "b": first + 1}
	assert_eq(_pair_frames, ended, "the first tween ends in the frame it was requested, a and b in the next frame")
	assert_eq(_pair_targets[0].position, Vector2(100, 0))
	assert_eq(_pair_targets[1].position, Vector2(100, 0))
	assert_eq(recorder.started_count, 0)


## Plays a skipped value tween from a completion callback and moves the test clock while it waits for the skip end of
## the next frame.
func _play_value_and_move_the_clock(reason: TweenCore.TweenEndReason) -> void:
	if reason != TweenCore.TweenEndReason.COMPLETED:
		return
	var handle: int = TweenCore.play_value(
		TweenCore.TweenValueKind.FLOAT, Vector4(10, 0, 0, 0), Vector4(20, 0, 0, 0), move(100), recorder.on_float
	)
	recorder.wait(handle, 0)
	UnitTestCore.advance_clock(50, false)


func test_skipped_tween_waiting_for_the_next_frame_does_not_progress_while_the_clock_moves() -> void:
	start()
	TweenCoreDev.set_finite_skip(true)
	var made: TweenOptions = options()
	made.callback = _play_value_and_move_the_clock
	TweenCore.play(move(100), node_2d(), made)
	await UnitTestCore.wait_frames(3)
	assert_eq(recorder.floats, PackedFloat64Array([20.0]), "the receiver gets only the end value, once")
	assert_eq(recorder.waits, {0: TweenCore.TweenEndReason.COMPLETED})
	assert_eq(recorder.started_count, 0)


var _doomed_target: Node2D = null
var _doomed_receiver: _RECEIVER = null


## Plays a skipped tween on a target and a skipped value tween on a receiver from a completion callback, and queues the
## target and the receiver for destruction at the end of this frame, while the tweens wait for the next frame.
func _play_on_doomed(reason: TweenCore.TweenEndReason) -> void:
	if reason != TweenCore.TweenEndReason.COMPLETED:
		return
	recorder.wait(TweenCore.play(move(100), _doomed_target, options()), 0)
	recorder.wait(TweenCore.play_value(
		TweenCore.TweenValueKind.FLOAT, Vector4(10, 0, 0, 0), Vector4(20, 0, 0, 0), move(100),
		_doomed_receiver.on_float
	), 1)
	_doomed_target.queue_free()
	_doomed_receiver.queue_free()


func test_skipped_tween_whose_target_is_destroyed_while_it_waits_ends_with_target_destroyed() -> void:
	start()
	TweenCoreDev.set_finite_skip(true)
	_doomed_target = node_2d()
	_doomed_receiver = keep(_RECEIVER.new()) as _RECEIVER
	var stats: _STATS = _doomed_receiver.stats
	var made: TweenOptions = options()
	made.callback = _play_on_doomed
	TweenCore.play(move(100), node_2d(), made)
	await UnitTestCore.wait_frames(3)
	assert_false(is_instance_valid(_doomed_target), "the target was destroyed")
	assert_eq(recorder.reasons, PackedInt32Array([TweenCore.TweenEndReason.TARGET_DESTROYED]), "one callback call")
	assert_eq(recorder.waits, {
		0: TweenCore.TweenEndReason.TARGET_DESTROYED, 1: TweenCore.TweenEndReason.TARGET_DESTROYED
	})
	assert_eq(stats.calls, 0, "the destroyed receiver is not called")
	assert_eq(errors(), 0)


func test_release_turns_the_skip_off_and_it_fails_before_init() -> void:
	start()
	TweenCoreDev.set_finite_skip(true)
	TweenCore.release()
	assert_true(TweenCore.init())
	var target: Node2D = node_2d()
	TweenCore.play(move(100), target, options())
	assert_eq(recorder.started_count, 1)
	await advance(50)
	assert_almost_eq(target.position.x, 50.0, 0.001)
	TweenCore.release()
	TweenCoreDev.set_finite_skip(true)
	assert_eq(errors(), 1)
	assert_true(TweenCore.init())
	TweenCore.play(move(100), node_2d(), options())
	assert_eq(recorder.started_count, 2, "the skip stays off")
