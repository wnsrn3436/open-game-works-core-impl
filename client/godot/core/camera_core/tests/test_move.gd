extends "res://core/camera_core/tests/support/camera_test_case.gd"
## `move_to`, `move_by_preset`, `stop_move` and `snap_to`.


func test_zero_duration_completes_in_the_call_and_new_move_snap_and_stop_cancel_the_running_move() -> void:
	assert_true(start())
	var camera: Camera2D = camera_2d()
	assert_true(CameraCore.attach_camera(camera))
	var result: CameraCore.CameraMoveResult = await CameraCore.move_to(Vector3(40, 30, 0), 0, LINEAR, GAME)
	assert_eq(result, COMPLETED)
	assert_center(Vector3(40, 30, 0))
	assert_eq(camera.global_position, Vector2(40, 30), "applied in the call")
	run_move(Vector3(100, 0, 0), 1000)
	run_move(Vector3(200, 0, 0), 1000)
	assert_results([CANCELLED])
	assert_true(CameraCore.snap_to(Vector3(5, 5, 0)))
	assert_results([CANCELLED, CANCELLED])
	assert_center(Vector3(5, 5, 0))
	assert_eq(camera.global_position, Vector2(5, 5), "snap is applied in the call")
	run_move(Vector3(105, 5, 0), 1000)
	await advance(500)
	assert_center(Vector3(55, 5, 0), 0.001)
	CameraCore.stop_move()
	assert_results([CANCELLED, CANCELLED, CANCELLED])
	await advance(500)
	assert_center(Vector3(55, 5, 0), 0.001)


func test_move_to_ends_follow_and_completes_at_the_end_position() -> void:
	assert_true(start())
	assert_true(CameraCore.attach_camera(camera_2d()))
	var target: Node2D = target_2d(Vector2(-50, 0))
	assert_true(follow(target))
	await frame_end()
	run_move(Vector3(50, 0, 0), 200)
	target.position = Vector2(-500, 0)
	await advance(100)
	assert_center(Vector3(0, 0, 0), 0.001)
	await advance(100)
	assert_results([COMPLETED])
	assert_center(Vector3(50, 0, 0))
	await advance(100)
	assert_center(Vector3(50, 0, 0))


func test_stop_move_keeps_follow() -> void:
	assert_true(start())
	assert_true(CameraCore.attach_camera(camera_2d()))
	run_move(Vector3(100, 0, 0), 1000)
	var target: Node2D = target_2d(Vector2(0, 80))
	assert_true(follow(target))
	assert_results([CANCELLED])
	CameraCore.stop_move()
	await frame_end()
	assert_center(Vector3(0, 80, 0))


func test_move_by_preset_completes_at_the_position_after_the_first_change_duration() -> void:
	assert_true(start())
	assert_true(CameraCore.attach_camera(camera_2d()))
	run_preset(Vector3(200, 0, 0))
	await preset_loaded()
	await advance(MOVE_MS / 2)
	assert_center(Vector3(100, 0, 0), 0.001)
	assert_results([])
	await advance(MOVE_MS / 2)
	assert_results([COMPLETED])
	assert_center(Vector3(200, 0, 0))


func test_move_by_preset_progresses_on_game_time_and_stays_during_the_pause() -> void:
	assert_true(start())
	assert_true(CameraCore.attach_camera(camera_2d()))
	run_preset(Vector3(200, 0, 0))
	await preset_loaded()
	TimeCore.set_paused(true)
	await advance(MOVE_MS)
	TimeCore.set_paused(false)
	assert_center(Vector3.ZERO)
	assert_results([])
	await advance(MOVE_MS / 2)
	assert_center(Vector3(100, 0, 0), 0.001)
	await advance(MOVE_MS / 2)
	assert_results([COMPLETED])
	assert_center(Vector3(200, 0, 0))


func test_move_by_preset_of_a_missing_preset_fails() -> void:
	assert_true(start())
	assert_true(CameraCore.attach_camera(camera_2d()))
	var result: CameraCore.CameraMoveResult = await CameraCore.move_by_preset(
		Vector3(10, 0, 0), MISSING, ResourceCore.get_global_scope()
	)
	assert_eq(result, FAILED)
	assert_eq(errors(), 1)
	assert_eq(UnitTestCore.check_logs(ERROR, "ResourceCore"), 1)
	assert_center(Vector3.ZERO)


func test_game_time_move_stays_during_the_pause_and_quad_in_is_a_quarter_at_half_time() -> void:
	assert_true(start())
	assert_true(CameraCore.attach_camera(camera_2d()))
	run_move(Vector3(100, 0, 0), 1000)
	await advance(200)
	assert_center(Vector3(20, 0, 0), 0.001)
	TimeCore.set_paused(true)
	await advance(300)
	assert_center(Vector3(20, 0, 0), 0.001)
	TimeCore.set_paused(false)
	CameraCore.stop_move()
	assert_true(CameraCore.snap_to(Vector3.ZERO))
	run_move(Vector3(100, 0, 0), 1000, TweenCore.Easing.QUAD_IN)
	await advance(500)
	assert_center(Vector3(25, 0, 0), 0.01)


func test_real_time_move_progresses_during_the_pause() -> void:
	assert_true(start())
	assert_true(CameraCore.attach_camera(camera_2d()))
	TimeCore.set_paused(true)
	run_move(Vector3(100, 0, 0), 1000, LINEAR, TweenCore.TimeBasis.REAL_TIME)
	await advance(300)
	assert_center(Vector3(30, 0, 0), 0.001)
	TimeCore.set_paused(false)
	await advance(700)
	assert_results([COMPLETED])
	assert_center(Vector3(100, 0, 0))


func test_stop_move_during_the_preset_load_cancels_and_the_load_end_does_not_move() -> void:
	assert_true(start())
	assert_true(CameraCore.attach_camera(camera_2d()))
	run_preset(Vector3(300, 0, 0))
	assert_results([])
	CameraCore.stop_move()
	assert_results([CANCELLED])
	await preset_loaded()
	await advance(MOVE_MS * 2)
	assert_center(Vector3.ZERO)
	assert_results([CANCELLED])


func test_snap_to_during_the_preset_load_cancels_and_the_load_end_does_not_move() -> void:
	assert_true(start())
	assert_true(CameraCore.attach_camera(camera_2d()))
	run_preset(Vector3(300, 0, 0))
	assert_true(CameraCore.snap_to(Vector3(-20, 10, 0)))
	assert_results([CANCELLED])
	await preset_loaded()
	await advance(MOVE_MS * 2)
	assert_center(Vector3(-20, 10, 0))
	assert_results([CANCELLED])


func test_move_to_rejects_a_bad_duration_easing_time_basis_or_position() -> void:
	assert_true(start())
	assert_true(CameraCore.attach_camera(camera_2d()))
	assert_eq(await CameraCore.move_to(Vector3.ONE, -1, LINEAR, GAME), FAILED)
	assert_eq(await CameraCore.move_to(Vector3.ONE, MAX_DURATION_MS + 1, LINEAR, GAME), FAILED)
	assert_eq(await CameraCore.move_to(Vector3.ONE, 10, 99 as TweenCore.Easing, GAME), FAILED)
	assert_eq(await CameraCore.move_to(Vector3.ONE, 10, LINEAR, 7 as TweenCore.TimeBasis), FAILED)
	assert_eq(await CameraCore.move_to(Vector3(INF, 0, 0), 10, LINEAR, GAME), FAILED)
	assert_false(CameraCore.snap_to(Vector3(0, NAN, 0)))
	assert_eq(errors(), 6)
	assert_center(Vector3.ZERO)
