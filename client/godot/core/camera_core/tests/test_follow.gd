extends "res://core/camera_core/tests/support/camera_test_case.gd"
## Follow: smoothing, dead zone, the game time pause, a destroyed target and the follow input check.


func test_smooth_time_zero_goes_to_the_target_in_the_frame_and_smooth_time_t_leaves_e_to_the_minus_one() -> void:
	assert_true(start())
	assert_true(CameraCore.attach_camera(camera_2d()))
	var target: Node2D = target_2d(Vector2(100, 40))
	assert_true(follow(target, 0, Vector3.ZERO, Vector3(5, 0, 0)))
	await frame_end()
	assert_center(Vector3(105, 40, 0))
	assert_true(CameraCore.snap_to(Vector3.ZERO))
	target.position = Vector2(100, 0)
	assert_true(follow(target, 1000))
	for step: int in 10:
		await advance(100)
	var remaining: float = 100.0 - CameraCore.get_view_center().x
	assert_almost_eq(remaining / 100.0, exp(-1.0), 0.01, "remaining distance ratio after the smooth time")


func test_smooth_follow_of_a_3d_camera_moves_every_axis() -> void:
	assert_true(start())
	assert_true(CameraCore.attach_camera(camera_3d(-60.0, Vector3.ZERO)))
	var target: Node3D = target_3d(Vector3(100, 50, -100))
	assert_true(follow(target, 500))
	for step: int in 5:
		await advance(100)
	var ratio: float = exp(-1.0)
	assert_center(Vector3(100, 50, -100) * (1.0 - ratio), 0.5)


func test_dead_zone_keeps_the_reference_inside_and_follows_to_the_edge_outside() -> void:
	assert_true(start())
	assert_true(CameraCore.attach_camera(camera_2d()))
	var target: Node2D = target_2d()
	assert_true(follow(target, 0, Vector3(100, 60, 0)))
	await frame_end()
	assert_center(Vector3.ZERO)
	target.position = Vector2(30, -20)
	await frame_end()
	assert_center(Vector3.ZERO)
	target.position = Vector2(80, 0)
	await frame_end()
	assert_center(Vector3(30, 0, 0))
	target.position = Vector2(80, -70)
	await frame_end()
	assert_center(Vector3(30, -40, 0))
	assert_almost_eq(target.position.x - CameraCore.get_view_center().x, 50.0, 0.0001, "the target is on the x edge")


func test_reference_stays_during_the_game_time_pause() -> void:
	assert_true(start())
	assert_true(CameraCore.attach_camera(camera_2d()))
	var target: Node2D = target_2d(Vector2(10, 10))
	assert_true(follow(target))
	await frame_end()
	TimeCore.set_paused(true)
	target.position = Vector2(300, 0)
	await advance(100)
	assert_center(Vector3(10, 10, 0))
	TimeCore.set_paused(false)
	await frame_end()
	assert_center(Vector3(300, 0, 0))


func test_destroying_the_target_ends_follow_and_keeps_the_reference_without_a_log() -> void:
	assert_true(start())
	assert_true(CameraCore.attach_camera(camera_2d()))
	var target: Node2D = target_2d(Vector2(60, 70))
	assert_true(follow(target, 200))
	await advance(100)
	var before: Vector3 = CameraCore.get_view_center()
	target.free()
	await advance(100)
	assert_center(before)
	assert_eq(CameraCore._follow_id, 0, "follow ended")


func test_follow_rejects_a_bad_target_or_options_and_keeps_the_previous_follow() -> void:
	assert_true(start())
	assert_true(CameraCore.attach_camera(camera_2d()))
	var target: Node2D = target_2d(Vector2(20, 0))
	assert_true(follow(target))
	var freed: Node2D = Node2D.new()
	freed.free()
	assert_false(CameraCore.follow(null, FollowOptions.new()))
	assert_false(CameraCore.follow(freed, FollowOptions.new()))
	assert_false(CameraCore.follow(target_3d(), FollowOptions.new()))
	assert_false(follow(target_2d(), -1))
	assert_false(follow(target_2d(), 0, Vector3(10, -1, 0)))
	assert_false(follow(target_2d(), 0, Vector3(NAN, 0, 0)))
	assert_eq(errors(), 6)
	target.position = Vector2(40, 0)
	await frame_end()
	assert_center(Vector3(40, 0, 0))
