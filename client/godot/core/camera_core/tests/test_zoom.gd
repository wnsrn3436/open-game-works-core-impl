extends "res://core/camera_core/tests/support/camera_test_case.gd"
## `zoom_to` and `get_zoom`.


func test_zoom_out_of_range_stops_at_the_limits_and_zoom_two_halves_the_view_range() -> void:
	assert_true(start())
	var camera: Camera2D = camera_2d()
	assert_true(CameraCore.attach_camera(camera))
	var one: Rect2 = view_range()
	assert_almost_eq(one.size.x, float(SCREEN.x), 0.001)
	assert_eq(await CameraCore.zoom_to(10.0, 0, LINEAR, GAME), COMPLETED)
	assert_eq(CameraCore.get_zoom(), MAX_ZOOM)
	assert_eq(await CameraCore.zoom_to(0.1, 0, LINEAR, GAME), COMPLETED)
	assert_eq(CameraCore.get_zoom(), MIN_ZOOM)
	assert_eq(await CameraCore.zoom_to(2.0, 0, LINEAR, GAME), COMPLETED)
	var two: Rect2 = view_range()
	assert_almost_eq(two.size.x, one.size.x / 2.0, 0.001, "x length at zoom 2")
	assert_almost_eq(two.size.y, one.size.y / 2.0, 0.001, "y length at zoom 2")
	assert_eq(camera.zoom, Vector2(2, 2))


func test_zoom_of_a_3d_camera_narrows_the_perspective_and_orthographic_view() -> void:
	assert_true(start())
	var perspective: Camera3D = camera_3d()
	perspective.fov = 90.0
	assert_true(CameraCore.attach_camera(perspective))
	assert_eq(await CameraCore.zoom_to(2.0, 0, LINEAR, GAME), COMPLETED)
	assert_almost_eq(tan(deg_to_rad(perspective.fov) / 2.0), 0.5, 0.00001)
	var orthographic: Camera3D = camera_3d()
	orthographic.projection = Camera3D.PROJECTION_ORTHOGONAL
	orthographic.size = 20.0
	assert_true(CameraCore.attach_camera(orthographic))
	assert_eq(await CameraCore.zoom_to(2.5, 0, LINEAR, GAME), COMPLETED)
	assert_almost_eq(orthographic.size, 8.0, 0.00001)


func test_zero_duration_completes_in_the_call_and_a_new_zoom_cancels_and_starts_from_the_current_factor() -> void:
	assert_true(start())
	var camera: Camera2D = camera_2d()
	assert_true(CameraCore.attach_camera(camera))
	assert_eq(await CameraCore.zoom_to(2.0, 0, LINEAR, GAME), COMPLETED)
	assert_eq(CameraCore.get_zoom(), 2.0)
	assert_eq(camera.zoom, Vector2(2, 2), "applied in the call")
	assert_eq(await CameraCore.zoom_to(1.0, 0, LINEAR, GAME), COMPLETED)
	run_zoom(3.0, 1000)
	await advance(500)
	assert_almost_eq(CameraCore.get_zoom(), 2.0, 0.0001)
	run_zoom(1.0, 1000)
	assert_results([CANCELLED])
	assert_almost_eq(CameraCore.get_zoom(), 2.0, 0.0001)
	await advance(500)
	assert_almost_eq(CameraCore.get_zoom(), 1.5, 0.0001)
	await advance(500)
	assert_results([CANCELLED, COMPLETED])
	assert_eq(CameraCore.get_zoom(), 1.0)


func test_zoom_to_rejects_a_factor_of_zero_or_less_and_nan() -> void:
	assert_true(start())
	assert_true(CameraCore.attach_camera(camera_2d()))
	assert_eq(await CameraCore.zoom_to(0.0, 0, LINEAR, GAME), FAILED)
	assert_eq(await CameraCore.zoom_to(-1.0, 0, LINEAR, GAME), FAILED)
	assert_eq(await CameraCore.zoom_to(NAN, 0, LINEAR, GAME), FAILED)
	assert_eq(await CameraCore.zoom_to(2.0, MAX_DURATION_MS + 1, LINEAR, GAME), FAILED)
	assert_eq(errors(), 4)
	assert_eq(CameraCore.get_zoom(), 1.0)
