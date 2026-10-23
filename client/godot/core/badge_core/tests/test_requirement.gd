extends "res://core/badge_core/tests/support/badge_test_case.gd"
## Requirements: a badge whose requirement has not passed is off and does not propagate.


func test_badge_with_requirement_is_off_before_first_judgement() -> void:
	assert_true(await start_modules())
	assert_true(BadgeCore.set_count(locked_child_badge, 1))
	await frame_end()
	assert_eq(BadgeCore.get_count(locked_child_badge), 1, "the child is on")
	assert_eq(BadgeCore.get_count(locked_badge), 0, "not judged yet: off")
	assert_eq(BadgeCore.get_count(root_badge), 0, "not propagated")


func test_failed_requirement_blocks_propagation_and_user_state_delta_turns_it_on() -> void:
	assert_true(await start_modules())
	var potion: int = id_of("[potion]")
	Hooks.counts[gated_badge] = 3
	assert_true(BadgeCore.register_evaluator(gated_badge, Hooks.evaluate))
	assert_true(BadgeCore.set_count(locked_badge, 2))
	assert_true(BadgeCore.set_count(locked_child_badge, 1))
	assert_true(BadgeCore.set_count(a_badge, 1))
	await frame_end()
	assert_eq(BadgeCore.get_count(locked_child_badge), 1)
	assert_eq(BadgeCore.get_count(locked_badge), 0, "judged and failed")
	assert_eq(BadgeCore.get_count(gated_badge), 0, "judged and failed")
	assert_eq(BadgeCore.get_count(root_badge), 1, "only A propagates")
	events = PackedStringArray()
	put_balance(potion, 1)
	assert_eq(BadgeCore.get_count(locked_badge), 0, "judged at the frame end")
	await frame_end()
	assert_eq(BadgeCore.get_count(locked_badge), 3, "own count 2 and the child 1; no evaluator")
	assert_eq(BadgeCore.get_count(gated_badge), 3, "with an evaluator")
	assert_eq(BadgeCore.get_count(root_badge), 4)
	assert_eq(events, PackedStringArray([
		event_text(locked_badge, 0, 3),
		event_text(root_badge, 0, 4),
		event_text(gated_badge, 0, 3),
	]))
	put_balance(potion, 0)
	await frame_end()
	assert_eq(BadgeCore.get_count(locked_badge), 0)
	assert_eq(BadgeCore.get_count(gated_badge), 0)
	assert_eq(BadgeCore.get_count(root_badge), 1)


func test_requirement_is_judged_when_its_own_count_or_item_count_changes() -> void:
	assert_true(await start_modules(false))
	put_balance(id_of("[potion]"), 1)
	assert_true(BadgeCore.init())
	assert_true(BadgeCore.set_count(locked_badge, 1))
	await frame_end()
	assert_eq(BadgeCore.get_count(locked_badge), 1, "judged when its own count changed")
	assert_eq(BadgeCore.get_count(root_badge), 1)
	assert_true(BadgeCore.set_count(a_badge, 1))
	await frame_end()
	assert_eq(BadgeCore.get_count(gated_badge), 0, "Gated did not change: not judged yet")
	assert_true(BadgeCore.set_item(gated_badge, 4, 2))
	await frame_end()
	assert_eq(BadgeCore.get_count(gated_badge), 2, "judged when its item count changed")


func test_load_saved_judges_the_requirements() -> void:
	assert_true(await start_modules())
	assert_true(LocalDataCore.load_user_file(USER_ID))
	put_balance(id_of("[potion]"), 1)
	assert_true(BadgeCore.set_count(locked_child_badge, 1))
	await frame_end()
	assert_eq(BadgeCore.get_count(locked_badge), 1, "the delta before already judged it")
	BadgeCore.release()
	assert_true(BadgeCore.init())
	assert_true(BadgeCore.set_count(locked_child_badge, 1))
	await frame_end()
	assert_eq(BadgeCore.get_count(locked_badge), 0, "not judged since init")
	assert_true(BadgeCore.load_saved())
	await frame_end()
	assert_eq(BadgeCore.get_count(locked_badge), 1)
