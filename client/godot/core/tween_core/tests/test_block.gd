extends "res://core/tween_core/tests/support/tween_test_case.gd"
## The input block of a tween and its pass list.

const PASS_ACTION: StringName = &"back"


func test_input_block_tween_has_a_tween_block_until_each_end_reason() -> void:
	start()
	var completed: int = TweenCore.play(move(100), node_2d(), options("", true))
	assert_eq(tween_blocks(), 1)
	await advance(100)
	assert_false(TweenCore.is_playing(completed))
	assert_eq(tween_blocks(), 0, "Completed")
	TweenCore.skip_to_end(TweenCore.play(move(100), node_2d(), options("", true)))
	assert_eq(tween_blocks(), 0, "Skipped")
	var stopped: int = TweenCore.play(move(100), node_2d(), options("", true))
	assert_eq(tween_blocks(), 1)
	TweenCore.stop(stopped)
	assert_eq(tween_blocks(), 0, "Stopped")
	var target: Node2D = node_2d()
	TweenCore.play(move(100), target, options("", true))
	assert_eq(tween_blocks(), 1)
	target.free()
	await UnitTestCore.wait_frames(2)
	assert_eq(recorder.reasons[recorder.reasons.size() - 1], TweenCore.TweenEndReason.TARGET_DESTROYED)
	assert_eq(tween_blocks(), 0, "TargetDestroyed")


func test_loading_preset_has_its_input_block() -> void:
	start()
	var handle: int = TweenCore.play_preset(MOVE, ResourceCore.get_global_scope(), node_2d(), options("", true))
	assert_eq(recorder.started_count, 0, "the preset is loading")
	assert_eq(tween_blocks(), 1)
	TweenCore.stop(handle)
	assert_eq(tween_blocks(), 0)


func test_input_block_tween_that_repeats_forever_lifts_its_block_and_plays_on() -> void:
	start()
	var handle: int = TweenCore.play(move(100, 0), node_2d(), options("", true))
	assert_eq(errors(), 1)
	assert_eq(tween_blocks(), 0)
	assert_true(TweenCore.is_playing(handle))
	await advance(250)
	assert_true(TweenCore.is_playing(handle))
	TweenCore.stop(handle)


func test_pass_list_of_the_block_lets_its_action_pass() -> void:
	start()
	var pass_list: BlockPassList = BlockPassList.new()
	pass_list.actions = [PASS_ACTION]
	var passing: int = TweenCore.play(move(100), node_2d(), options("", true, pass_list))
	assert_true(InputBlockCore.pass_action(PASS_ACTION))
	TweenCore.stop(passing)
	var blocking: int = TweenCore.play(move(100), node_2d(), options("", true))
	assert_false(InputBlockCore.pass_action(PASS_ACTION))
	TweenCore.stop(blocking)
	assert_true(InputBlockCore.pass_action(PASS_ACTION))
