extends UnitTestCase
## `GameAreaChangedEvent`: published by a recalculation that changes the result, not by one that does not.

const _SUPPORT := preload("res://core/resolution_core/tests/support/resolution_test_support.gd")

var _count: int = 0


func before_each() -> void:
	super()
	_count = 0


func after_each() -> void:
	super()
	_SUPPORT.stop()


func _on_game_area_changed(_event: GameAreaChangedEvent) -> void:
	_count += 1


func test_set_test_screen_that_changes_the_game_area_publishes_once_and_the_same_input_does_not() -> void:
	assert_true(_SUPPORT.start_screen(Vector2i(1920, 1080), ResolutionCore.FillMode.LETTERBOX))
	assert_true(EventCore.subscribe(GameAreaChangedEvent, _on_game_area_changed))
	ResolutionCoreDev.set_test_screen(_SUPPORT.BASE, Vector2i(2560, 1080), ResolutionCore.FillMode.LETTERBOX, true)
	assert_eq(_count, 1)
	ResolutionCoreDev.set_test_screen(_SUPPORT.BASE, Vector2i(2560, 1080), ResolutionCore.FillMode.LETTERBOX, true)
	assert_eq(_count, 1)
	EventCore.unsubscribe_all(self)


func test_set_test_screen_that_changes_only_the_fill_mode_applies_it_and_publishes_no_event() -> void:
	assert_true(_SUPPORT.start_screen(Vector2i(1920, 1080), ResolutionCore.FillMode.CROP))
	assert_true(EventCore.subscribe(GameAreaChangedEvent, _on_game_area_changed))
	ResolutionCoreDev.set_test_screen(_SUPPORT.BASE, Vector2i(1920, 1080), ResolutionCore.FillMode.LETTERBOX, true)
	assert_eq(ResolutionCore.get_fill_mode(), ResolutionCore.FillMode.LETTERBOX)
	assert_eq(ResolutionCore.get_game_area(), Rect2(0, 0, 1920, 1080))
	assert_eq(ResolutionCore.get_scale(), 1.0)
	assert_eq(_count, 0)
	EventCore.unsubscribe_all(self)


func test_init_publishes_no_event() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start_dependencies())
	assert_true(EventCore.subscribe(GameAreaChangedEvent, _on_game_area_changed))
	assert_true(ResolutionCore.init())
	assert_eq(_count, 0)
	EventCore.unsubscribe_all(self)
