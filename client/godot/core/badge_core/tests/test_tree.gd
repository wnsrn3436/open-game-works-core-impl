extends "res://core/badge_core/tests/support/badge_test_case.gd"
## Badge tree: total count propagation, `BadgeChangedEvent` order and item badges.


func test_parent_total_is_own_count_and_items_of_children_and_turns_off_at_zero() -> void:
	assert_true(await start_modules())
	assert_true(BadgeCore.set_count(a_badge, 2))
	assert_true(BadgeCore.set_item(b_badge, 11, 1))
	assert_true(BadgeCore.set_item(b_badge, 12, 1))
	assert_eq(BadgeCore.get_count(root_badge), 0, "recalculated at the frame end")
	await frame_end()
	assert_eq(BadgeCore.get_count(a_badge), 2)
	assert_eq(BadgeCore.get_count(b_badge), 2)
	assert_eq(BadgeCore.get_count(root_badge), 4)
	assert_true(BadgeCore.set_count(a_badge, 0))
	BadgeCore.clear_items(b_badge)
	await frame_end()
	assert_eq(BadgeCore.get_count(root_badge), 0)
	assert_eq(BadgeCore.get_item_count(b_badge, 11), 0)


func test_changed_event_comes_once_per_changed_badge_children_first() -> void:
	assert_true(await start_modules())
	assert_true(BadgeCore.set_count(a_badge, 1))
	assert_true(BadgeCore.set_count(a_badge, 3))
	assert_true(BadgeCore.set_item(b_badge, 5, 2))
	await frame_end()
	assert_eq(events, PackedStringArray([
		event_text(a_badge, 0, 3),
		event_text(b_badge, 5, 2),
		event_text(b_badge, 0, 2),
		event_text(root_badge, 0, 5),
	]))
	events = PackedStringArray()
	assert_true(BadgeCore.set_count(a_badge, 2))
	assert_true(BadgeCore.set_item(b_badge, 5, 3))
	await frame_end()
	assert_eq(events, PackedStringArray([
		event_text(a_badge, 0, 2),
		event_text(b_badge, 5, 3),
		event_text(b_badge, 0, 3),
	]), "A and B change to the same sum: Root has no event")
	events = PackedStringArray()
	assert_true(BadgeCore.set_count(a_badge, 1))
	assert_true(BadgeCore.set_count(a_badge, 2))
	await frame_end()
	assert_eq(events, PackedStringArray(), "a count set back within the frame is no change")


func test_set_item_zero_removes_the_item() -> void:
	assert_true(await start_modules())
	assert_true(BadgeCore.set_item(b_badge, 7, 2))
	await frame_end()
	events = PackedStringArray()
	assert_true(BadgeCore.set_item(b_badge, 7, 0))
	assert_eq(BadgeCore.get_item_count(b_badge, 7), 0)
	await frame_end()
	assert_eq(events, PackedStringArray([
		event_text(b_badge, 7, 0),
		event_text(b_badge, 0, 0),
		event_text(root_badge, 0, 0),
	]))
	events = PackedStringArray()
	assert_true(BadgeCore.set_item(b_badge, 8, 0), "an item that is not there")
	await frame_end()
	assert_eq(events, PackedStringArray())


func test_clear_item_and_get_item_count() -> void:
	assert_true(await start_modules())
	assert_true(BadgeCore.set_item(a_badge, 3, 4))
	assert_true(BadgeCore.set_item(a_badge, -9, 1), "a negative item key is a key")
	assert_eq(BadgeCore.get_item_count(a_badge, 3), 4)
	BadgeCore.clear_item(a_badge, 3)
	assert_eq(BadgeCore.get_item_count(a_badge, 3), 0)
	await frame_end()
	assert_eq(BadgeCore.get_count(a_badge), 1)
	assert_eq(BadgeCore.get_count(root_badge), 1)


func test_item_sum_follows_set_item_clear_item_and_clear_items() -> void:
	assert_true(await start_modules())
	assert_true(BadgeCore.set_item(b_badge, 11, 3))
	assert_true(BadgeCore.set_item(b_badge, 11, 1))
	assert_true(BadgeCore.set_item(b_badge, 12, 2))
	assert_true(BadgeCore.set_item(b_badge, 13, 4))
	BadgeCore.clear_item(b_badge, 11)
	await frame_end()
	assert_eq(BadgeCore.get_count(b_badge), 6)
	assert_eq(BadgeCore.get_count(root_badge), 6)
	BadgeCore.clear_items(b_badge)
	assert_true(BadgeCore.set_item(b_badge, 14, 1))
	await frame_end()
	assert_eq(BadgeCore.get_count(b_badge), 1)
	assert_eq(BadgeCore.get_count(root_badge), 1)


func test_frame_end_recalculates_only_the_changed_badge_and_its_ancestors() -> void:
	assert_true(await start_modules())
	assert_true(BadgeCore.set_count(locked_child_badge, 1))
	await frame_end()
	# Counts written past the operations: a recalculation of these badges would show them.
	BadgeCore._badges[b_badge].own_count = 5
	BadgeCore._badges[dot_badge].own_count = 7
	BadgeCore._badges[locked_child_badge].own_count = 9
	events = PackedStringArray()
	assert_true(BadgeCore.set_item(a_badge, 31, 2))
	await frame_end()
	assert_eq(BadgeCore.get_count(a_badge), 2)
	assert_eq(BadgeCore.get_count(root_badge), 2, "Root adds the last totals of B and Locked")
	assert_eq(BadgeCore.get_count(b_badge), 0, "B is not an ancestor of A")
	assert_eq(BadgeCore.get_count(dot_badge), 0, "Dot is in another tree")
	assert_eq(BadgeCore.get_count(locked_child_badge), 1, "LockedChild is not an ancestor of A")
	assert_eq(events, PackedStringArray([
		event_text(a_badge, 31, 2),
		event_text(a_badge, 0, 2),
		event_text(root_badge, 0, 2),
	]))
	BadgeCore._badges[locked_child_badge].own_count = 1
	assert_true(BadgeCore.set_count(locked_child_badge, 3))
	await frame_end()
	assert_eq(BadgeCore.get_count(locked_child_badge), 3)
	assert_eq(BadgeCore.get_count(locked_badge), 0, "Locked has not passed its requirement")
	assert_eq(BadgeCore.get_count(root_badge), 2)


func test_frame_end_redraws_only_the_views_whose_count_changed() -> void:
	assert_true(await start_modules())
	var a_view: BadgeView = make_view()
	var b_view: BadgeView = make_view()
	var item_view: BadgeView = make_view()
	var root_view: BadgeView = make_view()
	assert_true(a_view.bind(a_badge))
	assert_true(b_view.bind(b_badge))
	assert_true(item_view.bind(a_badge, 21))
	assert_true(root_view.bind(root_badge))
	assert_true(BadgeCore.set_count(a_badge, 1))
	assert_true(BadgeCore.set_count(b_badge, 1))
	assert_true(BadgeCore.set_item(a_badge, 21, 1))
	await frame_end()
	assert_eq(shown_text(a_view), "2")
	assert_eq(shown_text(item_view), "1")
	assert_eq(shown_text(root_view), "3")
	# Marks that a redraw would overwrite.
	b_view._label.text = "kept"
	item_view._label.text = "kept"
	assert_true(BadgeCore.set_count(a_badge, 3))
	await frame_end()
	assert_eq(shown_text(a_view), "4")
	assert_eq(shown_text(root_view), "5")
	assert_eq(shown_text(b_view), "kept", "B did not change")
	assert_eq(shown_text(item_view), "kept", "item 21 did not change")
	assert_true(BadgeCore.set_item(a_badge, 21, 2))
	await frame_end()
	assert_eq(shown_text(item_view), "2")
	assert_eq(shown_text(b_view), "kept")
	free_view(a_view)
	free_view(b_view)
	free_view(item_view)
	free_view(root_view)
