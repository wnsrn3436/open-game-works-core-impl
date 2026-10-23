extends "res://core/safe_area_core/tests/support/safe_area_case.gd"
## Keyboard area from the virtual keyboard and `KeyboardAreaChangedEvent`.


func test_virtual_keyboard_gives_the_bottom_band_in_game_coordinates() -> void:
	init_modules()
	set_screen_without_fill(LANDSCAPE)
	var recorder: EventRecorder = new_recorder()
	SafeAreaCoreDev.set_virtual_keyboard(600)
	var top_left: Vector2 = ResolutionCore.window_to_game(Vector2(0, 2160 - 600))
	var bottom_right: Vector2 = ResolutionCore.window_to_game(Vector2(3840, 2160))
	var expected: Rect2 = Rect2(top_left, bottom_right - top_left)
	assert_rect(expected, Rect2(0, 780, 1920, 300))
	assert_rect(SafeAreaCore.get_keyboard_area(), expected)
	assert_eq(recorder.keyboard_count(), 1)
	assert_rect(recorder.payload_areas[0], SafeAreaCore.get_keyboard_area())
	assert_rect(recorder.read_areas[0], SafeAreaCore.get_keyboard_area())
	# the same height again
	SafeAreaCoreDev.set_virtual_keyboard(600)
	assert_eq(recorder.keyboard_count(), 1)


func test_keyboard_within_the_bottom_fill_band_is_empty() -> void:
	init_modules()
	# the game area is 2400 high in a window 2520 high: fill bands of 60 at the top and the bottom
	set_screen(PORTRAIT, Vector2i(1080, 2520))
	assert_rect(ResolutionCore.get_visible_game_area(), Rect2(0, 60, 1080, 2400))
	SafeAreaCoreDev.set_virtual_keyboard(60)
	assert_eq(SafeAreaCore.get_keyboard_area(), Rect2())
	SafeAreaCoreDev.set_virtual_keyboard(100)
	assert_rect(SafeAreaCore.get_keyboard_area(), Rect2(0, 2420, 1080, 40))


func test_clear_virtual_keyboard_outside_android_and_ios_empties_the_area() -> void:
	init_modules("windows")
	set_screen_without_fill(LANDSCAPE)
	SafeAreaCoreDev.set_virtual_keyboard(400)
	var recorder: EventRecorder = new_recorder()
	SafeAreaCoreDev.clear_virtual_keyboard()
	assert_eq(SafeAreaCore.get_keyboard_area(), Rect2())
	assert_eq(recorder.keyboard_count(), 1)
	assert_eq(recorder.payload_areas[0], Rect2())


func test_negative_virtual_keyboard_logs_and_keeps_the_area() -> void:
	init_modules()
	set_screen_without_fill(LANDSCAPE)
	SafeAreaCoreDev.set_virtual_keyboard(400)
	var area: Rect2 = SafeAreaCore.get_keyboard_area()
	var recorder: EventRecorder = new_recorder()
	SafeAreaCoreDev.set_virtual_keyboard(-1)
	assert_eq(UnitTestCore.check_logs("error", TAG), 1)
	assert_rect(SafeAreaCore.get_keyboard_area(), area)
	assert_eq(recorder.keyboard_count(), 0)


func test_test_screen_recalculates_the_keyboard_after_the_safe_area() -> void:
	init_modules()
	set_screen_without_fill(LANDSCAPE)
	SafeAreaCoreDev.set_virtual_notch(300, 0, 0, 0)
	SafeAreaCoreDev.set_virtual_keyboard(400)
	var recorder: EventRecorder = new_recorder()
	set_screen(LANDSCAPE, Vector2i(5120, 2160))
	assert_eq(recorder.order, PackedStringArray(["safe", "/safe", "keyboard", "/keyboard"]))
	# the bottom 400 window pixels at scale 2, cut to the new visible game area
	assert_rect(SafeAreaCore.get_keyboard_area(), Rect2(80, 880, 2400, 200))
	assert_rect(recorder.payload_areas[0], SafeAreaCore.get_keyboard_area())


func test_release_clears_the_virtual_keyboard() -> void:
	init_modules()
	set_screen_without_fill(LANDSCAPE)
	SafeAreaCoreDev.set_virtual_keyboard(400)
	assert_ne(SafeAreaCore.get_keyboard_area(), Rect2())
	SafeAreaCore.release()
	assert_true(SafeAreaCore.init())
	assert_eq(SafeAreaCore._virtual_keyboard_height, SafeAreaCore._NO_VIRTUAL_KEYBOARD)
	assert_eq(SafeAreaCore.get_keyboard_area(), Rect2())


func test_android_and_ios_without_a_virtual_keyboard_feature_have_no_keyboard_area() -> void:
	if DisplayServer.has_feature(DisplayServer.FEATURE_VIRTUAL_KEYBOARD):
		pass_test("the display server has a virtual keyboard; this checks one without it, as in the headless pass")
		return
	init_modules("android")
	# the OS safe area is the virtual notch, so that a display safe area of the host (a browser runtime gives its canvas)
	# does not meet the test screen
	SafeAreaCoreDev.set_virtual_notch(0, 0, 0, 0)
	set_screen_without_fill(LANDSCAPE)
	var recorder: EventRecorder = new_recorder()
	assert_eq(SafeAreaCore._read_os_keyboard_height(), 0)
	SafeAreaCore._on_frame()
	assert_eq(SafeAreaCore.get_keyboard_area(), Rect2())
	assert_eq(recorder.keyboard_count(), 0)
	# the virtual keyboard still sets the height on these platforms
	SafeAreaCoreDev.set_virtual_keyboard(400)
	assert_eq(SafeAreaCore._read_os_keyboard_height(), 400)
	SafeAreaCoreDev.clear_virtual_keyboard()
	SafeAreaCore._on_frame()
	assert_eq(SafeAreaCore.get_keyboard_area(), Rect2())
	assert_eq(recorder.keyboard_count(), 2)


func test_android_frame_check_recalculates_when_the_os_keyboard_height_changes() -> void:
	init_modules("android")
	# the OS safe area is the virtual notch, so that a display safe area of the host does not meet the test screen
	SafeAreaCoreDev.set_virtual_notch(0, 0, 0, 0)
	set_screen_without_fill(LANDSCAPE)
	var recorder: EventRecorder = new_recorder()
	# the OS keyboard height changes without a DEV operation
	SafeAreaCore._virtual_keyboard_height = 400
	SafeAreaCore._on_frame()
	assert_eq(recorder.keyboard_count(), 1)
	assert_rect(SafeAreaCore.get_keyboard_area(), Rect2(0, 880, 1920, 200))
	assert_rect(recorder.payload_areas[0], SafeAreaCore.get_keyboard_area())
	assert_eq(recorder.safe_count(), 0)
	# the same height in the next frame
	SafeAreaCore._on_frame()
	assert_eq(recorder.keyboard_count(), 1)
	SafeAreaCore._virtual_keyboard_height = 0
	SafeAreaCore._on_frame()
	assert_eq(recorder.keyboard_count(), 2)
	assert_eq(recorder.payload_areas[1], Rect2())
