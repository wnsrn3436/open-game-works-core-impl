extends UnitTestCase
## Recalculation on the engine's window size notice: the root window `size_changed` that a change of the root window
## size sends. Only the native runs: in the browser runtime the page canvas sets the root window size.

const _SUPPORT := preload("res://core/resolution_core/tests/support/resolution_test_support.gd")

const _PLATFORMS: PackedStringArray = ["windows", "macos", "linux"]
const _LETTERBOX: ResolutionCore.FillMode = ResolutionCore.FillMode.LETTERBOX

var _count: int = 0
var _root_size: Vector2i = Vector2i.ZERO
var _root_min_size: Vector2i = Vector2i.ZERO


func before_each() -> void:
	super()
	_count = 0
	_root_size = get_tree().root.size
	_root_min_size = get_tree().root.min_size


func after_each() -> void:
	await super()
	if EventCore.is_initialized():
		EventCore.unsubscribe_all(self)
	_SUPPORT.stop()
	get_tree().root.min_size = _root_min_size
	get_tree().root.size = _root_size


func _on_game_area_changed(_event: GameAreaChangedEvent) -> void:
	_count += 1


## Ends the test as a skip outside the native runs. False there.
func _is_native() -> bool:
	UnitTestCore.require_platform(_PLATFORMS)
	return CoreBuildInfo.platform in _PLATFORMS


## Sets the root window size, a side of 0 included, and inits with the common settings and the common base resolution.
func _start(window: Vector2i) -> bool:
	_SUPPORT.set_common_settings()
	_SUPPORT.set_size_setting("baseResolution", _SUPPORT.BASE)
	get_tree().root.min_size = Vector2i.ZERO
	get_tree().root.size = window
	if not _SUPPORT.start():
		return false
	return EventCore.subscribe(GameAreaChangedEvent, _on_game_area_changed)


func test_window_size_change_recalculates_applies_and_publishes_once() -> void:
	if not _is_native():
		return
	assert_true(_start(Vector2i(1920, 1080)))
	assert_eq(ResolutionCore.get_game_area(), Rect2(0, 0, 1920, 1080))
	get_tree().root.size = Vector2i(2560, 1080)
	assert_eq(_count, 1)
	assert_eq(ResolutionCore.get_window_size(), Vector2i(2560, 1080))
	assert_eq(ResolutionCore.get_game_area(), Rect2(80, 0, 2400, 1080))
	assert_eq(ResolutionCore.get_scale(), 1.0)
	assert_eq(get_tree().root.content_scale_size, Vector2i(2560, 1080))
	var rects: Array[Rect2] = _SUPPORT.fill_rects()
	assert_eq(rects.size(), 2)
	assert_has(rects, Rect2(0, 0, 80, 1080))
	assert_has(rects, Rect2(2480, 0, 80, 1080))


func test_window_size_change_after_set_test_screen_changes_no_result_and_no_event() -> void:
	if not _is_native():
		return
	assert_true(_start(Vector2i(1920, 1080)))
	ResolutionCoreDev.set_test_screen(_SUPPORT.BASE, Vector2i(3840, 2160), _LETTERBOX, true)
	assert_eq(_count, 1)
	get_tree().root.size = Vector2i(2560, 1080)
	assert_eq(_count, 1)
	assert_eq(ResolutionCore.get_window_size(), Vector2i(3840, 2160))
	assert_eq(ResolutionCore.get_game_area(), Rect2(0, 0, 1920, 1080))
	assert_eq(ResolutionCore.get_scale(), 2.0)


func test_window_size_change_to_a_side_of_0_keeps_the_previous_result() -> void:
	if not _is_native():
		return
	assert_true(_start(Vector2i(2560, 1080)))
	get_tree().root.size = Vector2i(0, 1080)
	assert_eq(_count, 0)
	assert_eq(ResolutionCore.get_window_size(), Vector2i(2560, 1080))
	assert_eq(ResolutionCore.get_game_area(), Rect2(80, 0, 2400, 1080))
	assert_eq(ResolutionCore.get_scale(), 1.0)


func test_init_with_a_window_size_side_of_0_has_an_all_zero_result() -> void:
	if not _is_native():
		return
	assert_true(_start(Vector2i(0, 1080)))
	assert_eq(_count, 0)
	assert_eq(ResolutionCore.get_window_size(), Vector2i.ZERO)
	assert_eq(ResolutionCore.get_game_area(), Rect2())
	assert_eq(ResolutionCore.get_visible_game_area(), Rect2())
	assert_eq(ResolutionCore.get_scale(), 0.0)
	assert_eq(ResolutionCore.window_to_game(Vector2(100, 50)), Vector2.ZERO)
	assert_eq(ResolutionCore.game_to_window(Vector2(100, 50)), Vector2.ZERO)
	assert_eq(_SUPPORT.fill_rects().size(), 0)
	get_tree().root.size = Vector2i(1920, 1080)
	assert_eq(_count, 1)
	assert_eq(ResolutionCore.get_game_area(), Rect2(0, 0, 1920, 1080))
