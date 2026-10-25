extends "res://core/tween_core/tests/support/tween_test_case.gd"
## `copy_definition`, `check_definition`, `evaluate_easing`, the definition read when a tween starts and the type
## defaults.


## Two steps: one change, then two changes.
func source_definition() -> TweenDefinition:
	return definition([
		step([change(TweenCore.TweenProperty.POSITION, Vector4(1, 2, 0, 0), 100, 10, TweenCore.Easing.QUAD_IN)]),
		step([
			change_from(TweenCore.TweenProperty.SCALE, Vector4(1, 1, 0, 0), Vector4(2, 2, 0, 0), 200),
			change(TweenCore.TweenProperty.OPACITY, Vector4(0.5, 0, 0, 0), 300),
		]),
	], 2)


func assert_same_values(copy: TweenDefinition, source: TweenDefinition) -> void:
	assert_eq(copy.repeat_count, source.repeat_count)
	assert_eq(copy.steps.size(), source.steps.size())
	for s: int in source.steps.size():
		assert_ne(copy.steps[s], source.steps[s], "step %d is another object" % s)
		assert_eq(copy.steps[s].changes.size(), source.steps[s].changes.size(), "changes of step %d" % s)
		for c: int in source.steps[s].changes.size():
			var copied: TweenChange = copy.steps[s].changes[c]
			var original: TweenChange = source.steps[s].changes[c]
			assert_ne(copied, original)
			assert_eq(copied.property, original.property)
			assert_eq(copied.target_value, original.target_value)
			assert_eq(copied.use_start_value, original.use_start_value)
			assert_eq(copied.start_value, original.start_value)
			assert_eq(copied.duration, original.duration)
			assert_eq(copied.delay, original.delay)
			assert_eq(copied.easing, original.easing)


func assert_default_change(made: TweenChange, label: String) -> void:
	assert_eq(made.property, TweenCore.TweenProperty.POSITION, label)
	assert_eq(made.target_value, Vector4.ZERO, label)
	assert_false(made.use_start_value, label)
	assert_eq(made.start_value, Vector4.ZERO, label)
	assert_eq(made.duration, 0, label)
	assert_eq(made.delay, 0, label)
	assert_eq(made.easing, TweenCore.Easing.LINEAR, label)


func test_types_have_the_spec_defaults_in_code_and_in_a_preset_that_leaves_fields_out() -> void:
	start()
	assert_default_change(TweenChange.new(), "new change")
	assert_eq(TweenStep.new().changes.size(), 0)
	var made: TweenDefinition = TweenDefinition.new()
	assert_eq(made.steps.size(), 0)
	assert_eq(made.repeat_count, 1)
	var kind: int = TweenCore.get_preset_kind()
	var loaded: Resource = await ResourceCore.load(DEFAULTS, kind, ResourceCore.get_global_scope())
	assert_true(loaded is TweenDefinition)
	var preset: TweenDefinition = loaded as TweenDefinition
	assert_eq(preset.repeat_count, 1, "preset without repeat count")
	assert_eq(preset.steps.size(), 1)
	assert_eq(preset.steps[0].changes.size(), 1)
	assert_default_change(preset.steps[0].changes[0], "preset change without fields")
	assert_eq(errors(), 0)


func test_copy_has_the_structure_of_the_source_and_changing_it_keeps_the_source() -> void:
	start()
	var source: TweenDefinition = source_definition()
	var longer: TweenDefinition = definition([step([change(TweenCore.TweenProperty.ROTATION, Vector4.ONE, 5)]),
			TweenStep.new(), step([])], 4)
	var kept_step: TweenStep = longer.steps[0]
	assert_true(TweenCore.copy_definition(source, longer))
	assert_same_values(longer, source)
	assert_eq(longer.steps[0], kept_step, "the copy reuses its own step object")
	var shorter: TweenDefinition = TweenDefinition.new()
	assert_true(TweenCore.copy_definition(source, shorter))
	assert_same_values(shorter, source)
	shorter.steps[1].changes[0].target_value = Vector4(9, 9, 0, 0)
	shorter.steps[0].changes[0].duration = 1
	shorter.repeat_count = 1
	assert_eq(source.steps[1].changes[0].target_value, Vector4(2, 2, 0, 0))
	assert_eq(source.steps[0].changes[0].duration, 100)
	assert_eq(source.repeat_count, 2)
	var shallow: TweenDefinition = source.duplicate(false) as TweenDefinition
	assert_true(TweenCore.copy_definition(source, shallow))
	shallow.steps[0].changes[0].delay = 77
	assert_eq(source.steps[0].changes[0].delay, 10, "a copy that shared objects with the source gets its own")


func test_copy_errors() -> void:
	start()
	var source: TweenDefinition = source_definition()
	assert_false(TweenCore.copy_definition(source, source))
	assert_false(TweenCore.copy_definition(source, null))
	assert_eq(errors(), 2)
	assert_eq(source.steps.size(), 2, "the copy is not changed")
	var copy: TweenDefinition = source_definition()
	assert_false(TweenCore.copy_definition(null, copy))
	assert_eq(errors(), 1)
	assert_eq(copy.steps.size(), 0, "a missing source makes a definition without step")


func test_tween_reads_the_definition_when_it_starts() -> void:
	start()
	var target: Node2D = node_2d()
	var changed: TweenDefinition = move(100)
	TweenCore.play(changed, target)
	changed.steps[0].changes[0].target_value = Vector4(-500, 0, 0, 0)
	changed.steps[0].changes[0].duration = 1000
	await advance(100)
	assert_eq(target.position, Vector2(100, 0))


func test_check_definition_is_false_without_log_for_each_item_and_true_for_a_good_definition() -> void:
	start()
	var target: Node2D = node_2d()
	var failing: Dictionary[String, TweenDefinition] = failing_definitions()
	for item: String in failing:
		assert_false(TweenCore.check_definition(failing[item], target), item)
	assert_false(TweenCore.check_definition(color_definition(), keep(Node3D.new())), "target without the property")
	assert_true(TweenCore.check_definition(source_definition(), target))
	assert_true(TweenCore.check_definition(definition([]), target), "no step passes")
	var deep: TweenDefinition = single(change(TweenCore.TweenProperty.POSITION, Vector4(10, 20, 5, 0), 100))
	assert_true(TweenCore.check_definition(deep, keep(Node3D.new())), "3D position uses z")
	assert_eq(target.position, Vector2.ZERO)
	assert_eq(target.scale, Vector2.ONE)
	assert_eq(target.modulate, Color.WHITE)
	assert_eq(recorder.started_count, 0)


func test_check_definition_without_definition_or_target_logs() -> void:
	start()
	var freed: Node2D = Node2D.new()
	freed.free()
	assert_false(TweenCore.check_definition(null, node_2d()))
	assert_false(TweenCore.check_definition(move(), null))
	assert_false(TweenCore.check_definition(move(), freed))
	assert_eq(errors(), 3)


func test_evaluate_easing_ends_and_values() -> void:
	start()
	for easing: int in TweenCore.Easing.size():
		assert_eq(TweenCore.evaluate_easing(easing as TweenCore.Easing, 0.0), 0.0, "easing %d at 0" % easing)
		assert_eq(TweenCore.evaluate_easing(easing as TweenCore.Easing, 1.0), 1.0, "easing %d at 1" % easing)
	assert_eq(TweenCore.evaluate_easing(TweenCore.Easing.QUAD_IN, 0.5), 0.25)
	assert_eq(TweenCore.evaluate_easing(TweenCore.Easing.QUAD_IN, 1.5), 1.0)
	assert_eq(TweenCore.evaluate_easing(TweenCore.Easing.QUAD_IN, -0.5), 0.0)
	assert_eq(TweenCore.evaluate_easing(TweenCore.Easing.LINEAR, 0.3), 0.3)
	assert_eq(TweenCore.evaluate_easing(TweenCore.Easing.QUAD_IN, NAN), 0.0)
	assert_eq(errors(), 1, "a progress that is not finite")
	assert_eq(TweenCore.evaluate_easing(99 as TweenCore.Easing, 0.5), 0.0)
	assert_eq(TweenCore.evaluate_easing(-1 as TweenCore.Easing, 1.0), 0.0)
	assert_eq(errors(), 2, "an easing that is not a member")
