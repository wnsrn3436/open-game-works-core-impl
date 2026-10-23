extends UnitTestCase
## Game area, scale, visible game area, orientation and `window_to_game` from the base resolution, the max
## resolution and the window size.

const _SUPPORT := preload("res://core/resolution_core/tests/support/resolution_test_support.gd")

const _CROP: ResolutionCore.FillMode = ResolutionCore.FillMode.CROP
const _LETTERBOX: ResolutionCore.FillMode = ResolutionCore.FillMode.LETTERBOX
const _MODES: Array[ResolutionCore.FillMode] = [_CROP, _LETTERBOX]


func after_each() -> void:
	super()
	_SUPPORT.stop()


func test_window_of_the_base_resolution_is_the_base_game_area_in_both_fill_modes() -> void:
	for mode: ResolutionCore.FillMode in _MODES:
		assert_true(_SUPPORT.start_screen(Vector2i(1920, 1080), mode))
		assert_eq(ResolutionCore.get_game_area(), Rect2(0, 0, 1920, 1080))
		assert_eq(ResolutionCore.get_scale(), 1.0)
		assert_eq(ResolutionCore.get_visible_game_area(), ResolutionCore.get_game_area())
		assert_eq(ResolutionCore.get_orientation(), ResolutionCore.ScreenOrientation.LANDSCAPE)
		assert_eq(ResolutionCore.get_fill_mode(), mode)
		assert_eq(ResolutionCore.get_base_resolution(), Vector2i(1920, 1080))
		assert_eq(ResolutionCore.get_window_size(), Vector2i(1920, 1080))
		_SUPPORT.stop()


func test_window_twice_the_base_resolution_has_scale_2_and_window_to_game_halves() -> void:
	assert_true(_SUPPORT.start_screen(Vector2i(3840, 2160), _LETTERBOX))
	assert_eq(ResolutionCore.get_game_area().size, Vector2(1920, 1080))
	assert_eq(ResolutionCore.get_scale(), 2.0)
	assert_eq(ResolutionCore.window_to_game(Vector2(100, 50)), Vector2(50, 25))
	assert_eq(ResolutionCore.game_to_window(Vector2(50, 25)), Vector2(100, 50))


func test_wider_window_within_the_max_resolution_widens_the_game_area_in_both_fill_modes() -> void:
	for mode: ResolutionCore.FillMode in _MODES:
		assert_true(_SUPPORT.start_screen(Vector2i(2340, 1080), mode))
		assert_eq(ResolutionCore.get_game_area().size, Vector2(2340, 1080))
		assert_eq(ResolutionCore.get_scale(), 1.0)
		assert_true(_SUPPORT.fill_rects().is_empty())
		_SUPPORT.stop()


func test_letterbox_window_wider_than_the_max_resolution_has_side_fill_bands() -> void:
	assert_true(_SUPPORT.start_screen(Vector2i(2560, 1080), _LETTERBOX))
	assert_eq(ResolutionCore.get_game_area(), Rect2(80, 0, 2400, 1080))
	assert_eq(ResolutionCore.get_scale(), 1.0)
	assert_eq(ResolutionCore.get_visible_game_area(), Rect2(80, 0, 2400, 1080))
	var rects: Array[Rect2] = _SUPPORT.fill_rects()
	assert_eq(rects.size(), 2)
	assert_has(rects, Rect2(0, 0, 80, 1080))
	assert_has(rects, Rect2(2480, 0, 80, 1080))


func test_crop_window_wider_than_the_max_resolution_crops_with_a_floored_window_area() -> void:
	assert_true(_SUPPORT.start_screen(Vector2i(2560, 1080), _CROP))
	assert_eq(ResolutionCore.get_game_area().size, Vector2(2400, 1080))
	assert_eq(ResolutionCore.get_scale(), 2560.0 / 2400.0)
	# Godot floors the window area: 1080 × 2400 ÷ 2560 = 1012.5 becomes 1012.
	assert_eq(ResolutionCore.get_visible_game_area(), Rect2(0, 0, 2400, 1012))
	assert_true(_SUPPORT.fill_rects().is_empty())
	var root: Window = get_tree().root
	assert_eq(root.content_scale_size, Vector2i(2400, 1012))
	assert_eq(root.content_scale_mode, Window.CONTENT_SCALE_MODE_CANVAS_ITEMS)
	assert_eq(root.content_scale_aspect, Window.CONTENT_SCALE_ASPECT_IGNORE)


func test_letterbox_window_taller_than_the_max_resolution_has_fill_bands_above_and_below() -> void:
	assert_true(_SUPPORT.start_screen(Vector2i(1920, 1600), _LETTERBOX))
	assert_eq(ResolutionCore.get_game_area(), Rect2(0, 80, 1920, 1440))
	var rects: Array[Rect2] = _SUPPORT.fill_rects()
	assert_eq(rects.size(), 2)
	assert_has(rects, Rect2(0, 0, 1920, 80))
	assert_has(rects, Rect2(0, 1520, 1920, 80))


func test_portrait_base_resolution_is_portrait_and_widens_along_the_height() -> void:
	_SUPPORT.set_common_settings()
	_SUPPORT.set_size_setting("maxResolution", Vector2i(1440, 2400))
	assert_true(_SUPPORT.start())
	ResolutionCoreDev.set_test_screen(Vector2i(1080, 1920), Vector2i(1080, 2520), _LETTERBOX, true)
	assert_eq(ResolutionCore.get_orientation(), ResolutionCore.ScreenOrientation.PORTRAIT)
	assert_eq(ResolutionCore.get_game_area(), Rect2(0, 60, 1080, 2400))


func test_max_resolution_below_the_base_resolution_uses_the_base_on_that_axis_with_an_error_each_time() -> void:
	_SUPPORT.set_common_settings()
	_SUPPORT.set_size_setting("maxResolution", Vector2i(1800, 1440))
	assert_true(_SUPPORT.start())
	assert_eq(_SUPPORT.errors(), 0)
	ResolutionCoreDev.set_test_screen(_SUPPORT.BASE, Vector2i(2560, 1080), _LETTERBOX, true)
	assert_eq(_SUPPORT.errors(), 1)
	assert_eq(ResolutionCore.get_game_area().size, Vector2(1920, 1080))
	ResolutionCoreDev.set_test_screen(_SUPPORT.BASE, Vector2i(2560, 1080), _LETTERBOX, true)
	assert_eq(_SUPPORT.errors(), 1)
	assert_eq(ResolutionCore.get_game_area().size, Vector2(1920, 1080))


func test_max_resolution_below_the_settings_base_resolution_logs_an_error_at_init() -> void:
	_SUPPORT.set_common_settings()
	_SUPPORT.set_size_setting("maxResolution", Vector2i(1800, 1440))
	_SUPPORT.set_size_setting("baseResolution", Vector2i(1920, 1080))
	assert_true(_SUPPORT.start())
	assert_eq(_SUPPORT.errors(), 1)


func test_test_base_resolution_above_the_max_resolution_logs_an_error_and_uses_the_base() -> void:
	assert_true(_SUPPORT.start_screen(Vector2i(1920, 1080), _LETTERBOX))
	ResolutionCoreDev.set_test_screen(Vector2i(1080, 1920), Vector2i(1080, 2520), _LETTERBOX, true)
	assert_eq(_SUPPORT.errors(), 1)
	assert_eq(ResolutionCore.get_game_area(), Rect2(0, 300, 1080, 1920))


func test_zero_window_size_changes_no_result() -> void:
	assert_true(_SUPPORT.start_screen(Vector2i(2560, 1080), _LETTERBOX))
	var game_area: Rect2 = ResolutionCore.get_game_area()
	var visible: Rect2 = ResolutionCore.get_visible_game_area()
	var scale: float = ResolutionCore.get_scale()
	var events: EventCounter = EventCounter.new()
	add_child_autofree(events)
	assert_true(EventCore.subscribe(GameAreaChangedEvent, events.on_game_area_changed))
	ResolutionCoreDev.set_test_screen(Vector2i(1080, 1920), Vector2i(0, 1080), _CROP, false)
	assert_eq(ResolutionCore.get_window_size(), Vector2i(2560, 1080))
	assert_eq(ResolutionCore.get_game_area(), game_area)
	assert_eq(ResolutionCore.get_visible_game_area(), visible)
	assert_eq(ResolutionCore.get_scale(), scale)
	assert_eq(ResolutionCore.get_fill_mode(), _LETTERBOX)
	assert_eq(ResolutionCore.get_orientation(), ResolutionCore.ScreenOrientation.LANDSCAPE)
	assert_eq(ResolutionCore.get_base_resolution(), _SUPPORT.BASE)
	assert_true(ResolutionCore.is_screen_mode_supported())
	assert_eq(events.count, 0)


func test_fill_mode_and_screen_mode_support_follow_the_platform_without_set_test_screen() -> void:
	var platform: String = CoreBuildInfo.platform
	var cases: Dictionary[String, bool] = {
		"android": false, "ios": false, "web": false, "windows": true, "macos": true, "linux": true,
	}
	_SUPPORT.set_common_settings()
	for platform_name: String in cases:
		CoreBuildInfo.platform = platform_name
		assert_true(_SUPPORT.start())
		var fill_mode: ResolutionCore.FillMode = _CROP if platform_name == "ios" else _LETTERBOX
		assert_eq(ResolutionCore.get_fill_mode(), fill_mode, platform_name)
		assert_eq(ResolutionCore.is_screen_mode_supported(), cases[platform_name], platform_name)
		_SUPPORT.stop()
	CoreBuildInfo.platform = platform


func test_invalid_set_test_screen_logs_an_error_and_changes_nothing() -> void:
	assert_true(_SUPPORT.start_screen(Vector2i(2560, 1080), _LETTERBOX))
	var game_area: Rect2 = ResolutionCore.get_game_area()
	ResolutionCoreDev.set_test_screen(Vector2i(1080, 1080), Vector2i(1920, 1080), _LETTERBOX, true)
	ResolutionCoreDev.set_test_screen(Vector2i(0, 1080), Vector2i(1920, 1080), _LETTERBOX, true)
	ResolutionCoreDev.set_test_screen(_SUPPORT.BASE, Vector2i(-1, 1080), _LETTERBOX, true)
	assert_eq(_SUPPORT.errors(), 3)
	assert_eq(ResolutionCore.get_window_size(), Vector2i(2560, 1080))
	assert_eq(ResolutionCore.get_game_area(), game_area)


class EventCounter:
	extends Node
	var count: int = 0

	func on_game_area_changed(_event: GameAreaChangedEvent) -> void:
		count += 1
