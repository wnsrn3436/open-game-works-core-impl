extends "res://core/ui_core/tests/support/scroll_test_case.gd"
## `UIScrollList` with `MEASURED` sizes. The measured size is read in a call deferred after the code run that bound the
## item UI, so these tests run in the headless pass.


func test_measured_sizes() -> void:
	var list: UIScrollList = await _open_list(VIEW, 1, UICore.UIScrollSizeMode.MEASURED, ITEM_MEASURED)
	for index: int in 100:
		heights.append(30.0 + float(index % 7) * 9.0)
	assert_true(await _fill(list, 100))
	await UnitTestCore.wait_frames(2)
	var start: float = 0.0
	for index: int in list._slot_used:
		assert_almost_eq(list._line_start(index), start, 0.01, "line %d" % index)
		start += heights[index] + SPACING
	# Items 50 on are not measured yet: item 50 starts above the visible area with its estimated size.
	list.set_scroll_offset(list._line_start(50) + 10.0)
	var item: Control = list._item_ui(51)
	assert_not_null(item)
	var before: float = item.position.y
	await UnitTestCore.wait_frames(2)
	assert_almost_eq(list._measured[50], heights[50], 0.01, "item 50 is measured")
	assert_almost_eq(item.position.y, before, 0.01, "a visible item stays on screen")


func test_measure_and_placement_in_the_deferred_call_of_the_bind() -> void:
	var list: UIScrollList = await _open_list(VIEW, 1, UICore.UIScrollSizeMode.MEASURED, ITEM_MEASURED)
	for index: int in 100:
		heights.append(30.0 + float(index % 7) * 9.0)
	assert_true(await _fill(list, 100))
	# `_fill` can end in the code run of the first layout, while its measure is queued: the bind below then queues
	# no measure of its own (test_measure_after_the_sort_of_an_item_bound_in_a_second_layout).
	await UnitTestCore.wait_frames(1)
	assert_false(list._measure_queued, "no measure is queued before the bind")
	list.set_scroll_offset(list._line_start(50) + 10.0)
	assert_lt(list._measured[50], 0.0, "item 50 is bound and not measured yet")
	var item: Control = list._item_ui(51)
	assert_not_null(item)
	var before: float = item.position.y
	var frame: int = Engine.get_process_frames()
	# Measured size of item 50, screen position of item 51 and process frame, in the call deferred after the measure
	# call that the bind above queued.
	var seen: Array[float] = []
	var check: Callable = func() -> void:
		seen.append_array([list._measured[50], item.position.y, float(Engine.get_process_frames())])
	check.call_deferred()
	await UnitTestCore.wait_frames(1)
	assert_eq(seen.size(), 3)
	if seen.size() != 3:
		return
	assert_almost_eq(seen[0], heights[50], 0.01, "item 50 is measured")
	assert_almost_eq(seen[1], before, 0.01, "the same call placed the items and corrected the scroll position")
	assert_eq(int(seen[2]), frame, "in the frame of the bind")


func test_end_follow_with_a_measured_last_item() -> void:
	var list: UIScrollList = await _open_list(VIEW, 1, UICore.UIScrollSizeMode.MEASURED, ITEM_MEASURED)
	list.end_follow = true
	for index: int in 30:
		heights.append(ITEM_HEIGHT)
	heights[29] = 90.0
	# The last item may already be measured when `_fill` ends: the max scroll position of the estimated sizes is
	# computed, not read.
	var estimated_end: float = 29.0 * PITCH + ITEM_HEIGHT - VIEW
	assert_true(await _fill(list, 30, true))
	await UnitTestCore.wait_frames(2)
	assert_almost_eq(list._measured[29], 90.0, 0.01)
	assert_almost_eq(list._max_offset(), estimated_end + 90.0 - ITEM_HEIGHT, 0.01, "the max scroll position grew")
	assert_almost_eq(list.get_scroll_offset(), list._max_offset(), 0.01, "the new max scroll position")


func test_measured_line_starts_in_a_long_list() -> void:
	var list: UIScrollList = await _open_list(VIEW, 1, UICore.UIScrollSizeMode.MEASURED, ITEM_MEASURED)
	var count: int = 10000
	for index: int in count + 200:
		heights.append(30.0 + float(index % 7) * 9.0)
	assert_true(await _fill(list, count))
	for offset: float in [0.0, 120000.0, 260000.0, 400000.0]:
		list.set_scroll_offset(offset)
		await UnitTestCore.wait_frames(2)
	assert_true(list.append_items(100))
	list.set_scroll_offset(list._max_offset())
	await UnitTestCore.wait_frames(2)
	assert_true(list.prepend_items(100))
	await UnitTestCore.wait_frames(2)
	assert_eq(list._line_count, count + 200)
	var measured: int = 0
	var start: float = 0.0
	var wrong: int = -1
	for index: int in list._line_count:
		if wrong < 0 and absf(list._line_start(index) - start) > 0.01:
			wrong = index
		var line_size: float = list._measured[index] if list._measured[index] >= 0.0 else ITEM_HEIGHT
		if list._measured[index] >= 0.0 and line_size != ITEM_HEIGHT:
			measured += 1
		start += line_size + SPACING
	assert_true(measured > 20, "items in several places have measured sizes other than the estimated size")
	assert_eq(wrong, -1, "every line start is the sum of the sizes and spacings before it")
	assert_almost_eq(list._content_lines_length(), start - SPACING, 0.01)


func test_measure_after_the_sort_of_an_item_bound_in_a_second_layout() -> void:
	var list: UIScrollList = await _open_list(VIEW, 1, UICore.UIScrollSizeMode.MEASURED, ITEM_WRAPPED)
	list.item_size = Vector2(100.0, 400.0)
	var bind: Callable = func(item: Control, index: int) -> void:
		_item_of(item).bound_index = index
		var label: Label = item.get_node("Label") as Label
		label.text = "word ".repeat(30)
	assert_true(await list.set_items(100, bind, current().scope))
	# In the code run of the first layout: the deferred measure is queued, and this second layout binds an item UI
	# that the first layout did not use.
	list.set_scroll_offset(60.0 * (400.0 + SPACING) + 395.0)
	await UnitTestCore.wait_frames(3)
	assert_true(list._slot_used >= 3)
	var sizes: PackedFloat64Array = PackedFloat64Array()
	for slot: int in list._slot_used:
		var node: Control = list._slot_nodes[slot]
		var index: int = list._slot_indices[slot]
		var now: float = node.get_combined_minimum_size().y
		sizes.append(now)
		assert_almost_eq(list._measured[index], now, 0.01, "item %d is measured after its own sort" % index)
		assert_almost_eq(list._line_start(index + 1) - list._line_start(index), now + SPACING, 0.01,
				"pitch of line %d" % index)
		assert_almost_eq(node.size.y, now, 0.01, "item UI size of item %d" % index)
	assert_true(sizes[0] < 400.0, "the label wraps in the list width")
