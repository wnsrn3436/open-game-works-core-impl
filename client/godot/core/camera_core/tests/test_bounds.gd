extends "res://core/camera_core/tests/support/camera_test_case.gd"
## Screen bounds of 2D and 3D cameras, the game area change and the view center without the shake offset.

const TOLERANCE: float = 0.01


func test_2d_view_range_stays_inside_the_bounds_and_a_longer_axis_is_centered() -> void:
	assert_true(start())
	assert_true(CameraCore.attach_camera(camera_2d()))
	# the 1280x720 view range is longer than the bounds on x and shorter on y
	var bounds: Rect2 = Rect2(-400, -500, 1000, 1000)
	assert_true(CameraCore.set_bounds(bounds))
	var target: Node2D = target_2d()
	assert_true(follow(target))
	var targets: PackedVector2Array = PackedVector2Array([
		Vector2(0, 0), Vector2(2000, 2000), Vector2(-2000, -2000), Vector2(300, 100), Vector2(0, -450),
	])
	for target_position: Vector2 in targets:
		target.position = target_position
		await frame_end()
		var view: Rect2 = view_range()
		assert_almost_eq(view.get_center().x, bounds.get_center().x, TOLERANCE, "x is centered for %s" % target_position)
		assert_true(view.position.y >= bounds.position.y - TOLERANCE, "top inside for %s" % target_position)
		assert_true(view.end.y <= bounds.end.y + TOLERANCE, "bottom inside for %s" % target_position)
	CameraCore.clear_bounds()
	target.position = Vector2(2000, 2000)
	await frame_end()
	assert_center(Vector3(2000, 2000, 0))


func test_tilted_3d_perspective_view_corners_stay_inside_the_bounds_at_the_same_height() -> void:
	assert_true(start())
	var camera: Camera3D = camera_3d(-60.0)
	assert_true(CameraCore.attach_camera(camera))
	var bounds: Rect2 = Rect2(-200, -150, 400, 300)
	assert_true(CameraCore.set_bounds(bounds))
	var target: Node3D = target_3d()
	assert_true(follow(target, 0, Vector3.ZERO, Vector3(0, 10, 10)))
	var targets: PackedVector3Array = PackedVector3Array([
		Vector3(0, 0, 0), Vector3(500, 0, 500), Vector3(-500, 0, -500), Vector3(150, 0, -80), Vector3(-190, 0, 140),
	])
	var zooms: PackedFloat64Array = PackedFloat64Array([1.0, 2.0, 0.75])
	for zoom: float in zooms:
		assert_eq(await CameraCore.zoom_to(zoom, 0, LINEAR, GAME), COMPLETED)
		for target_position: Vector3 in targets:
			target.position = target_position
			await frame_end()
			var corners: PackedVector2Array = screen_corners()
			for corner: Vector2 in corners:
				var world: Vector3 = CameraCore.screen_to_world(corner)
				var label: String = "corner %s, zoom %s, target %s" % [corner, zoom, target_position]
				assert_true(world.x >= bounds.position.x - TOLERANCE and world.x <= bounds.end.x + TOLERANCE, label)
				assert_true(world.z >= bounds.position.y - TOLERANCE and world.z <= bounds.end.y + TOLERANCE, label)
			assert_almost_eq(CameraCore.get_view_center().y, 10.0, 0.0001, "the height stays")
			assert_almost_eq(camera.global_position.y, 10.0, 0.0001, "the camera height stays")


func test_3d_camera_looking_above_the_horizon_does_not_fit_the_bounds_and_logs_once() -> void:
	assert_true(start())
	assert_true(CameraCore.attach_camera(camera_3d(0.0, Vector3(0, 10, 0))))
	assert_true(CameraCore.set_bounds(Rect2(-10, -10, 20, 20)))
	var target: Node3D = target_3d(Vector3(1000, 0, 0))
	assert_true(follow(target, 0, Vector3.ZERO, Vector3(0, 10, 0)))
	for step: int in 5:
		await advance(16)
	assert_eq(errors(), 1)
	assert_center(Vector3(1000, 10, 0))


func test_after_a_game_area_change_the_next_frame_fits_the_changed_view_range() -> void:
	assert_true(start())
	assert_true(CameraCore.attach_camera(camera_2d()))
	var bounds: Rect2 = Rect2(-1000, -1000, 2000, 2000)
	assert_true(CameraCore.set_bounds(bounds))
	assert_true(CameraCore.snap_to(Vector3(0, 2000, 0)))
	assert_center(Vector3(0, 1000 - SCREEN.y / 2.0, 0))
	var latch: UnitTestLatch = UnitTestCore.latch_event(GameAreaChangedEvent)
	# a taller window: the visible game area becomes 1280x1080
	ResolutionCoreDev.set_test_screen(SCREEN, Vector2i(1280, 1440), ResolutionCore.FillMode.LETTERBOX, false)
	assert_true(await UnitTestCore.wait_latch(latch))
	var visible: Rect2 = ResolutionCore.get_visible_game_area()
	assert_almost_eq(visible.size.y, 1080.0, 0.001)
	await frame_end()
	assert_center(Vector3(0, 1000 - visible.size.y / 2.0, 0))
	var view: Rect2 = view_range()
	assert_true(view.end.y <= bounds.end.y + TOLERANCE)


func test_view_center_is_the_fitted_reference_without_the_shake_offset_in_2d_and_3d() -> void:
	assert_true(start())
	var camera_2: Camera2D = camera_2d()
	assert_true(CameraCore.attach_camera(camera_2))
	assert_true(CameraCore.set_bounds(Rect2(-1000, -1000, 2000, 2000)))
	assert_true(CameraCore.snap_to(Vector3(1000, 20, 0)))
	CameraCoreDev.set_shake_seed(SEED)
	CameraCore.shake(1.0)
	await advance(16)
	assert_center(Vector3(1000 - SCREEN.x / 2.0, 20, 0))
	assert_ne(shake_offset(), Vector3.ZERO, "the 2D camera is shaken")
	var camera_3: Camera3D = camera_3d()
	assert_true(CameraCore.attach_camera(camera_3))
	CameraCoreDev.set_shake_seed(SEED)
	CameraCore.shake(1.0)
	await advance(16)
	assert_center(Vector3(0, 10, 10))
	assert_ne(camera_3.global_position, Vector3(0, 10, 10), "the 3D camera is shaken")
	assert_eq(camera_3.global_position, CameraCore.get_view_center() + CameraCore._shake_offset)
	CameraCore.stop_shake()
	assert_eq(camera_3.global_position, CameraCore.get_view_center(), "without shake the view center is the camera")


func test_set_bounds_rejects_a_size_of_zero_or_less_and_keeps_the_previous_bounds() -> void:
	assert_true(start())
	assert_true(CameraCore.attach_camera(camera_2d()))
	var bounds: Rect2 = Rect2(-1000, -1000, 2000, 2000)
	assert_true(CameraCore.set_bounds(bounds))
	assert_false(CameraCore.set_bounds(Rect2(0, 0, 0, 10)))
	assert_false(CameraCore.set_bounds(Rect2(0, 0, 10, -1)))
	assert_false(CameraCore.set_bounds(Rect2(NAN, 0, 10, 10)))
	assert_eq(errors(), 3)
	assert_eq(CameraCore._bounds, bounds)
