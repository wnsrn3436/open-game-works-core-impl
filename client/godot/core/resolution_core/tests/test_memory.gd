extends UnitTestCase
## The `get_*` operations, `window_to_game`, `game_to_window` and `is_screen_mode_supported` allocate no memory.

const _SUPPORT := preload("res://core/resolution_core/tests/support/resolution_test_support.gd")


func after_each() -> void:
	super()
	_SUPPORT.stop()


func _run(times: int) -> void:
	var point: Vector2 = Vector2(100, 50)
	var orientation: ResolutionCore.ScreenOrientation = ResolutionCore.ScreenOrientation.LANDSCAPE
	var size: Vector2i = Vector2i.ZERO
	var rect: Rect2 = Rect2()
	var scale: float = 0.0
	var fill_mode: ResolutionCore.FillMode = ResolutionCore.FillMode.LETTERBOX
	var screen_mode: ResolutionCore.ScreenMode = ResolutionCore.ScreenMode.WINDOWED
	var supported: bool = false
	for _i: int in times:
		orientation = ResolutionCore.get_orientation()
		size = ResolutionCore.get_base_resolution()
		size = ResolutionCore.get_window_size()
		rect = ResolutionCore.get_game_area()
		rect = ResolutionCore.get_visible_game_area()
		scale = ResolutionCore.get_scale()
		fill_mode = ResolutionCore.get_fill_mode()
		screen_mode = ResolutionCore.get_screen_mode()
		point = ResolutionCore.window_to_game(point)
		point = ResolutionCore.game_to_window(point)
		supported = ResolutionCore.is_screen_mode_supported()


func test_queries_and_conversions_allocate_no_memory() -> void:
	assert_true(_SUPPORT.start_screen(Vector2i(2560, 1080), ResolutionCore.FillMode.LETTERBOX))
	LogCore.release()
	_run(100)
	var objects: float = Performance.get_monitor(Performance.OBJECT_COUNT)
	var memory: float = Performance.get_monitor(Performance.MEMORY_STATIC)
	_run(1000)
	# Both monitors are read before an assertion, which allocates for its record.
	var objects_after: float = Performance.get_monitor(Performance.OBJECT_COUNT)
	var memory_after: float = Performance.get_monitor(Performance.MEMORY_STATIC)
	assert_lte(objects_after, objects)
	assert_lte(memory_after, memory)
