extends "res://core/screen_effect_core/tests/support/screen_effect_test_case.gd"
## Cleanup: owner destruction, clear_owner and clear_handle.


func test_fade_that_kept_its_end_value_is_cleared_when_its_owner_is_destroyed() -> void:
	assert_true(await start_modules())
	var owner: Node = Node.new()
	add_child(owner)
	var handle: ScreenEffectHandle = ScreenEffectCore.fade(WORLD, owner, Color.RED, 0.0, 0.8, 100)
	await advance(200)
	assert_true(is_settled(handle))
	assert_results([COMPLETED])
	assert_overlay(WORLD, Color.RED, 0.8, true, "the fade keeps its end value")
	owner.free()
	await UnitTestCore.wait_frames(2)
	assert_no_effect(WORLD, "after the owner was destroyed")


func test_clear_owner_clears_every_channel_of_that_owner_only() -> void:
	assert_true(await start_modules())
	var owner: Node = make_owner()
	var other: Node = make_owner()
	var world: ScreenEffectHandle = ScreenEffectCore.fade(WORLD, owner, Color.WHITE, 0.0, 1.0, 1000)
	var cutscene: ScreenEffectHandle = ScreenEffectCore.fade(CUTSCENE, owner, Color.WHITE, 0.0, 1.0, 0)
	ScreenEffectCore.fade(TRANSITION, other, Color.WHITE, 0.0, 1.0, 0)
	record(world)
	record(cutscene)
	ScreenEffectCore.clear_owner(owner)
	assert_results([COMPLETED, CANCELLED])
	assert_no_effect(WORLD)
	assert_no_effect(CUTSCENE)
	assert_overlay(TRANSITION, Color.WHITE, 1.0, true, "the other owner keeps its effect")
	ScreenEffectCore.clear_owner(null)
	assert_overlay(TRANSITION, Color.WHITE, 1.0, true, "clear_owner of none")


func test_clear_handle_cancels_a_playing_effect_and_none_handle_does_nothing() -> void:
	assert_true(await start_modules())
	var handle: ScreenEffectHandle = ScreenEffectCore.fade(WORLD, make_owner(), Color.WHITE, 0.0, 1.0, 1000)
	record(handle)
	ScreenEffectCore.clear_handle(null)
	ScreenEffectCore.skip_to_end(null)
	assert_eq(results.size(), 0)
	ScreenEffectCore.clear_handle(handle)
	assert_results([CANCELLED])
	assert_no_effect(WORLD)
