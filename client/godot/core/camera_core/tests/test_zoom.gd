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


func test_a_failed_zoom_to_leaves_the_running_zoom_to_complete() -> void:
	assert_true(start())
	assert_true(CameraCore.attach_camera(camera_2d()))
	run_zoom(2.0, 200)
	assert_eq(await CameraCore.zoom_to(0.0, 0, LINEAR, GAME), FAILED)
	assert_eq(await CameraCore.zoom_to(NAN, 0, LINEAR, GAME), FAILED)
	assert_eq(errors(), 2)
	assert_results([])
	await advance(100)
	assert_almost_eq(CameraCore.get_zoom(), 1.5, 0.0001)
	await advance(100)
	assert_results([COMPLETED])
	assert_eq(CameraCore.get_zoom(), 2.0)


func test_attach_camera_keeps_the_camera_zoom_as_factor_one_and_the_view_follows_the_factor() -> void:
	assert_true(start())
	var zoomed: Camera2D = camera_2d()
	zoomed.zoom = Vector2(1.5, 1.5)
	var perspective: Camera3D = camera_3d()
	perspective.fov = 50.0
	var orthographic: Camera3D = camera_3d()
	orthographic.projection = Camera3D.PROJECTION_ORTHOGONAL
	orthographic.size = 12.0
	assert_true(CameraCore.attach_camera(zoomed))
	assert_eq(CameraCore.get_zoom(), 1.0)
	assert_eq(zoomed.zoom, Vector2(1.5, 1.5))
	await advance(16)
	assert_eq(zoomed.zoom, Vector2(1.5, 1.5), "after a frame")
	assert_true(CameraCore.attach_camera(perspective))
	assert_eq(CameraCore.get_zoom(), 1.0)
	await advance(16)
	assert_eq(perspective.fov, 50.0)
	assert_true(CameraCore.attach_camera(orthographic))
	assert_eq(CameraCore.get_zoom(), 1.0)
	await advance(16)
	assert_eq(orthographic.size, 12.0)
	assert_true(CameraCore.attach_camera(camera_2d()))
	assert_eq(await CameraCore.zoom_to(2.0, 0, LINEAR, GAME), COMPLETED)
	var at_two: float = view_diagonal()
	assert_eq(await CameraCore.zoom_to(1.0, 0, LINEAR, GAME), COMPLETED)
	var at_one: float = view_diagonal()
	assert_almost_eq(at_one / at_two, 2.0, 0.02, "zoom_to(1, 0) is applied in the call")
	run_zoom(3.0, 500)
	for step: int in 10:
		await advance(50)
		var expected: float = at_one / CameraCore.get_zoom()
		assert_almost_eq(view_diagonal(), expected, expected * 0.01, "frame %d" % step)
	assert_results([COMPLETED])
	assert_eq(errors(), 0)


func test_detach_and_release_keep_the_camera_zoom_as_the_next_factor_one() -> void:
	assert_true(start())
	var camera: Camera2D = camera_2d()
	assert_true(CameraCore.attach_camera(camera))
	var first: float = view_diagonal()
	assert_eq(await CameraCore.zoom_to(2.0, 0, LINEAR, GAME), COMPLETED)
	CameraCore.detach_camera()
	assert_eq(camera.zoom, Vector2(2, 2), "detach keeps the zoom")
	assert_true(CameraCore.attach_camera(camera))
	assert_eq(CameraCore.get_zoom(), 1.0)
	assert_almost_eq(view_diagonal(), first / 2.0, first * 0.005)
	var other: Camera2D = camera_2d()
	assert_true(CameraCore.attach_camera(other))
	first = view_diagonal()
	assert_eq(await CameraCore.zoom_to(2.0, 0, LINEAR, GAME), COMPLETED)
	CameraCore.release()
	assert_eq(other.zoom, Vector2(2, 2), "release keeps the zoom")
	assert_true(CameraCore.init())
	assert_true(CameraCore.attach_camera(other))
	assert_eq(CameraCore.get_zoom(), 1.0)
	assert_almost_eq(view_diagonal(), first / 2.0, first * 0.005)
	assert_eq(errors(), 0)
