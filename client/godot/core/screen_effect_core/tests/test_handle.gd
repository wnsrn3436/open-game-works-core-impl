extends "res://core/screen_effect_core/tests/support/screen_effect_test_case.gd"
## Effect handles: replacement and the result that is set once.


func test_new_request_cancels_the_replaced_handle_whose_clear_handle_keeps_the_new_effect() -> void:
	assert_true(await start_modules())
	var owner: Node = make_owner()
	var first: ScreenEffectHandle = ScreenEffectCore.fade(WORLD, owner, Color.RED, 0.0, 1.0, 1000)
	record(first)
	assert_eq(results.size(), 0, "the first fade plays")
	var second: ScreenEffectHandle = ScreenEffectCore.fade(WORLD, owner, Color.BLUE, 0.0, 0.5, 1000)
	assert_results([CANCELLED])
	await advance(500)
	var before: GetOverlayStateResult = state(WORLD)
	ScreenEffectCore.clear_handle(first)
	ScreenEffectCore.skip_to_end(first)
	assert_overlay(WORLD, Color.BLUE, before.opacity, true, "after clear_handle of the replaced handle")
	record(second)
	assert_eq(results.size(), 1, "the second fade still plays")
	await advance(600)
	assert_results([CANCELLED, COMPLETED])
	assert_overlay(WORLD, Color.BLUE, 0.5, true, "the second fade ended")


func test_duration_zero_sets_completed_once() -> void:
	assert_true(await start_modules())
	var handle: ScreenEffectHandle = ScreenEffectCore.fade(WORLD, make_owner(), Color.WHITE, 0.0, 1.0, 0)
	assert_true(is_settled(handle))
	assert_true(is_settled(handle))
	ScreenEffectCore.skip_to_end(handle)
	ScreenEffectCore.clear_handle(handle)
	assert_true(is_settled(handle))
	assert_results([COMPLETED, COMPLETED, COMPLETED])


func test_normal_completion_sets_completed_once() -> void:
	assert_true(await start_modules())
	var handle: ScreenEffectHandle = ScreenEffectCore.fade(WORLD, make_owner(), Color.WHITE, 0.0, 1.0, 300)
	record(handle)
	record(handle)
	await advance(400)
	assert_results([COMPLETED, COMPLETED])
	ScreenEffectCore.fade(WORLD, make_owner(), Color.WHITE, 0.0, 1.0, 300)
	assert_true(is_settled(handle))
	assert_eq(results[2], COMPLETED, "a later replacement does not change the result")


func test_skip_to_end_sets_completed_once() -> void:
	assert_true(await start_modules())
	var handle: ScreenEffectHandle = ScreenEffectCore.fade(WORLD, make_owner(), Color.GREEN, 0.0, 0.7, 1000)
	record(handle)
	ScreenEffectCore.skip_to_end(handle)
	assert_results([COMPLETED])
	assert_overlay(WORLD, Color.GREEN, 0.7, true, "skip_to_end puts the end value")
	ScreenEffectCore.skip_to_end(handle)
	ScreenEffectCore.clear_handle(handle)
	assert_true(is_settled(handle))
	assert_results([COMPLETED, COMPLETED])


func test_replacement_sets_cancelled_once() -> void:
	assert_true(await start_modules())
	var owner: Node = make_owner()
	var handle: ScreenEffectHandle = ScreenEffectCore.flash(CUTSCENE, owner, Color.WHITE, 1.0, 100, 100, 100)
	record(handle)
	ScreenEffectCore.flash(CUTSCENE, owner, Color.WHITE, 1.0, 100, 100, 100)
	ScreenEffectCore.flash(CUTSCENE, owner, Color.WHITE, 1.0, 100, 100, 100)
	assert_results([CANCELLED])
	await advance(400)
	assert_true(is_settled(handle))
	assert_results([CANCELLED, CANCELLED])


func test_owner_destruction_sets_cancelled_once() -> void:
	assert_true(await start_modules())
	var owner: Node = Node.new()
	add_child(owner)
	var handle: ScreenEffectHandle = ScreenEffectCore.fade(TRANSITION, owner, Color.BLACK, 0.0, 1.0, 1000)
	record(handle)
	owner.free()
	await UnitTestCore.wait_frames(2)
	assert_results([CANCELLED])
	await advance(1100)
	assert_true(is_settled(handle))
	assert_results([CANCELLED, CANCELLED])
	assert_no_effect(TRANSITION)


func test_release_sets_cancelled_once() -> void:
	assert_true(await start_modules())
	var handle: ScreenEffectHandle = ScreenEffectCore.fade(WORLD, make_owner(), Color.BLACK, 0.0, 1.0, 1000)
	record(handle)
	ScreenEffectCore.release()
	assert_results([CANCELLED])
	assert_true(ScreenEffectCore.init())
	assert_true(is_settled(handle))
	assert_results([CANCELLED, CANCELLED])



func test_effect_handle_has_no_signal() -> void:
	assert_true(await start_modules())
	var handle: ScreenEffectHandle = ScreenEffectCore.fade(WORLD, make_owner(), Color.WHITE, 0.0, 1.0, 1000)
	var script: Script = ScreenEffectHandle
	assert_true(is_instance_of(handle, script))
	assert_eq(script.get_script_signal_list().size(), 0, "content code holding the handle has no signal to connect to")
