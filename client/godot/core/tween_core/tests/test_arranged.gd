extends "res://core/tween_core/tests/support/tween_test_case.gd"
## Arranged elements: `Position`, `Rotation` and `Scale` of a `Control` in a `Container` change its offset transform.


## A `Control` of `width` × 20 in `parent`.
func element(parent: Node, width: float) -> Control:
	var made: Control = Control.new()
	made.custom_minimum_size = Vector2(width, 20)
	parent.add_child(made)
	return made


## A horizontal container with two elements, laid out. Returns the second element.
func arranged_row() -> Control:
	var row: HBoxContainer = keep(HBoxContainer.new()) as HBoxContainer
	element(row, 50)
	var second: Control = element(row, 40)
	await frame_end()
	return second


## Lets the parent of `target` arrange its children again.
func rearrange(target: Control) -> void:
	(target.get_parent() as Container).queue_sort()
	await frame_end()


func test_position_and_scale_of_an_arranged_element_stay_after_its_parent_arranges_its_children_again() -> void:
	start()
	var target: Control = await arranged_row()
	var place: Vector2 = target.position
	var handle: int = TweenCore.play(single(change(TweenCore.TweenProperty.POSITION, Vector4(10, 0, 0, 0), 100)),
			target, options())
	recorder.wait(handle, 0)
	await advance(100)
	assert_eq(recorder.waits, {0: TweenCore.TweenEndReason.COMPLETED})
	assert_eq(target.position, place, "the place the parent gives is unchanged")
	assert_eq(target.get_transform().origin, place + Vector2(10, 0), "drawn 10 to the right of its place")
	await rearrange(target)
	assert_eq(target.position, place)
	assert_eq(target.get_transform().origin, place + Vector2(10, 0))
	handle = TweenCore.play(single(change(TweenCore.TweenProperty.SCALE, Vector4(1.2, 1.2, 0, 0), 100)), target)
	await advance(100)
	assert_false(TweenCore.is_playing(handle))
	await rearrange(target)
	assert_eq(target.position, place)
	assert_almost_eq(target.get_transform().get_scale().x, 1.2, 0.0001)
	assert_almost_eq(target.get_transform().get_scale().y, 1.2, 0.0001)
	assert_eq(target.scale, Vector2.ONE, "the scale the parent sees is unchanged")
	assert_eq(errors(), 0)


func test_an_arranged_element_turns_and_scales_about_the_pivot_of_an_element_that_is_not_arranged() -> void:
	start()
	var target: Control = await arranged_row()
	target.pivot_offset = Vector2(4, 2)
	target.pivot_offset_ratio = Vector2(0.5, 0.5)
	var plain: Control = keep(Control.new()) as Control
	plain.size = target.size
	plain.position = target.position
	plain.pivot_offset = target.pivot_offset
	plain.pivot_offset_ratio = target.pivot_offset_ratio
	var turn: TweenDefinition = definition([step([
		change(TweenCore.TweenProperty.ROTATION, Vector4(30, 0, 0, 0), 100),
		change(TweenCore.TweenProperty.SCALE, Vector4(1.5, 0.5, 0, 0), 100),
	])])
	TweenCore.play(turn, target)
	TweenCore.play(turn, plain)
	await advance(50)
	assert_almost_eq(rad_to_deg(target.offset_transform_rotation), 15.0, 0.001, "the current value is in degrees")
	assert_true(target.get_transform().is_equal_approx(plain.get_transform()), "the same transform midway")
	await advance(50)
	assert_true(target.get_transform().is_equal_approx(plain.get_transform()), "the same transform at the end")
	assert_eq(target.rotation, 0.0)
	assert_eq(errors(), 0)


func test_a_change_keeps_whether_its_target_is_arranged_when_the_target_moves_to_another_parent() -> void:
	start()
	var target: Control = await arranged_row()
	var place: Vector2 = target.position
	var moving: TweenDefinition = definition([step([
		change(TweenCore.TweenProperty.POSITION, Vector4(20, 0, 0, 0), 100),
		change(TweenCore.TweenProperty.SCALE, Vector4(2, 2, 0, 0), 100, 50),
	])])
	TweenCore.play(moving, target)
	await advance(20)
	var holder: Control = keep(Control.new()) as Control
	target.reparent(holder, false)
	await advance(130)
	assert_eq(target.offset_transform_position, Vector2(20, 0), "the started change stays on the offset")
	assert_eq(target.position, place)
	assert_eq(target.offset_transform_scale, Vector2.ONE, "the change that started after the move is not arranged")
	assert_eq(target.scale, Vector2(2, 2))
	assert_eq(errors(), 0)


func test_a_change_from_its_current_value_starts_from_the_offset_of_an_arranged_element() -> void:
	start()
	var target: Control = await arranged_row()
	target.offset_transform_enabled = true
	target.offset_transform_position = Vector2(30, 0)
	TweenCore.play(single(change(TweenCore.TweenProperty.POSITION, Vector4(10, 0, 0, 0), 100)), target)
	await advance(50)
	assert_almost_eq(target.offset_transform_position.x, 20.0, 0.001)
	TweenCore.skip_target_to_end(target)
	assert_eq(target.offset_transform_position, Vector2(10, 0))
	assert_eq(errors(), 0)


func test_rotation_and_scale_from_their_current_values_start_from_the_offset_of_an_arranged_element() -> void:
	start()
	var target: Control = await arranged_row()
	target.offset_transform_enabled = true
	target.offset_transform_rotation = deg_to_rad(40.0)
	target.offset_transform_scale = Vector2(2, 3)
	TweenCore.play(definition([step([
		change(TweenCore.TweenProperty.ROTATION, Vector4(0, 0, 0, 0), 100),
		change(TweenCore.TweenProperty.SCALE, Vector4(1, 1, 0, 0), 100),
	])]), target)
	await advance(50)
	assert_almost_eq(rad_to_deg(target.offset_transform_rotation), 20.0, 0.001, "halfway from the offset rotation")
	assert_almost_eq(target.offset_transform_scale.x, 1.5, 0.0001, "halfway from the offset scale")
	assert_almost_eq(target.offset_transform_scale.y, 2.0, 0.0001)
	assert_eq(target.rotation, 0.0, "the rotation the parent sees is unchanged")
	assert_eq(target.scale, Vector2.ONE, "the scale the parent sees is unchanged")
	assert_eq(errors(), 0)


func test_skipping_to_the_end_before_a_later_step_starts_changes_the_offset_of_an_arranged_element() -> void:
	start()
	var target: Control = await arranged_row()
	var place: Vector2 = target.position
	var handle: int = TweenCore.play(definition([
		step([change(TweenCore.TweenProperty.OPACITY, Vector4(0.5, 0, 0, 0), 100)]),
		step([change(TweenCore.TweenProperty.POSITION, Vector4(10, 0, 0, 0), 100)]),
	]), target)
	await advance(50)
	TweenCore.skip_to_end(handle)
	assert_false(TweenCore.is_playing(handle))
	assert_eq(target.offset_transform_position, Vector2(10, 0), "the change of the later step goes to the offset")
	assert_eq(target.position, place, "the place the parent gives is unchanged")
	await rearrange(target)
	assert_eq(target.offset_transform_position, Vector2(10, 0))
	assert_eq(target.position, place)
	assert_eq(target.get_transform().origin, place + Vector2(10, 0), "drawn 10 to the right of its place")
	assert_eq(errors(), 0)
