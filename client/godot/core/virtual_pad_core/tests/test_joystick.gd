extends VirtualPadTestCase
## Virtual joystick: direction value, dead zone, sensitivity, direction action injects, joystick modes and the handle.


func test_fixed_direction_value_is_the_distance_ratio() -> void:
	await open(LAYOUT_FIXED)
	touch(0, true, stick_point(Vector2(RADIUS * 0.5, 0.0)))
	assert_vector(Vector2(0.5, 0.0), "right by half the radius")
	drag(0, stick_point(Vector2(0.0, -RADIUS * 2.0)))
	assert_vector(Vector2(0.0, -1.0), "up by twice the radius")
	touch(0, false, stick_point(Vector2(0.0, -RADIUS * 2.0)))
	assert_true(no_direction())


func test_dead_zone() -> void:
	set_settings(200, 1000)
	assert_true(restart_virtual_pad())
	await open(LAYOUT_FIXED)
	touch(0, true, stick_point(Vector2(RADIUS * 0.2, 0.0)))
	assert_vector(Vector2.ZERO, "r 0.2 is in the dead zone")
	assert_true(no_direction(), "no direction action is pressed in the dead zone")
	drag(0, stick_point(Vector2(RADIUS * 0.6, 0.0)))
	assert_vector(Vector2(0.5, 0.0), "r 0.6 has the magnitude 0.5")


func test_sensitivity() -> void:
	set_settings(0, 2000)
	assert_true(restart_virtual_pad())
	await open(LAYOUT_FIXED)
	touch(0, true, stick_point(Vector2(RADIUS * 0.3, 0.0)))
	assert_vector(Vector2(0.6, 0.0), "r 0.3 has the magnitude 0.6")
	drag(0, stick_point(Vector2(RADIUS * 0.8, 0.0)))
	assert_vector(Vector2(1.0, 0.0), "r 0.8 has the magnitude 1")


func test_direction_action_strengths() -> void:
	await open(LAYOUT_FIXED)
	var diagonal: Vector2 = Vector2(1.0, 1.0).normalized()
	touch(0, true, stick_point(diagonal * RADIUS))
	var part: float = diagonal.x
	assert_almost_eq(InputCore.get_strength(LEFT), 0.0, EPSILON)
	assert_almost_eq(InputCore.get_strength(RIGHT), part, EPSILON)
	assert_almost_eq(InputCore.get_strength(UP), 0.0, EPSILON)
	assert_almost_eq(InputCore.get_strength(DOWN), part, EPSILON)
	assert_false(InputCore.is_pressed(LEFT), "strength 0 is not pressed")
	assert_false(InputCore.is_pressed(UP), "strength 0 is not pressed")
	assert_true(InputCore.is_pressed(RIGHT))
	assert_true(InputCore.is_pressed(DOWN))


func test_move_without_a_direction_change_injects_nothing() -> void:
	await open(LAYOUT_FIXED)
	# Beyond the radius r is 1. A point given at exactly the radius can land just inside it after the conversion to
	# game coordinates (the browser run), and then the next move changes the direction value.
	touch(0, true, stick_point(Vector2(RADIUS * 1.5, 0.0)))
	assert_vector(Vector2(1.0, 0.0))
	# The test releases the inject source; a move that keeps the direction value does not inject it again.
	InputCore.inject_action(RIGHT, false, 0.0)
	drag(0, stick_point(Vector2(RADIUS * 2.0, 0.0)))
	drag(0, stick_point(Vector2(RADIUS * 2.5, 0.0)))
	assert_false(InputCore.is_pressed(RIGHT), "the same direction value is not injected")
	drag(0, stick_point(Vector2(RADIUS * 0.5, 0.0)))
	assert_almost_eq(InputCore.get_strength(RIGHT), 0.5, EPSILON, "a changed strength is injected")


func test_fixed_press_outside_the_base_keeps_the_base() -> void:
	await open(LAYOUT_FIXED)
	var stick: Control = element(STICK)
	var local: Vector2 = Vector2(380.0, BASE_DEFAULT.y)
	touch(0, true, game_point(stick, local))
	assert_almost_eq(center_in(stick, stick_base()), BASE_DEFAULT, Vector2(EPSILON, EPSILON), "the base stays")
	assert_vector(Vector2(1.0, 0.0), "magnitude 1 toward the pointer")


func test_floating_base_moves_to_the_pressed_point_only() -> void:
	await open(LAYOUT_FLOATING)
	var stick: Control = element(STICK)
	var pressed_at: Vector2 = BASE_DEFAULT + Vector2(100.0, 100.0)
	touch(0, true, game_point(stick, pressed_at))
	assert_almost_eq(center_in(stick, stick_base()), pressed_at, Vector2(EPSILON, EPSILON), "the base is at the press")
	assert_vector(Vector2.ZERO)
	drag(0, game_point(stick, pressed_at + Vector2(RADIUS * 3.0, 0.0)))
	assert_almost_eq(center_in(stick, stick_base()), pressed_at, Vector2(EPSILON, EPSILON), "the base does not move")
	assert_vector(Vector2(1.0, 0.0))
	touch(0, false, game_point(stick, pressed_at + Vector2(RADIUS * 3.0, 0.0)))
	assert_almost_eq(center_in(stick, stick_base()), BASE_DEFAULT, Vector2(EPSILON, EPSILON), "back at the default")
	assert_true(no_direction())


func test_following_base_follows_beyond_the_radius() -> void:
	await open(LAYOUT_FOLLOWING)
	var stick: Control = element(STICK)
	var pressed_at: Vector2 = BASE_DEFAULT + Vector2(-50.0, 0.0)
	touch(0, true, game_point(stick, pressed_at))
	drag(0, game_point(stick, pressed_at + Vector2(RADIUS * 3.0, 0.0)))
	assert_almost_eq(center_in(stick, stick_base()), pressed_at + Vector2(RADIUS * 2.0, 0.0),
		Vector2(EPSILON, EPSILON), "the base is twice the radius right of the press")
	assert_vector(Vector2(1.0, 0.0))


func test_handle_distance_is_capped_by_the_radius() -> void:
	await open(LAYOUT_FIXED)
	var stick: Control = element(STICK)
	assert_almost_eq(center_in(stick, stick_handle()), BASE_DEFAULT, Vector2(EPSILON, EPSILON),
		"without a pointer the handle is at the base center")
	touch(0, true, stick_point(Vector2(RADIUS * 0.5, 0.0)))
	assert_almost_eq(center_in(stick, stick_handle()), BASE_DEFAULT + Vector2(RADIUS * 0.5, 0.0),
		Vector2(EPSILON, EPSILON), "r 0.5: half the radius away")
	drag(0, stick_point(Vector2(0.0, RADIUS * 2.0)))
	assert_almost_eq(center_in(stick, stick_handle()), BASE_DEFAULT + Vector2(0.0, RADIUS),
		Vector2(EPSILON, EPSILON), "r 2: the radius away")
	touch(0, false, stick_point(Vector2(0.0, RADIUS * 2.0)))
	assert_almost_eq(center_in(stick, stick_handle()), BASE_DEFAULT, Vector2(EPSILON, EPSILON))
