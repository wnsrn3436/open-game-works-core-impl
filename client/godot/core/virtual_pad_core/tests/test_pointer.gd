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
	assert_eq(under.inputs, 0, "the UI below gets neither pointer")
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
	assert_eq(under.inputs, 0, "the UI element below gets nothing")
	assert_eq(recorder.gestures(), 0, "no gesture")
	touch(1, true, OUTSIDE)
	touch(1, false, OUTSIDE)
	assert_eq(recorder.taps, 1, "a pointer outside the areas reaches the world")


func test_pointer_pressed_outside_moves_over_the_areas_unconsumed() -> void:
	await open(LAYOUT_FIXED)
	touch(0, true, OUTSIDE)
	drag(0, OUTSIDE + Vector2(0.0, 100.0))
	var drags: int = recorder.drags
	assert_gt(drags, 0, "the move outside the areas starts a drag")
	drag(0, center_of(FIRE))
	assert_eq(recorder.drags, drags + 1, "a move over the button area is a drag move")
	drag(0, stick_point(Vector2(RADIUS * 0.5, 0.0)))
	assert_eq(recorder.drags, drags + 2, "a move over the joystick area is a drag move")
	assert_false(InputCore.is_pressed(FIRE_ACTION), "the button does not take the pointer")
	assert_true(no_direction(), "the joystick does not take the pointer")
	touch(0, false, stick_point(Vector2(RADIUS * 0.5, 0.0)))
	assert_eq(recorder.drags, drags + 3, "the release over an area ends the drag")
	assert_false(InputCore.is_pressed(FIRE_ACTION))
	assert_true(no_direction())


func test_outside_pointer_after_an_input_cancel_is_unconsumed() -> void:
	await open(LAYOUT_FIXED)
	touch(0, true, center_of(FIRE))
	InputCore.cancel_input()
	touch(0, false, center_of(FIRE))
	touch(0, true, OUTSIDE)
	drag(0, OUTSIDE + Vector2(0.0, 100.0))
	var drags: int = recorder.drags
	drag(0, center_of(FIRE))
	assert_eq(recorder.drags, drags + 1, "the pointer ID pressed in the area before the cancel is not consumed")
	assert_false(InputCore.is_pressed(FIRE_ACTION))
	touch(0, false, center_of(FIRE))


func test_outside_pointer_after_a_popup_is_unconsumed() -> void:
	await open(LAYOUT_FIXED)
	# The popup opens under a block that is already active, so it makes no input cancel.
	var token: int = _block_with_stick()
	touch(0, true, stick_point(Vector2(RADIUS * 0.5, 0.0)))
	var cancels: int = InputCore.get_cancel_count()
	await open_popup()
	assert_eq(VirtualPadCore.get_state(), VirtualPadCore.VirtualPadState.INACTIVE)
	assert_eq(InputCore.get_cancel_count(), cancels, "the popup makes no input cancel")
	touch(0, false, stick_point(Vector2(RADIUS * 0.5, 0.0)))
	UICore.close_all_popups()
	await run_frames()
	assert_true(InputBlockCore.unblock(token))
	assert_eq(VirtualPadCore.get_state(), VirtualPadCore.VirtualPadState.ACTIVE)
	touch(0, true, OUTSIDE)
	drag(0, OUTSIDE + Vector2(0.0, 100.0))
	var drags: int = recorder.drags
	drag(0, stick_point(Vector2(RADIUS * 0.5, 0.0)))
	assert_eq(recorder.drags, drags + 1, "the pointer ID released while inactive is not consumed")
	assert_true(no_direction())
	touch(0, false, stick_point(Vector2(RADIUS * 0.5, 0.0)))


func test_outside_pointer_after_close_layout_is_unconsumed() -> void:
	await open(LAYOUT_FIXED)
	touch(0, true, center_of(FIRE))
	var point: Vector2 = center_of(FIRE)
	VirtualPadCore.close_layout()
	touch(0, false, point)
	await open(LAYOUT_FIXED)
	_assert_outside_pointer_reaches_the_world()


func test_outside_pointer_after_a_scope_release_is_unconsumed() -> void:
	var own: Scope = ResourceCore.create_scope(ResourceCore.ScopeKind.SCENE, "virtual_pad_test_own")
	assert_true(await VirtualPadCore.open_layout(LAYOUT_FIXED, own))
	touch(0, true, center_of(FIRE))
	var point: Vector2 = center_of(FIRE)
	ResourceCore.release_scope(own)
	assert_null(VirtualPadCore._pad, "the scope release closes the virtual pad")
	touch(0, false, point)
	await open(LAYOUT_FIXED)
	_assert_outside_pointer_reaches_the_world()


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


## Pointer 0 pressed outside the areas and moved over the button area makes one `DragEvent` per move.
func _assert_outside_pointer_reaches_the_world() -> void:
	touch(0, true, OUTSIDE)
	drag(0, OUTSIDE + Vector2(0.0, 100.0))
	var drags: int = recorder.drags
	drag(0, center_of(FIRE))
	assert_eq(recorder.drags, drags + 1, "the pointer ID held in an area when the layout closed is not consumed")
	assert_false(InputCore.is_pressed(FIRE_ACTION))
	touch(0, false, center_of(FIRE))


## A `content` block whose pass list has the joystick element only.
func _block_with_stick() -> int:
	var pass_list: BlockPassList = BlockPassList.new()
	pass_list.elements = [element(STICK)]
	var token: int = InputBlockCore.block("content", pass_list)
	assert_true(InputBlockCore.is_active(token))
	return token


func test_forty_pointers_in_one_button_area_leave_the_joystick_free() -> void:
	assert_true(UnitTestCore.set_test_settings("InputCore.maxJudgePointers", 50))
	assert_true(await restart_modules(), "the modules start with 50 judge pointers")
	await open(LAYOUT_FIXED)
	for i: int in 40:
		touch(i, true, center_of(FIRE))
	assert_true(InputCore.is_pressed(FIRE_ACTION))
	touch(40, true, stick_point(Vector2(RADIUS * 0.5, 0.0)))
	assert_vector(Vector2(0.5, 0.0), "the joystick takes the 41st pointer")
	for i: int in 40:
		touch(i, false, center_of(FIRE))
	assert_false(InputCore.is_pressed(FIRE_ACTION))
	assert_eq(recorder.taps, 0, "the 40 pointers pressed in the button area give no tap")
	touch(40, false, stick_point(Vector2(RADIUS * 0.5, 0.0)))
	assert_true(no_direction())
