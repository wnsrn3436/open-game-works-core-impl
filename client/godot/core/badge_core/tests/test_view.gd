extends "res://core/badge_core/tests/support/badge_test_case.gd"
## `BadgeView`: dot and count display, the over text, hiding at 0, binding, `prepare` and destruction.


func test_dot_badge_shows_a_dot_and_count_badge_shows_the_count() -> void:
	assert_true(await start_modules())
	var dot_view: BadgeView = make_view()
	var count_view: BadgeView = make_view()
	assert_true(dot_view.bind(dot_badge))
	assert_true(count_view.bind(a_badge))
	assert_false(shown(dot_view), "count 0 is hidden")
	assert_false(shown(count_view))
	assert_true(BadgeCore.set_count(dot_badge, 5))
	assert_true(BadgeCore.set_count(a_badge, 5))
	await frame_end()
	assert_true(shown(dot_view))
	assert_eq(shown_text(dot_view), "", "a dot without the count")
	assert_true(shown(count_view))
	assert_eq(shown_text(count_view), "5")
	assert_true(BadgeCore.set_count(a_badge, 0))
	await frame_end()
	assert_false(shown(count_view), "hidden at 0")
	free_view(dot_view)
	free_view(count_view)


func test_count_above_max_display_count_shows_the_over_text() -> void:
	assert_true(await start_modules())
	var view: BadgeView = make_view()
	assert_true(view.bind(a_badge))
	assert_true(BadgeCore.set_count(a_badge, MAX_DISPLAY_COUNT))
	await frame_end()
	assert_eq(shown_text(view), str(MAX_DISPLAY_COUNT))
	assert_true(BadgeCore.set_count(a_badge, MAX_DISPLAY_COUNT + 1))
	await frame_end()
	assert_eq(shown_text(view), "99+", "[badge_count_over] is {count}+ with {count} = BadgeCore.maxDisplayCount")
	assert_true(BadgeCore.set_count(a_badge, MAX_DISPLAY_COUNT + 50))
	await frame_end()
	assert_eq(shown_text(view), "99+", "{count} stays BadgeCore.maxDisplayCount, not the count")
	free_view(view)


func test_over_text_count_is_the_max_display_count_setting() -> void:
	set_int("BadgeCore.maxDisplayCount", 5)
	assert_true(await start_modules())
	var view: BadgeView = make_view()
	assert_true(view.bind(a_badge))
	assert_true(BadgeCore.set_count(a_badge, 5))
	await frame_end()
	assert_eq(shown_text(view), "5")
	assert_true(BadgeCore.set_count(a_badge, 6))
	await frame_end()
	assert_eq(shown_text(view), "5+")
	free_view(view)


func test_item_view_shows_the_item_count_with_the_display_of_its_badge() -> void:
	assert_true(await start_modules())
	var count_view: BadgeView = make_view()
	var dot_view: BadgeView = make_view()
	assert_true(count_view.bind(a_badge, 21))
	assert_true(dot_view.bind(dot_badge, 21))
	assert_true(BadgeCore.set_item(a_badge, 21, 3))
	assert_true(BadgeCore.set_item(a_badge, 22, 4))
	assert_true(BadgeCore.set_item(dot_badge, 21, 3))
	await frame_end()
	assert_eq(shown_text(count_view), "3")
	assert_true(shown(dot_view))
	assert_eq(shown_text(dot_view), "")
	BadgeCore.clear_item(a_badge, 21)
	await frame_end()
	assert_false(shown(count_view))
	free_view(count_view)
	free_view(dot_view)


func test_bind_shows_the_current_count_and_replaces_the_connection() -> void:
	assert_true(await start_modules())
	assert_true(BadgeCore.set_count(a_badge, 2))
	assert_true(BadgeCore.set_count(b_badge, 7))
	await frame_end()
	var view: BadgeView = make_view()
	assert_true(view.bind(a_badge))
	assert_eq(shown_text(view), "2", "shown at bind")
	assert_true(view.bind(b_badge))
	assert_eq(shown_text(view), "7")
	assert_false(view.bind(UNKNOWN_BADGE))
	assert_eq(errors(), 1)
	assert_eq(shown_text(view), "7", "a failed bind keeps the connection")
	assert_true(BadgeCore.set_count(a_badge, 3))
	await frame_end()
	assert_eq(shown_text(view), "7", "A is not followed any more")
	free_view(view)


func test_unbind_hides_and_stops_following() -> void:
	assert_true(await start_modules())
	var view: BadgeView = make_view()
	view.unbind()
	assert_true(view.bind(a_badge))
	assert_true(BadgeCore.set_count(a_badge, 2))
	await frame_end()
	assert_true(shown(view))
	view.unbind()
	assert_false(shown(view))
	assert_true(BadgeCore.set_count(a_badge, 3))
	await frame_end()
	assert_false(shown(view))
	free_view(view)


func test_display_is_not_a_listed_child_and_takes_no_pointer_input() -> void:
	assert_true(await start_modules())
	var view: BadgeView = make_view()
	var element_control: Control = view.get_parent() as Control
	assert_true(view.bind(a_badge))
	assert_true(BadgeCore.set_count(a_badge, 1))
	await frame_end()
	assert_eq(element_control.get_child_count(), 1, "only the BadgeView is a listed child")
	assert_eq(view._display.get_parent(), element_control)
	assert_eq(view._display.mouse_filter, Control.MOUSE_FILTER_IGNORE)
	free_view(view)


func test_destroyed_view_gets_no_update_and_no_error() -> void:
	assert_true(await start_modules())
	var view: BadgeView = make_view()
	assert_true(view.bind(a_badge))
	assert_true(BadgeCore.set_count(a_badge, 1))
	await frame_end()
	free_view(view)
	assert_true(BadgeCore.set_count(a_badge, 2))
	await frame_end()
	assert_eq(events, PackedStringArray([event_text(a_badge, 0, 1), event_text(root_badge, 0, 1),
			event_text(a_badge, 0, 2), event_text(root_badge, 0, 2)]))
	assert_eq(BadgeCore._view_ids.size(), 0)


func test_destroyed_view_alone_takes_its_display_away() -> void:
	assert_true(await start_modules())
	var view: BadgeView = make_view()
	var element_control: Control = view.get_parent() as Control
	assert_true(view.bind(a_badge))
	assert_true(BadgeCore.set_count(a_badge, 1))
	await frame_end()
	var display: Control = view._display
	element_control.remove_child(view)
	view.free()
	await frame_end()
	assert_false(is_instance_valid(display))
	assert_true(BadgeCore.set_count(a_badge, 2))
	await frame_end()
	element_control.get_parent().remove_child(element_control)
	element_control.free()


func test_prepare_uses_the_dot_prefab() -> void:
	set_string("BadgeCore.dotResource", DOT)
	assert_true(await start_modules())
	assert_true(await BadgeCore.prepare())
	var view: BadgeView = make_view()
	assert_true(view.bind(a_badge))
	assert_true(BadgeCore.set_count(a_badge, 4))
	await frame_end()
	assert_true(view._label.get_parent() is ColorRect, "the dot is the prefab root")
	assert_eq(shown_text(view), "4")
	free_view(view)


func test_prepare_without_dot_resource_uses_the_code_made_circle() -> void:
	assert_true(await start_modules())
	assert_true(await BadgeCore.prepare())
	var view: BadgeView = make_view()
	assert_true(view.bind(dot_badge))
	assert_true(BadgeCore.set_count(dot_badge, 1))
	await frame_end()
	var dot: Panel = view._label.get_parent() as Panel
	assert_not_null(dot, "code made circle")
	var style: StyleBoxFlat = dot.get_theme_stylebox("panel") as StyleBoxFlat
	assert_not_null(style)
	if style != null:
		assert_eq(style.bg_color, Color.RED)
	free_view(view)
