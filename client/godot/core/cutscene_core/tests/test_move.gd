extends "res://core/cutscene_core/tests/support/cutscene_test_case.gd"
## Move to the target actor's position, in other parents and with two Position changes, and Camera.


func test_move_puts_the_actor_on_the_world_position_the_target_had_at_the_start() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_move]")
	var target: Vector2 = spot.global_position
	await advance(STEP_MS)
	spot.global_position = Vector2(900, 900)
	await advance(STEP_MS)
	await UnitTestCore.wait_frames(1)
	assert_almost_eq(hero.global_position, target, Vector2(0.01, 0.01))
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	assert_eq(errors(), 0)


func test_move_reaches_the_target_world_position_when_the_parents_differ() -> void:
	assert_true(await start())
	CutsceneCore.unregister_actor("hero")
	hero.queue_free()
	var actor_parent: Node2D = Node2D.new()
	actor_parent.position = Vector2(50, -40)
	actor_parent.rotation_degrees = 30.0
	actor_parent.scale = Vector2(2, 2)
	get_tree().root.add_child(actor_parent)
	autofree(actor_parent)
	var target_parent: Node2D = Node2D.new()
	target_parent.position = Vector2(-120, 70)
	target_parent.scale = Vector2(0.5, 0.5)
	get_tree().root.add_child(target_parent)
	autofree(target_parent)
	CutsceneCore.unregister_actor("spot")
	spot.queue_free()
	var moved: Node2D = make_actor("hero", Vector2(3, 4), actor_parent)
	var target: Node2D = make_actor("spot", Vector2(40, 60), target_parent)
	var call: PLAY = await play("[cut_move]")
	await advance(MOVE_MS)
	await UnitTestCore.wait_frames(1)
	assert_almost_eq(moved.global_position, target.global_position, Vector2(0.01, 0.01))
	await finish(call)
	assert_eq(errors(), 0)


func test_move_with_two_position_changes_takes_the_preset_value_first_then_the_target() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_move_two]")
	await advance(STEP_MS)
	assert_almost_eq(hero.position, Vector2(5, 5), Vector2(0.01, 0.01), "the first change goes to its preset value")
	await advance(STEP_MS)
	await UnitTestCore.wait_frames(1)
	assert_almost_eq(hero.global_position, spot.global_position, Vector2(0.01, 0.01))
	await finish(call)
	assert_eq(errors(), 0)


func test_camera_ends_with_the_camera_on_the_target() -> void:
	assert_true(await start())
	var camera: Camera2D = Camera2D.new()
	get_tree().root.add_child(camera)
	autofree(camera)
	assert_true(CameraCore.attach_camera(camera))
	var call: PLAY = await play("[cut_camera]")
	assert_eq(cue_steps.size(), 0, "Camera waits for the camera move")
	for i: int in 5:
		await advance(MOVE_MS)
		if call.done:
			break
	await finish(call)
	assert_eq(cue_steps, PackedInt64Array([2]))
	var center: Vector3 = CameraCore.get_view_center()
	assert_almost_eq(Vector2(center.x, center.y), spot.global_position, Vector2(0.01, 0.01))
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	assert_eq(errors(), 0)
