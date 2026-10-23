extends "res://core/safe_area_core/tests/support/safe_area_case.gd"
## Safe area and inset calculation from the virtual notch, errors of the calculation and of `get_inset`, and the
## operations that do not allocate memory.


func test_zero_notch_gives_zero_insets_and_the_visible_game_area() -> void:
	init_modules()
	var landscape_windows: Array[Vector2i] = [Vector2i(3840, 2160), Vector2i(2560, 1080), Vector2i(1920, 1600)]
	var portrait_windows: Array[Vector2i] = [Vector2i(2160, 3840), Vector2i(1080, 2520), Vector2i(1600, 1920)]
	for window: Vector2i in landscape_windows:
		_check_zero_notch(LANDSCAPE, window)
	for window: Vector2i in portrait_windows:
		_check_zero_notch(PORTRAIT, window)


func test_left_and_top_notch_without_fill_area_landscape() -> void:
	init_modules()
	set_screen_without_fill(LANDSCAPE)
	SafeAreaCoreDev.set_virtual_notch(120, 40, 0, 0)
	var converted: Vector2 = ResolutionCore.window_to_game(Vector2(120, 40))
	assert_eq(converted, Vector2(60, 20))
	# Landscape: the right inset is the left one
	assert_vector4(insets(), Vector4(converted.x, converted.y, converted.x, 0))
	assert_rect(SafeAreaCore.get_safe_area(), Rect2(60, 20, 1920 - 120, 1080 - 20))


func test_left_and_top_notch_without_fill_area_portrait() -> void:
	init_modules()
	set_screen_without_fill(PORTRAIT)
	SafeAreaCoreDev.set_virtual_notch(30, 160, 0, 0)
	var converted: Vector2 = ResolutionCore.window_to_game(Vector2(30, 160))
	assert_eq(converted, Vector2(15, 80))
	assert_vector4(insets(), Vector4(converted.x, converted.y, 0, 0))
	assert_rect(SafeAreaCore.get_safe_area(), Rect2(15, 80, 1080 - 15, 1920 - 80))


func test_right_notch_larger_than_the_left_sets_both_sides_landscape() -> void:
	init_modules()
	set_screen_without_fill(LANDSCAPE)
	SafeAreaCoreDev.set_virtual_notch(40, 0, 200, 0)
	# the right inset (200 window pixels is 100) is the larger one; Landscape copies it to the left
	assert_vector4(insets(), Vector4(100, 0, 100, 0))
	assert_rect(SafeAreaCore.get_safe_area(), Rect2(100, 0, 1720, 1080))


func test_right_notch_larger_than_the_left_keeps_each_side_portrait() -> void:
	init_modules()
	set_screen_without_fill(PORTRAIT)
	SafeAreaCoreDev.set_virtual_notch(40, 0, 200, 0)
	assert_vector4(insets(), Vector4(20, 0, 100, 0))
	assert_rect(SafeAreaCore.get_safe_area(), Rect2(20, 0, 1080 - 120, 1920))


func test_letterbox_notch_within_the_fill_band_is_zero_landscape() -> void:
	init_modules()
	# scale 2; the game area is 2400 wide, so the fill bands are 80 wide in game coordinates and 160 in window pixels
	set_screen(LANDSCAPE, Vector2i(5120, 2160))
	assert_rect(ResolutionCore.get_visible_game_area(), Rect2(80, 0, 2400, 1080))
	SafeAreaCoreDev.set_virtual_notch(160, 0, 100, 0)
	assert_vector4(insets(), Vector4.ZERO)
	SafeAreaCoreDev.set_virtual_notch(300, 0, 0, 0)
	# (300 - 160) window pixels is 70 in game coordinates; Landscape copies it to the right
	assert_vector4(insets(), Vector4(70, 0, 70, 0))
	assert_rect(SafeAreaCore.get_safe_area(), Rect2(150, 0, 2400 - 140, 1080))


func test_letterbox_notch_within_the_fill_band_is_zero_portrait() -> void:
	init_modules()
	# scale 2; the game area is 2400 high, so the fill bands are 60 high in game coordinates and 120 in window pixels
	set_screen(PORTRAIT, Vector2i(2160, 5040))
	assert_rect(ResolutionCore.get_visible_game_area(), Rect2(0, 60, 1080, 2400))
	SafeAreaCoreDev.set_virtual_notch(0, 120, 0, 80)
	assert_vector4(insets(), Vector4.ZERO)
	SafeAreaCoreDev.set_virtual_notch(0, 200, 0, 160)
	assert_vector4(insets(), Vector4(0, 40, 0, 20))
	assert_rect(SafeAreaCore.get_safe_area(), Rect2(0, 100, 1080, 2400 - 60))


func test_notch_wider_than_the_window_logs_and_zeroes_the_insets_landscape() -> void:
	_check_wide_notch(LANDSCAPE)


func test_notch_wider_than_the_window_logs_and_zeroes_the_insets_portrait() -> void:
	_check_wide_notch(PORTRAIT)


func test_negative_notch_logs_and_keeps_the_safe_area() -> void:
	init_modules()
	set_screen_without_fill(LANDSCAPE)
	SafeAreaCoreDev.set_virtual_notch(100, 20, 0, 40)
	var safe_area: Rect2 = SafeAreaCore.get_safe_area()
	var before: Vector4 = insets()
	SafeAreaCoreDev.set_virtual_notch(10, -1, 0, 0)
	assert_eq(UnitTestCore.check_logs("error", TAG), 1)
	assert_rect(SafeAreaCore.get_safe_area(), safe_area)
	assert_vector4(insets(), before)


func test_get_inset_of_a_non_edge_logs_and_returns_zero() -> void:
	init_modules()
	set_screen_without_fill(LANDSCAPE)
	SafeAreaCoreDev.set_virtual_notch(100, 100, 100, 100)
	var not_an_edge: int = 4
	assert_eq(SafeAreaCore.get_inset(not_an_edge as SafeAreaCore.Edge), 0.0)
	var negative: int = -1
	assert_eq(SafeAreaCore.get_inset(negative as SafeAreaCore.Edge), 0.0)
	assert_eq(UnitTestCore.check_logs("error", TAG), 2)


func test_read_operations_do_not_allocate() -> void:
	init_modules()
	set_screen_without_fill(LANDSCAPE)
	SafeAreaCoreDev.set_virtual_notch(100, 20, 0, 40)
	SafeAreaCoreDev.set_virtual_keyboard(300)
	LogCore.release()
	var total: float = _read_all(100)
	var objects: float = Performance.get_monitor(Performance.OBJECT_COUNT)
	var memory: float = Performance.get_monitor(Performance.MEMORY_STATIC)
	total += _read_all(1000)
	var objects_after: float = Performance.get_monitor(Performance.OBJECT_COUNT)
	var memory_after: float = Performance.get_monitor(Performance.MEMORY_STATIC)
	assert_true(total > 0.0)
	assert_true(objects_after <= objects, "objects %d -> %d" % [objects, objects_after])
	assert_true(memory_after <= memory, "static memory %d -> %d" % [memory, memory_after])


func test_android_and_ios_without_a_display_safe_area_use_the_whole_window() -> void:
	if OS.get_name() != "Web" and DisplayServer.get_display_safe_area().size != Vector2i.ZERO:
		pass_test("the display server has a display safe area; this checks one without it, as in the headless pass and the browser runtime")
		return
	init_modules("android")
	var recorder: EventRecorder = new_recorder()
	for platform: String in ["android", "ios"]:
		CoreBuildInfo.platform = platform
		for base: Vector2i in [LANDSCAPE, PORTRAIT]:
			set_screen(base, base * 2)
			assert_vector4(insets(), Vector4.ZERO, "%s %s" % [platform, base])
			assert_rect(SafeAreaCore.get_safe_area(), ResolutionCore.get_visible_game_area(), "%s %s" % [platform, base])
		# the rotation check reads the OS safe area again and finds it unchanged
		var count: int = recorder.safe_count()
		SafeAreaCore._next_rotation_check_ms = 0
		SafeAreaCore._on_frame()
		assert_eq(recorder.safe_count(), count, platform)
		assert_vector4(insets(), Vector4.ZERO, platform)


## The premise of the browser runtime rule (`_read_os_area` does not read the display safe area there): the web display
## server answers `get_display_safe_area` with the canvas, which is the whole window at the window origin, so it holds
## no notch to keep. A test screen whose window is not the canvas would meet that canvas rectangle instead of a notch.
func test_browser_display_safe_area_is_the_whole_canvas() -> void:
	UnitTestCore.require_platform(PackedStringArray(["web"]))
	if OS.get_name() != "Web":
		return
	assert_eq(DisplayServer.get_display_safe_area(), Rect2i(Vector2i.ZERO, DisplayServer.window_get_size()))
	assert_eq(DisplayServer.window_get_position(), Vector2i.ZERO)
	init_modules("android")
	set_screen(LANDSCAPE, Vector2i(3840, 2160))
	assert_vector4(insets(), Vector4.ZERO, "the test window's OS safe area is the whole test window")


func _read_all(count: int) -> float:
	var total: float = 0.0
	for i: int in count:
		total += SafeAreaCore.get_safe_area().size.x
		total += SafeAreaCore.get_inset(SafeAreaCore.Edge.LEFT)
		total += SafeAreaCore.get_inset(SafeAreaCore.Edge.BOTTOM)
		total += SafeAreaCore.get_keyboard_area().size.y
	return total


func _check_zero_notch(base: Vector2i, window: Vector2i) -> void:
	set_screen(base, window)
	SafeAreaCoreDev.set_virtual_notch(0, 0, 0, 0)
	assert_vector4(insets(), Vector4.ZERO, "%s %s" % [base, window])
	assert_rect(SafeAreaCore.get_safe_area(), ResolutionCore.get_visible_game_area(), "%s %s" % [base, window])


func _check_wide_notch(base: Vector2i) -> void:
	init_modules()
	set_screen_without_fill(base)
	SafeAreaCoreDev.set_virtual_notch(10, 10, 10, 10)
	# left + right is the window width
	SafeAreaCoreDev.set_virtual_notch(base.x, 0, base.x, 0)
	assert_eq(UnitTestCore.check_logs("error", TAG), 1)
	assert_vector4(insets(), Vector4.ZERO)
	assert_rect(SafeAreaCore.get_safe_area(), ResolutionCore.get_visible_game_area())
	# top is the window height
	SafeAreaCoreDev.set_virtual_notch(0, base.y * 2, 0, 0)
	assert_eq(UnitTestCore.check_logs("error", TAG), 1)
	assert_vector4(insets(), Vector4.ZERO)
