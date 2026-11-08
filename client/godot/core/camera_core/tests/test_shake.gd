extends "res://core/camera_core/tests/support/camera_test_case.gd"
## Shake: trauma, decay, the offset and rotation limits, the noise, the shake scale, the noise seed and the shake skip.


func test_two_half_shakes_publish_two_events_reach_trauma_one_and_decay_to_zero() -> void:
	assert_true(start())
	var camera: Camera2D = camera_2d()
	assert_true(CameraCore.attach_camera(camera))
	CameraCore.shake(0.5)
	CameraCore.shake(0.5)
	assert_eq(shake_events, 2)
	assert_eq(CameraCore._trauma, 1.0)
	CameraCore.shake(0.5)
	assert_eq(CameraCore._trauma, 1.0, "trauma is cut at 1")
	assert_eq(shake_events, 3)
	var decay_ms: int = roundi(1000.0 / SHAKE_DECAY_PER_SECOND)
	await advance(decay_ms - 1)
	assert_gt(CameraCore._trauma, 0.0)
	await advance(1)
	assert_eq(CameraCore._trauma, 0.0)
	assert_eq(shake_offset(), Vector3.ZERO, "no offset at trauma 0")
	assert_eq(camera.rotation, 0.0, "no rotation at trauma 0")


func test_offset_on_every_axis_stays_within_the_max_offset_times_trauma_squared() -> void:
	assert_true(start())
	assert_true(CameraCore.attach_camera(camera_2d()))
	CameraCoreDev.set_shake_seed(SEED)
	CameraCore.shake(1.0)
	var largest: float = 0.0
	for frame: int in 30:
		await advance(16)
		var offset: Vector3 = shake_offset()
		var limit: float = SHAKE_MAX_OFFSET * CameraCore._trauma * CameraCore._trauma + 0.00001
		assert_true(absf(offset.x) <= limit and absf(offset.y) <= limit, "frame %d offset %s" % [frame, offset])
		largest = maxf(largest, maxf(absf(offset.x), absf(offset.y)))
	assert_gt(largest, 0.0, "the camera shook")
	assert_true(CameraCore.attach_camera(camera_3d()))
	CameraCoreDev.set_shake_seed(SEED)
	CameraCore.shake(0.8)
	for frame: int in 30:
		await advance(16)
		var offset_3d: Vector3 = shake_offset()
		var limit_3d: float = SHAKE_MAX_OFFSET * CameraCore._trauma * CameraCore._trauma + 0.00001
		assert_true(
			absf(offset_3d.x) <= limit_3d and absf(offset_3d.y) <= limit_3d and absf(offset_3d.z) <= limit_3d,
			"3D frame %d offset %s" % [frame, offset_3d]
		)


func test_2d_rotation_on_every_frame_stays_within_the_max_rotation_times_trauma_squared() -> void:
	assert_true(start())
	var camera: Camera2D = camera_2d()
	assert_true(CameraCore.attach_camera(camera))
	CameraCoreDev.set_shake_seed(SEED)
	CameraCore.shake(1.0)
	var largest: float = 0.0
	for frame: int in 30:
		await advance(16)
		var limit: float = deg_to_rad(SHAKE_MAX_ROTATION_DEG) * CameraCore._trauma * CameraCore._trauma + 0.000001
		assert_true(absf(camera.rotation) <= limit, "frame %d rotation %f" % [frame, camera.rotation])
		largest = maxf(largest, absf(camera.rotation))
	assert_gt(largest, 0.0, "the camera rotated")


func test_3d_camera_shake_moves_the_camera_without_rotating_it() -> void:
	assert_true(start())
	var camera: Camera3D = camera_3d()
	assert_true(CameraCore.attach_camera(camera))
	var basis: Basis = camera.global_transform.basis
	CameraCoreDev.set_shake_seed(SEED)
	CameraCore.shake(1.0)
	var moved: bool = false
	for frame: int in 20:
		await advance(16)
		assert_eq(camera.global_transform.basis, basis, "frame %d basis" % frame)
		moved = moved or shake_offset() != Vector3.ZERO
	assert_true(moved, "the camera shook")


func test_noise_is_drawn_at_the_shake_frequency_and_linear_between_the_drawn_values() -> void:
	assert_true(start())
	var camera: Camera2D = camera_2d()
	assert_true(CameraCore.attach_camera(camera))
	CameraCoreDev.set_shake_seed(SEED)
	CameraCore.shake(1.0)
	var random: UtilRandom = UtilCore.create_random(SEED)
	var drawn: Array[Vector3] = []
	for index: int in 6:
		drawn.append(_draw_noise(random))
	# 10 ms frames are shorter than the 50 ms noise period of 20 Hz.
	var frame_ms: int = 10
	for frame: int in 20:
		await advance(frame_ms)
		var position: float = float((frame + 1) * frame_ms) * SHAKE_FREQUENCY_HZ / 1000.0
		var step: int = floori(position)
		var noise: Vector3 = drawn[step].lerp(drawn[step + 1], position - float(step))
		var strength: float = CameraCore._trauma * CameraCore._trauma
		var offset: Vector3 = shake_offset()
		assert_almost_eq(offset.x, SHAKE_MAX_OFFSET * strength * noise.x, 0.0001, "frame %d x" % frame)
		assert_almost_eq(offset.y, SHAKE_MAX_OFFSET * strength * noise.y, 0.0001, "frame %d y" % frame)
		assert_almost_eq(
			camera.rotation, deg_to_rad(SHAKE_MAX_ROTATION_DEG * strength * noise.z), 0.000001,
			"frame %d rotation" % frame
		)


func test_shake_decays_and_moves_on_real_time_during_the_game_time_pause() -> void:
	assert_true(start())
	assert_true(CameraCore.attach_camera(camera_2d()))
	CameraCoreDev.set_shake_seed(SEED)
	TimeCore.set_paused(true)
	CameraCore.shake(1.0)
	await advance(16)
	var first: Vector3 = shake_offset()
	assert_ne(first, Vector3.ZERO, "the camera shakes during the pause")
	await advance(234)
	TimeCore.set_paused(false)
	assert_almost_eq(CameraCore._trauma, 1.0 - SHAKE_DECAY_PER_SECOND * 0.25, 0.0001, "trauma after 250 ms")
	assert_ne(shake_offset(), first, "the offset changes during the pause")


func test_shake_scale_halves_the_offset_and_zero_removes_it_while_the_event_still_comes() -> void:
	assert_true(start())
	var full: PackedVector3Array = await shake_offsets(10)
	CameraCore.set_shake_scale(500)
	var half: PackedVector3Array = await shake_offsets(10)
	for index: int in full.size():
		assert_almost_eq(half[index].x, full[index].x * 0.5, 0.00001, "frame %d x" % index)
		assert_almost_eq(half[index].y, full[index].y * 0.5, 0.00001, "frame %d y" % index)
	CameraCore.set_shake_scale(0)
	var events_before: int = shake_events
	var none: PackedVector3Array = await shake_offsets(10)
	assert_eq(shake_events, events_before + 1)
	for index: int in none.size():
		assert_eq(none[index], Vector3.ZERO, "frame %d" % index)
	CameraCore.set_shake_scale(1001)
	CameraCore.set_shake_scale(-1)
	assert_eq(errors(), 2)
	assert_eq(CameraCore._shake_scale, 0)


func test_same_seed_and_same_shake_calls_give_the_same_offset_every_frame() -> void:
	assert_true(start())
	var first: PackedVector3Array = await shake_offsets(20, 0.7)
	var second: PackedVector3Array = await shake_offsets(20, 0.7)
	assert_eq(first, second)


func test_init_seeds_the_noise_with_the_camera_shake_random_seed_of_time_core() -> void:
	TimeCoreDev.set_random_base(42)
	assert_true(start())
	var expected: UtilRandom = UtilCore.create_random(UtilCore.make_purpose_seed("camera_shake", 42))
	assert_eq(CameraCore._noise_from, _draw_noise(expected), "first noise value of the camera_shake seed")
	assert_eq(CameraCore._noise_to, _draw_noise(expected), "second noise value of the camera_shake seed")
	assert_eq(_draw_noise(CameraCore._random), _draw_noise(expected), "the noise random goes on from that seed")
	CameraCore.release()
	assert_true(CameraCore.init())
	var second: UtilRandom = UtilCore.create_random(UtilCore.make_purpose_seed("camera_shake", 43))
	assert_eq(CameraCore._noise_from, _draw_noise(second), "the next init takes the next camera_shake random seed")
	assert_eq(CameraCore._noise_to, _draw_noise(second))
	assert_eq(errors(), 0)


func test_shake_without_set_shake_seed_follows_the_random_base_of_the_run() -> void:
	TimeCoreDev.set_random_base(7)
	assert_true(start())
	assert_true(CameraCore.attach_camera(camera_2d()))
	CameraCore.shake(1.0)
	var seeded_at_init: PackedVector3Array = PackedVector3Array()
	for frame: int in 20:
		await advance(16)
		seeded_at_init.append(shake_offset())
	CameraCore.detach_camera()
	assert_ne(seeded_at_init[0], Vector3.ZERO, "the camera shook")
	assert_true(CameraCore.attach_camera(camera_2d()))
	CameraCoreDev.set_shake_seed(UtilCore.make_purpose_seed("camera_shake", 7))
	CameraCore.shake(1.0)
	var seeded_by_dev: PackedVector3Array = PackedVector3Array()
	for frame: int in 20:
		await advance(16)
		seeded_by_dev.append(shake_offset())
	assert_eq(seeded_at_init, seeded_by_dev, "the offsets of a run with random base 7 are the same on every run")


func test_stop_shake_removes_the_offset_and_rotation_at_once() -> void:
	assert_true(start())
	var camera: Camera2D = camera_2d()
	assert_true(CameraCore.attach_camera(camera))
	CameraCoreDev.set_shake_seed(SEED)
	CameraCore.shake(1.0)
	await advance(16)
	assert_ne(shake_offset(), Vector3.ZERO)
	CameraCore.stop_shake()
	assert_eq(CameraCore._trauma, 0.0)
	assert_eq(shake_offset(), Vector3.ZERO)
	assert_eq(camera.rotation, 0.0)


func test_shake_of_zero_or_less_logs_and_does_not_change_the_trauma() -> void:
	assert_true(start())
	assert_true(CameraCore.attach_camera(camera_2d()))
	CameraCore.shake(0.0)
	CameraCore.shake(-0.5)
	CameraCore.shake(NAN)
	assert_eq(errors(), 3)
	assert_eq(CameraCore._trauma, 0.0)
	assert_eq(shake_events, 0)


func test_shake_skip_adds_no_trauma_and_no_event_while_the_trauma_there_decays() -> void:
	assert_true(start())
	assert_true(CameraCore.attach_camera(camera_2d()))
	CameraCore.set_shake_scale(500)
	CameraCore.shake(0.5)
	assert_eq(shake_events, 1)
	CameraCoreDev.set_shake_skip(true)
	CameraCore.shake(0.5)
	assert_eq(CameraCore._trauma, 0.5, "the skipped shake adds no trauma")
	assert_eq(shake_events, 1, "the skipped shake publishes no event")
	assert_eq(errors(), 0, "the skipped shake leaves no log")
	assert_eq(CameraCore._shake_scale, 500, "the shake skip leaves the shake scale")
	await advance(100)
	assert_almost_eq(CameraCore._trauma, 0.5 - SHAKE_DECAY_PER_SECOND * 0.1, 0.0001, "the shake there decays")
	CameraCore.shake(0.0)
	assert_eq(errors(), 1, "the checks still run during the shake skip")
	assert_true(CameraCore.attach_camera(camera_2d()))
	CameraCore.shake(0.5)
	assert_eq(CameraCore._trauma, 0.0, "attaching a camera leaves the shake skip on")
	assert_eq(shake_events, 1)
	CameraCoreDev.set_shake_skip(false)
	CameraCore.shake(0.5)
	assert_eq(CameraCore._trauma, 0.5)
	assert_eq(shake_events, 2)
	CameraCoreDev.set_shake_skip(true)
	CameraCore.release()
	assert_true(CameraCore.init())
	assert_true(CameraCore.attach_camera(camera_2d()))
	CameraCore.shake(0.5)
	assert_eq(CameraCore._trauma, 0.5, "release turned the shake skip off")
	assert_eq(shake_events, 3)


## The next noise value of `random` in the order the shake draws it: x, y, then rotation.
func _draw_noise(random: UtilRandom) -> Vector3:
	var x: float = UtilCore.next_float(random) * 2.0 - 1.0
	var y: float = UtilCore.next_float(random) * 2.0 - 1.0
	var z: float = UtilCore.next_float(random) * 2.0 - 1.0
	return Vector3(x, y, z)
