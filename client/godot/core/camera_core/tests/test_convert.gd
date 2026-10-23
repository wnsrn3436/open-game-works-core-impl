extends "res://core/camera_core/tests/support/camera_test_case.gd"
## Conversion between game coordinates and world positions, and UI layers outside the game camera.

const TOLERANCE: float = 0.01


func test_2d_screen_to_world_of_world_to_screen_is_the_point_also_during_zoom_and_shake() -> void:
	assert_true(start())
	assert_true(CameraCore.attach_camera(camera_2d()))
	assert_true(CameraCore.snap_to(Vector3(123, -45, 0)))
	var points: PackedVector3Array = PackedVector3Array([
		Vector3(123, -45, 0), Vector3(0, 0, 0), Vector3(400, 200, 0), Vector3(-310.5, 77.25, 0),
	])
	_assert_round_trip(points, "still")
	assert_eq(await CameraCore.zoom_to(2.5, 0, LINEAR, GAME), COMPLETED)
	CameraCoreDev.set_shake_seed(SEED)
	CameraCore.shake(1.0)
	await advance(30)
	assert_ne(CameraCore._shake_rotation, 0.0, "the camera is rotated by the shake")
	_assert_round_trip(points, "zoom and shake")


func test_3d_screen_to_world_of_world_to_screen_is_a_height_zero_point() -> void:
	assert_true(start())
	assert_true(CameraCore.attach_camera(camera_3d()))
	var points: PackedVector3Array = PackedVector3Array([
		Vector3(0, 0, 0), Vector3(5, 0, -3), Vector3(-7, 0, 2), Vector3(3.5, 0, -12),
	])
	_assert_round_trip(points, "3D")
	var center: Vector3 = CameraCore.screen_to_world(Vector2(SCREEN) / 2.0)
	assert_almost_eq(center.y, 0.0, 0.0001, "screen_to_world is on the height 0 plane")


func test_3d_world_to_screen_behind_the_camera_and_before_the_near_plane_is_the_origin_with_an_error() -> void:
	assert_true(start())
	var camera: Camera3D = camera_3d()
	assert_true(CameraCore.attach_camera(camera))
	var basis: Basis = camera.global_transform.basis
	var behind: Vector3 = camera.global_position + basis.z * 5.0
	assert_eq(CameraCore.world_to_screen(behind), Vector2.ZERO)
	assert_eq(errors(), 1)
	var before_near: Vector3 = camera.global_position - basis.z * (camera.near * 0.5)
	assert_eq(CameraCore.world_to_screen(before_near), Vector2.ZERO)
	assert_eq(errors(), 1)


func test_3d_screen_to_world_without_a_ground_intersection_is_the_origin_with_an_error() -> void:
	assert_true(start())
	assert_true(CameraCore.attach_camera(camera_3d(0.0, Vector3(0, 10, 0))))
	assert_eq(CameraCore.screen_to_world(Vector2(SCREEN.x / 2.0, 0.0)), Vector3.ZERO)
	assert_eq(errors(), 1)


func test_ui_layer_elements_keep_their_screen_position_during_move_zoom_and_shake() -> void:
	assert_true(start())
	var layer: CanvasLayer = keep(CanvasLayer.new()) as CanvasLayer
	var element: Control = Control.new()
	element.position = Vector2(100, 120)
	layer.add_child(element)
	var world_item: Node2D = target_2d(Vector2(100, 120))
	assert_true(CameraCore.attach_camera(camera_2d()))
	await frame_end()
	var element_before: Vector2 = element.get_global_transform_with_canvas().origin
	var world_before: Vector2 = world_item.get_global_transform_with_canvas().origin
	run_move(Vector3(300, 200, 0), 100)
	run_zoom(2.0, 100)
	CameraCoreDev.set_shake_seed(SEED)
	CameraCore.shake(1.0)
	await advance(50)
	assert_eq(element.get_global_transform_with_canvas().origin, element_before, "the UI element stays")
	assert_ne(world_item.get_global_transform_with_canvas().origin, world_before, "a world object moves on screen")


func test_conversions_reject_nan_input() -> void:
	assert_true(start())
	assert_true(CameraCore.attach_camera(camera_2d()))
	assert_eq(CameraCore.screen_to_world(Vector2(NAN, 0)), Vector3.ZERO)
	assert_eq(CameraCore.world_to_screen(Vector3(0, INF, 0)), Vector2.ZERO)
	assert_eq(errors(), 2)


func _assert_round_trip(points: PackedVector3Array, label: String) -> void:
	for point: Vector3 in points:
		var back: Vector3 = CameraCore.screen_to_world(CameraCore.world_to_screen(point))
		assert_almost_eq(back.x, point.x, TOLERANCE, "%s x of %s" % [label, point])
		assert_almost_eq(back.y, point.y, TOLERANCE, "%s y of %s" % [label, point])
		assert_almost_eq(back.z, point.z, TOLERANCE, "%s z of %s" % [label, point])
