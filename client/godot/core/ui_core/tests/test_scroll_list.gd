extends "res://core/ui_core/tests/support/scroll_test_case.gd"
## `UIScrollList`: item UIs over the visible area, append, prepend, lines, the near callbacks, end follow, the loading
## item and the focus scroll. The `MEASURED` tests are in `test_measured_scroll_list.gd`.


func test_item_uis_follow_the_visible_area() -> void:
	var list: UIScrollList = await _open_list()
	var scope: Scope = current().scope
	assert_true(await _fill(list, 1000))
	_assert_bound(list)
	for offset: float in PackedFloat64Array([25.0, 4000.0, 12345.0, 49490.0, 999999.0, 0.0]):
		list.set_scroll_offset(offset)
		_assert_bound(list)
	assert_true(await UICore.close_panel())
	assert_eq(PoolCore.get_pool_state(ITEM, scope).y, 0, "nothing borrowed")
	assert_true(scope.released)


func test_append_keeps_the_offset_and_binds_new_visible_items() -> void:
	var list: UIScrollList = await _open_list()
	assert_true(await _fill(list, 5))
	list.set_scroll_offset(0.0)
	binds = PackedInt64Array()
	assert_true(list.append_items(3))
	assert_eq(list.get_scroll_offset(), 0.0)
	assert_eq(binds, PackedInt64Array([5, 6, 7]))
	list.set_scroll_offset(20.0)
	var offset: float = list.get_scroll_offset()
	binds = PackedInt64Array()
	assert_true(list.append_items(20))
	assert_eq(list.get_scroll_offset(), offset)
	assert_eq(binds, PackedInt64Array([8, 9]), "only the new indices over the visible area")


func test_lines_of_three() -> void:
	var list: UIScrollList = await _open_list(100.0, 3)
	assert_true(await _fill(list, 10))
	list.set_scroll_offset(60.0)
	var item: Control = list._item_ui(4)
	assert_not_null(item)
	assert_eq(item.position, Vector2(105.0, PITCH - 60.0), "the second place of the second line")
	assert_eq(list._line_count, 4)
	_assert_bound(list)
	list.scroll_to_end()
	assert_not_null(list._item_ui(9), "the fourth line")
	assert_null(list._item_ui(10))
	assert_true(list.scroll_to_index(4))
	assert_eq(list.get_scroll_offset(), PITCH, "the distance to the second line")
	list.set_loading(true)
	assert_eq(list._loading_node.position, Vector2(0.0, 4.0 * PITCH - PITCH), "the cross axis start of the fifth line")


func test_newer_set_items_wins() -> void:
	# The item prefab is not loaded yet, so the first call still waits for its load when the second starts.
	var list: UIScrollList = await _open_list(VIEW, 1, UICore.UIScrollSizeMode.FIXED, ITEM, false)
	var first: CALL = CALL.new()
	first.set_items(list, 10, _other_bind, current().scope)
	var second: CALL = CALL.new()
	second.set_items(list, 20, _bind, current().scope)
	await wait_result(first)
	await wait_result(second)
	assert_false(first.ok)
	assert_true(second.ok)
	assert_eq(other_binds.size(), 0, "no bind of the first call")
	assert_true(binds.size() > 0)


func test_scroll_to_index_and_offset_range() -> void:
	var list: UIScrollList = await _open_list()
	assert_true(await _fill(list, 30))
	var max_offset: float = 29.0 * PITCH + ITEM_HEIGHT - VIEW
	assert_true(list.scroll_to_index(7))
	assert_eq(list.get_scroll_offset(), 7.0 * PITCH)
	assert_true(list.scroll_to_index(29))
	assert_eq(list.get_scroll_offset(), max_offset, "past the end it is the max scroll position")
	assert_false(list.scroll_to_index(30))
	assert_false(list.scroll_to_index(-1))
	assert_eq(errors(), 2)
	list.set_scroll_offset(-1.0)
	assert_eq(list.get_scroll_offset(), 0.0)
	list.set_scroll_offset(max_offset + 1.0)
	assert_eq(list.get_scroll_offset(), max_offset)
	list.scroll_to_end()
	assert_eq(list.get_scroll_offset(), max_offset)
	list.set_scroll_offset(NAN)
	assert_eq(errors(), 1)
	assert_eq(list.get_scroll_offset(), max_offset)


func test_end_near() -> void:
	var list: UIScrollList = await _open_list()
	assert_true(await _fill(list, 20))
	assert_eq(end_near, 0)
	list.set_scroll_offset(260.0)
	assert_eq(19 - list._last_visible_index(list._first_visible_line()), THRESHOLD + 1)
	assert_eq(end_near, 0, "not at the threshold plus 1")
	list.set_scroll_offset(310.0)
	assert_eq(end_near, 1, "once at the threshold")
	list.scroll_to_end()
	assert_eq(end_near, 1, "not again")
	assert_true(list.append_items(10))
	list.set_scroll_offset(810.0)
	assert_eq(29 - list._last_visible_index(list._first_visible_line()), THRESHOLD)
	assert_eq(end_near, 2, "once more after append_items")
	assert_true(await _fill(list, 0))
	assert_eq(end_near, 3, "set_items of count 0 calls it when it ends")


func test_measured_needs_one_cross_axis_item() -> void:
	var list: UIScrollList = await _open_list(VIEW, 2, UICore.UIScrollSizeMode.MEASURED, ITEM_MEASURED)
	assert_false(await list.set_items(10, _bind, current().scope))
	assert_eq(errors(), 1)


func test_prepend_keeps_the_items_on_screen() -> void:
	var list: UIScrollList = await _open_list()
	assert_true(await _fill(list, 20))
	list.set_scroll_offset(300.0)
	var item: Control = list._item_ui(8)
	var position: Vector2 = item.position
	binds = PackedInt64Array()
	assert_true(list.prepend_items(5))
	assert_eq(list._item_ui(13), item, "the same item UI under the new index")
	assert_eq(item.position, position, "the same screen position")
	assert_eq(binds.size(), 0, "no bind again and no new visible index")
	var anchor: AnchorResult = UICore.get_anchor_rect("item.13")
	assert_true(anchor.visible)
	assert_true(item.is_ancestor_of(anchor.element))
	list.scroll_to_index(2)
	assert_true(binds.has(2), "a new index bound once it is visible")
	var grid: UIScrollList = UIScrollList.new()
	grid.cross_axis_count = 3
	current().add_child(grid)
	grid._has_items = true
	assert_false(grid.prepend_items(1))
	assert_eq(errors(), 1)


func test_start_near() -> void:
	var list: UIScrollList = await _open_list()
	assert_true(await _fill(list, 20, true))
	assert_eq(start_near, 0, "starting from the end with many items")
	assert_eq(list.get_scroll_offset(), list._max_offset())
	list.set_scroll_offset(200.0)
	assert_eq(list._first_visible_line(), THRESHOLD + 1)
	assert_eq(start_near, 0)
	list.set_scroll_offset(150.0)
	assert_eq(start_near, 1)
	list.set_scroll_offset(0.0)
	assert_eq(start_near, 1)
	assert_true(list.prepend_items(10))
	assert_eq(list._first_visible_line(), 10)
	list.set_scroll_offset(150.0)
	assert_eq(start_near, 2, "once more after prepend_items")


func test_end_follow() -> void:
	var list: UIScrollList = await _open_list()
	list.end_follow = true
	assert_true(await _fill(list, 20, true))
	assert_true(list.append_items(5))
	assert_eq(list.get_scroll_offset(), list._max_offset(), "follows the end")
	list.set_scroll_offset(100.0)
	assert_true(list.append_items(5))
	assert_eq(list.get_scroll_offset(), 100.0, "stays when not at the end")


func test_loading_item() -> void:
	var list: UIScrollList = await _open_list()
	assert_true(await _fill(list, 3))
	binds = PackedInt64Array()
	list.set_loading(true)
	assert_not_null(list._loading_node)
	assert_eq(list._loading_node.position.y, 3.0 * PITCH)
	assert_eq(binds.size(), 0, "no bind")
	assert_eq(PoolCore.get_pool_state(LOADING_ITEM, current().scope).y, 1)
	list.set_loading(false)
	assert_eq(PoolCore.get_pool_state(LOADING_ITEM, current().scope).y, 0)
	list.loading_item_prefab = ""
	list.set_loading(true)
	assert_null(list._loading_node)


func test_focus_scroll_with_the_gamepad() -> void:
	var list: UIScrollList = await _open_list()
	assert_true(await _fill(list, 100))
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	await UnitTestCore.wait_frames(2)
	var last_full: Button = UICore._first_button_in(list._item_ui(9)) as Button
	assert_true(UICoreDev.set_test_focus(last_full))
	await press_pad(JOY_BUTTON_DPAD_DOWN)
	assert_eq(list.get_scroll_offset(), 10.0 * PITCH + ITEM_HEIGHT - VIEW, "the next line ends at the view end")
	assert_true(list._item_ui(10).is_ancestor_of(focus_owner()))
	for i: int in 95:
		await press_pad(JOY_BUTTON_DPAD_DOWN)
	assert_true(list._item_ui(99).is_ancestor_of(focus_owner()))
	assert_eq(end_near, 1)
	var end: float = list.get_scroll_offset()
	await press_pad(JOY_BUTTON_DPAD_DOWN)
	assert_eq(list.get_scroll_offset(), end, "no line after the last")
	for i: int in 99:
		await press_pad(JOY_BUTTON_DPAD_UP)
	assert_eq(list.get_scroll_offset(), 0.0)
	assert_true(list._item_ui(0).is_ancestor_of(focus_owner()))
	assert_eq(errors(), 0)


func test_set_items_errors() -> void:
	var list: UIScrollList = await _open_list()
	var scope: Scope = current().scope
	assert_false(await list.set_items(-1, _bind, scope))
	list.item_prefab = ""
	assert_false(await list.set_items(1, _bind, scope))
	list.item_prefab = ITEM
	list.item_size = Vector2(0.0, ITEM_HEIGHT)
	assert_false(await list.set_items(1, _bind, scope))
	list.item_size = Vector2(100.0, ITEM_HEIGHT)
	list.item_spacing = -1.0
	assert_false(await list.set_items(1, _bind, scope))
	list.item_spacing = SPACING
	list.cross_axis_count = 0
	assert_false(await list.set_items(1, _bind, scope))
	list.cross_axis_count = 1
	assert_eq(errors(), 5)
	assert_eq(PoolCore.get_pool_state(ITEM, scope).y, 0, "no item UI borrowed")
	assert_false(list.append_items(1), "before set_items")
	assert_false(list.prepend_items(1), "before set_items")
	assert_eq(errors(), 2)
	assert_true(await _fill(list, 3))
	assert_false(list.append_items(0))
	assert_false(list.prepend_items(0))
	assert_eq(errors(), 2)
	assert_eq(list._count, 3, "the item count stays")
