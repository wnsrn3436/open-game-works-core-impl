extends VirtualPadTestCase
## Each condition of the error table: its result and its log. A failed set changes neither get nor the saved values.


func test_not_a_layout_prefab() -> void:
	for key: String in [NOT_LAYOUT, BAD_CHILD]:
		assert_false(await VirtualPadCore.open_layout(key, scope), key)
		assert_eq(errors(), 1, key)
		assert_null(VirtualPadCore._pad, "no virtual pad")
		assert_eq(safe_root().get_child_count(), 0)
	assert_false(await VirtualPadCore.open_layout(MISSING, scope), "the fallback resource")
	assert_eq(errors(), 1)
	assert_eq(UnitTestCore.check_logs("error", "ResourceCore"), 1, "ResourceCore logs the unknown key")
	assert_null(VirtualPadCore._pad)


func test_layout_prefab_breaking_a_value_condition() -> void:
	for key: String in BAD_VALUE_LAYOUTS:
		assert_false(await VirtualPadCore.open_layout(key, scope), key)
		assert_true(ResourceCore.is_loaded(key, ResourceCore.BaseKind.PACKED_SCENE), "not the fallback: " + key)
		assert_eq(UnitTestCore.check_logs("error", "ResourceCore"), 0, key)
		assert_eq(errors(), 1, key)
		assert_null(VirtualPadCore._pad, "no virtual pad: " + key)
		assert_eq(safe_root().get_child_count(), 0, key)


func test_unknown_element_name() -> void:
	await open(LAYOUT_FIXED)
	VirtualPadCore.set_offset("missing", Vector2(10.0, 10.0))
	VirtualPadCore.set_scale("missing", 2.0)
	VirtualPadCore.set_opacity("missing", 0.5)
	assert_eq(errors(), 3, "every set logs")
	assert_eq(LocalDataCore.get_array_string(DEVICE, NAMES_KEY).size(), 0, "nothing is saved")
	assert_eq(VirtualPadCore.get_offset("missing"), Vector2.ZERO)
	assert_eq(VirtualPadCore.get_scale("missing"), 1.0)
	assert_eq(VirtualPadCore.get_opacity("missing"), 1.0)
	assert_eq(errors(), 3, "every get logs")
	VirtualPadCore.close_layout()
	assert_eq(VirtualPadCore.get_scale(STICK), 1.0, "without a virtual pad no name is in it")
	assert_eq(errors(), 1)


func test_scale_not_above_zero_is_ignored() -> void:
	await open(LAYOUT_FIXED)
	VirtualPadCore.set_scale(STICK, 1.5)
	var area: Rect2 = area_of(element(STICK))
	for value: float in [0.0, -1.0, NAN, INF]:
		VirtualPadCore.set_scale(STICK, value)
		assert_eq(errors(), 1, str(value))
	assert_eq(VirtualPadCore.get_scale(STICK), 1.5, "get is unchanged")
	assert_eq(LocalDataCore.get_array_float(DEVICE, SCALE_KEY), PackedFloat64Array([1.5]), "the saved value is unchanged")
	assert_almost_eq(area_of(element(STICK)).size, area.size, Vector2(EPSILON, EPSILON))


func test_opacity_out_of_range_is_clamped() -> void:
	await open(LAYOUT_FIXED)
	VirtualPadCore.set_opacity(FIRE, 1.5)
	assert_eq(errors(), 1)
	assert_eq(VirtualPadCore.get_opacity(FIRE), 1.0)
	VirtualPadCore.set_opacity(FIRE, -0.5)
	assert_eq(errors(), 1)
	assert_eq(VirtualPadCore.get_opacity(FIRE), 0.0)
	assert_almost_eq(element(FIRE).modulate.a, 0.0, EPSILON)
	assert_eq(LocalDataCore.get_array_float(DEVICE, OPACITY_KEY), PackedFloat64Array([0.0]))


func test_offset_not_finite_is_ignored() -> void:
	await open(LAYOUT_FIXED)
	VirtualPadCore.set_offset(STICK, Vector2(5.0, 6.0))
	VirtualPadCore.set_offset(STICK, Vector2(NAN, 0.0))
	assert_eq(errors(), 1)
	assert_eq(VirtualPadCore.get_offset(STICK), Vector2(5.0, 6.0))
	assert_eq(LocalDataCore.get_array_float(DEVICE, OFFSET_X_KEY), PackedFloat64Array([5.0]))


func test_dead_zone_out_of_range_is_zero() -> void:
	for value: int in [1000, -1]:
		set_settings(value, 1000)
		VirtualPadCore.release()
		assert_true(VirtualPadCore.init(), str(value))
		assert_eq(errors(), 1, str(value))
		VirtualPadCoreDev.set_test_touch_support(true)
		await open(LAYOUT_FIXED)
		touch(0, true, stick_point(Vector2(RADIUS * 0.2, 0.0)))
		assert_vector(Vector2(0.2, 0.0), "D is 0")
		touch(0, false, stick_point(Vector2(RADIUS * 0.2, 0.0)))


func test_sensitivity_not_above_zero_is_one() -> void:
	set_settings(0, 0)
	VirtualPadCore.release()
	assert_true(VirtualPadCore.init())
	assert_eq(errors(), 1)
	VirtualPadCoreDev.set_test_touch_support(true)
	await open(LAYOUT_FIXED)
	touch(0, true, stick_point(Vector2(RADIUS * 0.5, 0.0)))
	assert_vector(Vector2(0.5, 0.0), "S is 1")
