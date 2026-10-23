extends VirtualPadTestCase
## Virtual button, pointer ownership, overlapping areas, UI stage consumption and the pass list of a block.

const OUTSIDE: Vector2 = Vector2(1000.0, 200.0)


func test_button_keeps_its_pointer_until_release() -> void:
	await open(LAYOUT_FIXED)
	touch(0, true, center_of(FIRE))
	assert_true(InputCore.is_pressed(FIRE_ACTION))
	assert_almost_eq(InputCore.get_strength(FIRE_ACTION), 1.0, EPSILON, "strength 1")
	drag(0, OUTSIDE)
	assert_true(InputCore.is_pressed(FIRE_ACTION), "moving out of the area keeps the press")
	touch(0, false, OUTSIDE)
	assert_false(InputCore.is_pressed(FIRE_ACTION))


func test_joystick_and_button_with_two_pointers() -> void:
	await open(LAYOUT_FIXED)
	touch(0, true, stick_point(Vector2(RADIUS * 0.5, 0.0)))
	touch(1, true, center_of(FIRE))
	assert_vector(Vector2(0.5, 0.0))
	assert_true(InputCore.is_pressed(FIRE_ACTION))
	touch(1, false, center_of(FIRE))
	assert_false(InputCore.is_pressed(FIRE_ACTION))
	assert_vector(Vector2(0.5, 0.0), "the joystick keeps its pointer")
	touch(1, true, center_of(FIRE))
	touch(0, false, stick_point(Vector2(RADIUS * 0.5, 0.0)))
	assert_true(no_direction())
	assert_true(InputCore.is_pressed(FIRE_ACTION), "the button keeps its pointer")


func test_second_pointer_in_an_owned_element_changes_nothing() -> void:
	await open(LAYOUT_FIXED)
	var under: VirtualPadTestControl = make_control(area_of(element(STICK)))
	touch(0, true, stick_point(Vector2(RADIUS * 0.5, 0.0)))
	touch(1, true, stick_point(Vector2(-RADIUS * 0.5, 0.0)))
	drag(1, stick_point(Vector2(-RADIUS * 0.8, RADIUS * 0.3)))
	drag(1, OUTSIDE)
	touch(1, false, OUTSIDE)
	assert_vector(Vector2(0.5, 0.0), "the other pointer does not move the joystick")
	assert_eq(under.touches, 0, "the UI below gets neither pointer")
	assert_eq(recorder.gestures(), 0, "no gesture from either pointer")


func test_overlapped_area_belongs_to_the_later_element() -> void:
	await open(LAYOUT_OVERLAP)
	var jump: Rect2 = area_of(element("jump"))
	var fire: Rect2 = area_of(element(FIRE))
	var overlap: Rect2 = jump.intersection(fire)
	assert_true(overlap.has_area(), "the test layout overlaps")
	var point: Vector2 = canvas_to_game(overlap.get_center())
	touch(0, true, point)
	assert_true(InputCore.is_pressed(FIRE_ACTION), "the later element takes it")
	assert_false(InputCore.is_pressed(JUMP_ACTION), "the earlier element does not")


func test_pointer_in_an_area_is_consumed_and_outside_is_not() -> void:
	await open(LAYOUT_FIXED)
	var under: VirtualPadTestControl = make_control(area_of(element(STICK)))
	touch(0, true, stick_point(Vector2.ZERO))
	touch(0, false, stick_point(Vector2.ZERO))
	assert_eq(under.touches, 0, "the UI element below gets nothing")
	assert_eq(recorder.gestures(), 0, "no gesture")
	touch(1, true, OUTSIDE)
	touch(1, false, OUTSIDE)
	assert_eq(recorder.taps, 1, "a pointer outside the areas reaches the world")


func test_block_with_the_joystick_in_its_pass_list() -> void:
	await open(LAYOUT_FIXED)
	var token: int = _block_with_stick()
	touch(0, true, stick_point(Vector2(RADIUS * 0.5, 0.0)))
	assert_vector(Vector2(0.5, 0.0), "the joystick takes the passed pointer")
	drag(0, OUTSIDE)
	assert_true(InputCore.is_pressed(RIGHT) or InputCore.is_pressed(UP) or InputCore.is_pressed(DOWN),
		"the direction actions follow the pointer out of the area")
	assert_ne(vector(), Vector2(0.5, 0.0), "the vector follows the pointer out of the area")
	touch(0, false, OUTSIDE)
	assert_true(no_direction(), "the release releases every direction action")
	touch(1, true, center_of(FIRE))
	assert_false(InputCore.is_pressed(FIRE_ACTION), "the button area is outside the pass list")
	touch(1, false, center_of(FIRE))
	assert_true(InputBlockCore.unblock(token))


func test_popup_under_a_block_ends_the_joystick() -> void:
	await open(LAYOUT_FIXED)
	var token: int = _block_with_stick()
	touch(0, true, stick_point(Vector2(RADIUS * 0.5, 0.0)))
	assert_vector(Vector2(0.5, 0.0))
	await open_popup()
	assert_true(no_direction(), "a popup ends the joystick under the block")
	UICore.close_all_popups()
	touch(0, false, stick_point(Vector2(RADIUS * 0.5, 0.0)))
	assert_true(InputBlockCore.unblock(token))


## A `content` block whose pass list has the joystick element only.
func _block_with_stick() -> int:
	var pass_list: BlockPassList = BlockPassList.new()
	pass_list.elements = [element(STICK)]
	var token: int = InputBlockCore.block("content", pass_list)
	assert_true(InputBlockCore.is_active(token))
	return token
