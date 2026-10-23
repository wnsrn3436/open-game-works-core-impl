extends "res://core/camera_core/tests/support/camera_test_case.gd"
## Attaching the game camera, a destroyed camera and the operations while no camera is attached.


func test_attaching_a_new_camera_clears_follow_bounds_and_shake_and_cancels_the_move() -> void:
	assert_true(start())
	var first: Camera2D = camera_2d()
	assert_true(CameraCore.attach_camera(first))
	var target: Node2D = target_2d(Vector2(50, 0))
	assert_true(follow(target))
	await frame_end()
	assert_true(CameraCore.set_bounds(Rect2(-5000, -5000, 10000, 10000)))
	CameraCoreDev.set_shake_seed(SEED)
	CameraCore.shake(1.0)
	run_move(Vector3(500, 0, 0), 1000)
	run_zoom(2.0, 1000)
	await advance(100)
	assert_ne(shake_offset(), Vector3.ZERO, "the first camera shakes")
	var reference: Vector3 = CameraCore.get_view_center()
	var second: Camera2D = camera_2d(Vector2(7, 8))
	assert_true(CameraCore.attach_camera(second))
	assert_results([CANCELLED, CANCELLED])
	assert_eq(CameraCore.get_zoom(), 1.0, "the new camera is at zoom factor 1")
	assert_eq(first.global_position, Vector2(reference.x, reference.y), "the first camera keeps no shake offset")
	assert_eq(CameraCore._follow_id, 0, "no follow")
	assert_false(CameraCore._has_bounds, "no bounds")
	assert_eq(CameraCore._trauma, 0.0, "no trauma")
	assert_center(Vector3(7, 8, 0))
	target.position = Vector2(900, 900)
	await advance(100)
	assert_center(Vector3(7, 8, 0))
	assert_eq(second.global_position, Vector2(7, 8), "the new camera neither follows nor shakes")
	assert_eq(second.zoom, Vector2.ONE, "the new camera does not zoom")
	assert_results([CANCELLED, CANCELLED])


func test_a_caller_cancelled_by_attach_camera_that_attaches_another_camera_leaves_only_that_camera() -> void:
	assert_true(start())
	assert_true(CameraCore.attach_camera(camera_2d()))
	var third: Camera3D = camera_3d()
	_move_then_attach(third)
	var second: Camera2D = camera_2d(Vector2(7, 8))
	assert_true(CameraCore.attach_camera(second))
	assert_results([CANCELLED])
	assert_eq(CameraCore._camera_id, third.get_instance_id(), "the camera the cancelled caller attached")
	assert_null(CameraCore._camera_2d, "no 2D camera is left")
	assert_eq(CameraCore._camera_3d, third)
	assert_true(follow(target_3d(Vector3(1, 0, 2))), "a 3D target can be followed")
	assert_eq(errors(), 0)


func test_detach_camera_and_destroying_the_camera_cancel_the_running_zoom() -> void:
	assert_true(start())
	assert_true(CameraCore.attach_camera(camera_2d()))
	run_zoom(2.0, 1000)
	await advance(100)
	CameraCore.detach_camera()
	assert_results([CANCELLED])
	var camera: Camera3D = camera_3d()
	assert_true(CameraCore.attach_camera(camera))
	run_zoom(2.0, 1000)
	await advance(100)
	camera.free()
	await frame_end()
	assert_results([CANCELLED, CANCELLED])
	assert_false(CameraCore.has_camera())
	assert_eq(errors(), 0)


func test_destroying_the_attached_camera_detaches_it_without_a_log_and_shake_then_logs() -> void:
	assert_true(start())
	var camera: Camera2D = camera_2d()
	assert_true(CameraCore.attach_camera(camera))
	camera.free()
	await frame_end()
	assert_false(CameraCore.has_camera())
	assert_eq(CameraCore._camera_id, 0)
	CameraCore.shake(1.0)
	assert_eq(errors(), 1)


func test_has_camera_is_false_without_a_camera_true_after_attach_and_false_after_destruction() -> void:
	assert_true(start())
	assert_false(CameraCore.has_camera())
	var camera: Camera3D = camera_3d()
	assert_true(CameraCore.attach_camera(camera))
	assert_true(CameraCore.has_camera())
	camera.free()
	assert_false(CameraCore.has_camera())


func test_is_3d_camera_is_false_without_a_camera_false_for_a_2d_camera_and_true_for_a_3d_camera() -> void:
	assert_true(start())
	assert_false(CameraCore.is_3d_camera())
	assert_eq(errors(), 0, "no log without a camera")
	assert_true(CameraCore.attach_camera(camera_2d()))
	assert_false(CameraCore.is_3d_camera())
	var camera: Camera3D = camera_3d()
	assert_true(CameraCore.attach_camera(camera))
	assert_true(CameraCore.is_3d_camera())
	camera.free()
	assert_false(CameraCore.is_3d_camera())
	assert_false(CameraCore.has_camera(), "the destroyed camera is detached")
	assert_true(CameraCore.attach_camera(camera_2d()))
	assert_false(CameraCore.is_3d_camera(), "a 2D camera after a 3D camera")
	CameraCore.detach_camera()
	assert_false(CameraCore.is_3d_camera())
	assert_eq(errors(), 0)


func test_without_a_camera_move_by_preset_fails_get_zoom_is_one_and_shake_scale_still_changes() -> void:
	assert_true(start())
	var result: CameraCore.CameraMoveResult = await CameraCore.move_by_preset(
		Vector3.ZERO, MOVE, ResourceCore.get_global_scope()
	)
	assert_eq(result, FAILED)
	assert_eq(errors(), 1)
	assert_false(ResourceCore.is_loaded(MOVE, TweenCore.get_preset_kind()), "the tween preset was not loaded")
	assert_eq(CameraCore.get_zoom(), 1.0)
	assert_eq(errors(), 1)
	CameraCore.set_shake_scale(500)
	var half: PackedVector3Array = await shake_offsets(10)
	CameraCore.set_shake_scale(1000)
	var full: PackedVector3Array = await shake_offsets(10)
	var moved: bool = false
	for index: int in full.size():
		assert_almost_eq(half[index].x, full[index].x * 0.5, 0.00001, "frame %d x" % index)
		assert_almost_eq(half[index].y, full[index].y * 0.5, 0.00001, "frame %d y" % index)
		moved = moved or full[index] != Vector3.ZERO
	assert_true(moved, "the camera shook")


func test_attach_camera_rejects_a_missing_destroyed_or_non_camera_object() -> void:
	assert_true(start())
	var camera: Camera2D = camera_2d(Vector2(3, 4))
	assert_true(CameraCore.attach_camera(camera))
	assert_false(CameraCore.attach_camera(null))
	assert_false(CameraCore.attach_camera(target_2d()))
	var freed: Camera2D = Camera2D.new()
	freed.free()
	assert_false(CameraCore.attach_camera(freed))
	assert_eq(errors(), 3)
	assert_true(CameraCore.has_camera(), "the attached camera stays")
	assert_center(Vector3(3, 4, 0))


func test_operations_without_a_camera_log_an_error_and_return_their_failure_values() -> void:
	assert_true(start())
	assert_false(follow(target_2d()))
	assert_eq(await CameraCore.move_to(Vector3.ONE, 0, LINEAR, GAME), FAILED)
	assert_false(CameraCore.snap_to(Vector3.ONE))
	assert_eq(await CameraCore.zoom_to(2.0, 0, LINEAR, GAME), FAILED)
	assert_false(CameraCore.set_bounds(Rect2(0, 0, 10, 10)))
	CameraCore.shake(1.0)
	assert_eq(CameraCore.get_view_center(), Vector3.ZERO)
	assert_eq(CameraCore.screen_to_world(Vector2(10, 10)), Vector3.ZERO)
	assert_eq(CameraCore.world_to_screen(Vector3.ONE), Vector2.ZERO)
	assert_eq(errors(), 9)
	assert_eq(shake_events, 0)
	CameraCore.detach_camera()
	CameraCore.stop_follow()
	CameraCore.stop_move()
	CameraCore.stop_shake()
	CameraCore.clear_bounds()
	assert_false(CameraCore.has_camera())
	assert_false(CameraCore.is_3d_camera())
	assert_eq(errors(), 0, "no log from the operations without a failure log")


## Starts `move_to`, appends its result to `results` and then attaches `camera`.
func _move_then_attach(camera: Camera3D) -> void:
	var result: CameraCore.CameraMoveResult = await CameraCore.move_to(Vector3(1000, 0, 0), 1000, LINEAR, GAME)
	results.append(result)
	assert_true(CameraCore.attach_camera(camera), "attach in the cancelled caller")
