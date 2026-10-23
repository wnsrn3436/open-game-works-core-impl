extends VirtualPadTestCase
## User settings: set, get, saved keys, reopen, other layouts, broken saved values, reset, and the safe area.


func test_set_applies_at_once_and_saves_by_the_rules() -> void:
	await open(LAYOUT_FIXED)
	var stick: Control = element(STICK)
	var fire: Control = element(FIRE)
	var stick_area: Rect2 = area_of(stick)
	VirtualPadCore.set_offset(STICK, Vector2(30.0, -20.0))
	assert_almost_eq(area_of(stick).position, stick_area.position + Vector2(30.0, -20.0), Vector2(EPSILON, EPSILON),
		"the area moved at once")
	VirtualPadCore.set_scale(STICK, 1.5)
	assert_almost_eq(area_of(stick).size, stick_area.size * 1.5, Vector2(EPSILON, EPSILON), "the area scaled at once")
	assert_almost_eq(area_of(stick).get_center(), stick_area.get_center() + Vector2(30.0, -20.0),
		Vector2(EPSILON, EPSILON), "around the area center")
	VirtualPadCore.set_opacity(FIRE, 0.5)
	assert_almost_eq(fire.modulate.a, 0.5, EPSILON, "the alpha changed at once")
	assert_eq(LocalDataCore.get_array_string(DEVICE, NAMES_KEY), PackedStringArray([STICK, FIRE]))
	assert_eq(LocalDataCore.get_array_float(DEVICE, OFFSET_X_KEY), PackedFloat64Array([30.0, 0.0]))
	assert_eq(LocalDataCore.get_array_float(DEVICE, OFFSET_Y_KEY), PackedFloat64Array([-20.0, 0.0]))
	assert_eq(LocalDataCore.get_array_float(DEVICE, SCALE_KEY), PackedFloat64Array([1.5, 1.0]))
	assert_eq(LocalDataCore.get_array_float(DEVICE, OPACITY_KEY), PackedFloat64Array([1.0, 0.5]))
	assert_eq(VirtualPadCore.get_offset(STICK), Vector2(30.0, -20.0))
	assert_eq(VirtualPadCore.get_scale(STICK), 1.5)
	assert_eq(VirtualPadCore.get_opacity(FIRE), 0.5)
	var moved_area: Rect2 = area_of(stick)
	VirtualPadCore.close_layout()
	await open(LAYOUT_FIXED)
	assert_eq(VirtualPadCore.get_offset(STICK), Vector2(30.0, -20.0), "the same after reopening")
	assert_eq(VirtualPadCore.get_scale(STICK), 1.5)
	assert_eq(VirtualPadCore.get_opacity(FIRE), 0.5)
	assert_almost_eq(area_of(element(STICK)).position, moved_area.position, Vector2(EPSILON, EPSILON))
	assert_almost_eq(element(FIRE).modulate.a, 0.5, EPSILON)


func test_scaled_joystick_scales_the_radius() -> void:
	await open(LAYOUT_FIXED)
	VirtualPadCore.set_scale(STICK, 2.0)
	var base: Vector2 = element(STICK).get_global_transform_with_canvas() * BASE_DEFAULT
	touch(0, true, canvas_to_game(base + Vector2(RADIUS, 0.0)))
	assert_vector(Vector2(0.5, 0.0), "the default radius away has the magnitude 0.5")


func test_user_settings_of_a_name_apply_to_another_layout() -> void:
	await open(LAYOUT_FIXED)
	VirtualPadCore.set_offset(FIRE, Vector2(-50.0, 0.0))
	await open(LAYOUT_OTHER)
	assert_eq(VirtualPadCore.get_offset(FIRE), Vector2(-50.0, 0.0))
	assert_almost_eq(area_of(element(FIRE)).position.x, safe_root().get_global_rect().position.x + 750.0, EPSILON)
	assert_eq(VirtualPadCore.get_offset("jump"), Vector2.ZERO, "a name without settings has the default")


func test_arrays_of_different_lengths_read_as_defaults() -> void:
	LocalDataCore.set_array_string(DEVICE, NAMES_KEY, PackedStringArray([STICK, FIRE]))
	LocalDataCore.set_array_float(DEVICE, OFFSET_X_KEY, PackedFloat64Array([10.0]))
	LocalDataCore.set_array_float(DEVICE, OFFSET_Y_KEY, PackedFloat64Array([10.0, 10.0]))
	LocalDataCore.set_array_float(DEVICE, SCALE_KEY, PackedFloat64Array([2.0, 2.0]))
	LocalDataCore.set_array_float(DEVICE, OPACITY_KEY, PackedFloat64Array([0.5, 0.5]))
	await open(LAYOUT_FIXED)
	for element_name: String in [STICK, FIRE]:
		assert_eq(VirtualPadCore.get_offset(element_name), Vector2.ZERO, element_name)
		assert_eq(VirtualPadCore.get_scale(element_name), 1.0, element_name)
		assert_eq(VirtualPadCore.get_opacity(element_name), 1.0, element_name)


func test_a_repeated_name_reads_as_defaults() -> void:
	LocalDataCore.set_array_string(DEVICE, NAMES_KEY, PackedStringArray([STICK, STICK]))
	LocalDataCore.set_array_float(DEVICE, OFFSET_X_KEY, PackedFloat64Array([10.0, 20.0]))
	LocalDataCore.set_array_float(DEVICE, OFFSET_Y_KEY, PackedFloat64Array([10.0, 20.0]))
	LocalDataCore.set_array_float(DEVICE, SCALE_KEY, PackedFloat64Array([2.0, 1.5]))
	LocalDataCore.set_array_float(DEVICE, OPACITY_KEY, PackedFloat64Array([0.5, 0.4]))
	await open(LAYOUT_FIXED)
	assert_eq(VirtualPadCore.get_offset(STICK), Vector2.ZERO)
	assert_eq(VirtualPadCore.get_scale(STICK), 1.0)
	assert_eq(VirtualPadCore.get_opacity(STICK), 1.0)
	VirtualPadCore.set_offset(STICK, Vector2(5.0, 6.0))
	assert_eq(LocalDataCore.get_array_string(DEVICE, NAMES_KEY), PackedStringArray([STICK]),
		"the set writes the five arrays again with one new entry")
	assert_eq(LocalDataCore.get_array_float(DEVICE, OFFSET_X_KEY), PackedFloat64Array([5.0]))
	assert_eq(LocalDataCore.get_array_float(DEVICE, OFFSET_Y_KEY), PackedFloat64Array([6.0]))
	assert_eq(LocalDataCore.get_array_float(DEVICE, SCALE_KEY), PackedFloat64Array([1.0]))
	assert_eq(LocalDataCore.get_array_float(DEVICE, OPACITY_KEY), PackedFloat64Array([1.0]))


func test_a_value_out_of_range_reads_as_its_default() -> void:
	LocalDataCore.set_array_string(DEVICE, NAMES_KEY, PackedStringArray([STICK, FIRE]))
	LocalDataCore.set_array_float(DEVICE, OFFSET_X_KEY, PackedFloat64Array([10.0, 20.0]))
	LocalDataCore.set_array_float(DEVICE, OFFSET_Y_KEY, PackedFloat64Array([-10.0, -20.0]))
	LocalDataCore.set_array_float(DEVICE, SCALE_KEY, PackedFloat64Array([0.0, 1.2]))
	LocalDataCore.set_array_float(DEVICE, OPACITY_KEY, PackedFloat64Array([0.4, 1.5]))
	await open(LAYOUT_FIXED)
	assert_eq(VirtualPadCore.get_scale(STICK), 1.0, "scale 0 reads as the default")
	assert_eq(VirtualPadCore.get_offset(STICK), Vector2(10.0, -10.0), "the other values of the entry apply")
	assert_eq(VirtualPadCore.get_opacity(STICK), 0.4)
	assert_eq(VirtualPadCore.get_opacity(FIRE), 1.0, "opacity 1.5 reads as the default")
	assert_eq(VirtualPadCore.get_scale(FIRE), 1.2)
	assert_eq(VirtualPadCore.get_offset(FIRE), Vector2(20.0, -20.0))


func test_reset_removes_the_keys_and_puts_the_defaults() -> void:
	await open(LAYOUT_FIXED)
	var stick_area: Rect2 = area_of(element(STICK))
	VirtualPadCore.set_offset(STICK, Vector2(40.0, 40.0))
	VirtualPadCore.set_scale(STICK, 0.5)
	VirtualPadCore.set_opacity(FIRE, 0.2)
	VirtualPadCore.reset_user_settings()
	for key: String in [OFFSET_X_KEY, OFFSET_Y_KEY, SCALE_KEY, OPACITY_KEY]:
		assert_eq(LocalDataCore.get_array_float(DEVICE, key).size(), 0, key)
	assert_eq(LocalDataCore.get_array_string(DEVICE, NAMES_KEY).size(), 0)
	assert_eq(VirtualPadCore.get_offset(STICK), Vector2.ZERO)
	assert_eq(VirtualPadCore.get_scale(STICK), 1.0)
	assert_eq(VirtualPadCore.get_opacity(FIRE), 1.0)
	assert_almost_eq(area_of(element(STICK)).position, stick_area.position, Vector2(EPSILON, EPSILON))
	assert_almost_eq(element(FIRE).modulate.a, 1.0, EPSILON)


func test_areas_stay_in_the_safe_area() -> void:
	await open(LAYOUT_FIXED)
	VirtualPadCore.set_offset(STICK, Vector2(-500.0, 0.0))
	assert_true(_inside_safe_area(STICK), "an offset out of the safe area is moved in")
	assert_eq(VirtualPadCore.get_offset(STICK), Vector2(-500.0, 0.0), "get gives the offset before moving in")
	touch(0, true, center_of(FIRE))
	var latch: UnitTestLatch = UnitTestCore.latch_event(SafeAreaChangedEvent)
	SafeAreaCoreDev.set_virtual_notch(200, 100, 150, 120)
	assert_true(latch.happened, "the safe area changed")
	assert_true(_inside_safe_area(STICK), "inside the new safe area")
	assert_true(_inside_safe_area(FIRE), "inside the new safe area")
	assert_false(InputCore.is_pressed(FIRE_ACTION), "release handling on the safe area change")
	touch(0, false, center_of(FIRE))
	SafeAreaCoreDev.clear_virtual_notch()


func test_axis_longer_than_the_safe_area_is_centered() -> void:
	await open(LAYOUT_FIXED)
	VirtualPadCore.set_offset(FIRE, Vector2(77.0, -33.0))
	VirtualPadCore.set_scale(FIRE, 10.0)
	var safe: Rect2 = safe_root().get_global_rect()
	assert_almost_eq(area_of(element(FIRE)).get_center(), safe.get_center(), Vector2(EPSILON, EPSILON),
		"both axes are longer than the safe area")
	assert_eq(VirtualPadCore.get_offset(FIRE), Vector2(77.0, -33.0), "get gives the offset before moving in")


func _inside_safe_area(element_name: String) -> bool:
	var safe: Rect2 = safe_root().get_global_rect().grow(EPSILON)
	return safe.encloses(area_of(element(element_name)))
