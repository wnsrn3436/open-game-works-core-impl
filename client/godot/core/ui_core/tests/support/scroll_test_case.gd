extends "res://core/ui_core/tests/support/ui_test_case.gd"
## Base of the `UIScrollList` core tests: the scroll test panel, its list, the bind and near callbacks and checks.

## Item size along the scroll axis and the item spacing of the tests: one line every 50.
const ITEM_HEIGHT: float = 40.0
const SPACING: float = 10.0
const PITCH: float = 50.0
const VIEW: float = 500.0

var binds: PackedInt64Array = PackedInt64Array()
var other_binds: PackedInt64Array = PackedInt64Array()
var end_near: int = 0
var start_near: int = 0
## Measured heights by index for `MEASURED` items.
var heights: PackedFloat64Array = PackedFloat64Array()


func before_each() -> void:
	super()
	binds = PackedInt64Array()
	other_binds = PackedInt64Array()
	end_near = 0
	start_near = 0
	heights = PackedFloat64Array()


## The test script of an item UI. The item UI root is a `Control` whose script extends `PoolObject`.
func _item_of(item: Control) -> TEST_ITEM:
	var node: Node = item
	return node as TEST_ITEM


func _bind(item: Control, index: int) -> void:
	_item_of(item).bound_index = index
	binds.append(index)
	if index < heights.size():
		item.custom_minimum_size = Vector2(0.0, heights[index])


func _other_bind(item: Control, index: int) -> void:
	_item_of(item).bound_index = index
	other_binds.append(index)


func _on_end_near() -> void:
	end_near += 1


func _on_start_near() -> void:
	start_near += 1


## Opens the scroll test panel on top of `PANEL_A` and sets up its list. The test resources are loaded first unless
## `load_all` is false. Async.
func _open_list(view: float = VIEW, cross: int = 1, mode: UICore.UIScrollSizeMode = UICore.UIScrollSizeMode.FIXED,
		prefab: String = ITEM, load_all: bool = true) -> UIScrollList:
	assert_true(await start(true, true, load_all))
	assert_true(await UICore.open_panel(PANEL_A, null, false))
	assert_true(await UICore.open_panel(PANEL_SCROLL, null, false))
	var list: UIScrollList = current().find_child("List", true, false) as UIScrollList
	list.size = Vector2(300.0 if cross == 1 else 400.0, view)
	list.item_prefab = prefab
	list.item_size = Vector2(100.0, ITEM_HEIGHT)
	list.item_spacing = SPACING
	list.cross_axis_count = cross
	list.cross_axis_spacing = 5.0
	list.size_mode = mode
	list.loading_item_prefab = LOADING_ITEM
	await UnitTestCore.wait_frames(1)
	return list


## `set_items` and wait for it. Async.
func _fill(list: UIScrollList, count: int, from_end: bool = false) -> bool:
	var call: CALL = CALL.new()
	call.set_items(list, count, _bind, current().scope, _on_end_near, _on_start_near, from_end)
	await finish(call)
	return call.ok


## Indices over the visible area of a list of cross axis count `cross` with fixed sizes.
func _visible_count(list: UIScrollList, cross: int = 1) -> int:
	var offset: float = list.get_scroll_offset()
	var count: int = 0
	for index: int in list._count:
		var start: float = (index / cross) * PITCH
		if start < offset + list.size.y and start + ITEM_HEIGHT > offset:
			count += 1
	return count


func _assert_bound(list: UIScrollList) -> void:
	assert_eq(list._slot_used, _visible_count(list, list.cross_axis_count), "one item UI per visible item")
	assert_eq(PoolCore.get_pool_state(ITEM, current().scope).y, list._slot_used, "borrowed item UIs")
	for slot: int in list._slot_used:
		var item: TEST_ITEM = _item_of(list._slot_nodes[slot])
		assert_eq(item.bound_index, list._slot_indices[slot], "bound to its index")
