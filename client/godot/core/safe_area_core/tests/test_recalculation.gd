extends "res://core/safe_area_core/tests/support/safe_area_case.gd"
## Recalculation: `SafeAreaChangedEvent`, its payload and the placement the subscriber sees, recalculation in a
## publish, and `set_test_screen` with a virtual notch.


func test_changing_notch_publishes_once_with_the_new_placement() -> void:
	init_modules()
	set_screen_without_fill(LANDSCAPE)
	var root: SafeAreaRoot = new_root(new_layer())
	var recorder: EventRecorder = new_recorder()
	recorder.watched_root = root
	SafeAreaCoreDev.set_virtual_notch(120, 40, 0, 60)
	assert_eq(recorder.safe_count(), 1)
	assert_vector4(recorder.payload_insets[0], insets())
	assert_vector4(recorder.read_insets[0], insets())
	assert_rect(recorder.root_rects[0], SafeAreaCore.get_safe_area())
	# the same notch again
	SafeAreaCoreDev.set_virtual_notch(120, 40, 0, 60)
	assert_eq(recorder.safe_count(), 1)


func test_init_does_not_publish() -> void:
	init_modules()
	SafeAreaCore.release()
	var recorder: EventRecorder = new_recorder()
	assert_true(SafeAreaCore.init())
	assert_eq(recorder.safe_count(), 0)
	assert_eq(recorder.keyboard_count(), 0)


func test_test_screen_with_a_notch_places_the_root_again_and_publishes() -> void:
	init_modules()
	set_screen_without_fill(LANDSCAPE)
	SafeAreaCoreDev.set_virtual_notch(300, 0, 0, 0)
	var root: SafeAreaRoot = new_root(new_layer())
	var recorder: EventRecorder = new_recorder()
	recorder.watched_root = root
	var before: Rect2 = SafeAreaCore.get_safe_area()
	set_screen(LANDSCAPE, Vector2i(5120, 2160))
	assert_eq(recorder.safe_count(), 1)
	assert_false(SafeAreaCore.get_safe_area().is_equal_approx(before))
	# (300 - 160) window pixels at scale 2 is 70 inside the fill band
	assert_vector4(insets(), Vector4(70, 0, 70, 0))
	assert_rect(root.get_global_rect(), SafeAreaCore.get_safe_area())
	assert_rect(recorder.root_rects[0], SafeAreaCore.get_safe_area())


func test_clear_notch_restores_the_safe_area() -> void:
	init_modules()
	set_screen(LANDSCAPE, Vector2i(2560, 1080))
	var safe_area: Rect2 = SafeAreaCore.get_safe_area()
	var before: Vector4 = insets()
	SafeAreaCoreDev.set_virtual_notch(200, 50, 0, 30)
	assert_false(SafeAreaCore.get_safe_area().is_equal_approx(safe_area))
	SafeAreaCoreDev.clear_virtual_notch()
	assert_rect(SafeAreaCore.get_safe_area(), safe_area)
	assert_vector4(insets(), before)


func test_recalculation_in_a_publish_runs_after_the_publish_returns() -> void:
	init_modules()
	set_screen_without_fill(LANDSCAPE)
	var recorder: EventRecorder = new_recorder()
	recorder.on_first_safe_area = _set_second_notch
	SafeAreaCoreDev.set_virtual_notch(120, 0, 0, 0)
	assert_eq(recorder.safe_count(), 2)
	assert_eq(recorder.order, PackedStringArray(["safe", "/safe", "safe", "/safe"]))
	assert_vector4(recorder.payload_insets[0], Vector4(60, 0, 60, 0))
	assert_vector4(recorder.read_insets[0], recorder.payload_insets[0])
	assert_vector4(recorder.payload_insets[1], Vector4(60, 50, 60, 0))
	assert_vector4(recorder.read_insets[1], recorder.payload_insets[1])
	assert_vector4(insets(), Vector4(60, 50, 60, 0))


func test_android_rotation_check_reads_the_os_safe_area_every_interval() -> void:
	init_modules("android")
	set_screen_without_fill(LANDSCAPE)
	SafeAreaCoreDev.set_virtual_notch(0, 0, 0, 0)
	var root: SafeAreaRoot = new_root(new_layer())
	var recorder: EventRecorder = new_recorder()
	recorder.watched_root = root
	# the OS safe area changes without a DEV operation, as a 180 degree rotation does
	SafeAreaCore._virtual_notch = Vector4i(0, 0, 120, 0)
	SafeAreaCore._next_rotation_check_ms = Time.get_ticks_msec() + 60000
	SafeAreaCore._on_frame()
	assert_eq(recorder.safe_count(), 0, "before the interval")
	assert_vector4(insets(), Vector4.ZERO)
	SafeAreaCore._next_rotation_check_ms = 0
	var before_ms: int = Time.get_ticks_msec()
	SafeAreaCore._on_frame()
	var after_ms: int = Time.get_ticks_msec()
	assert_eq(recorder.safe_count(), 1)
	assert_vector4(insets(), Vector4(60, 0, 60, 0))
	assert_vector4(recorder.payload_insets[0], insets())
	assert_rect(recorder.root_rects[0], SafeAreaCore.get_safe_area())
	# the next check is one interval after this one
	var interval: int = SafeAreaCore._rotation_check_interval_ms
	assert_between(SafeAreaCore._next_rotation_check_ms, before_ms + interval, after_ms + interval)
	# the OS safe area unchanged at the next check
	SafeAreaCore._next_rotation_check_ms = 0
	SafeAreaCore._on_frame()
	assert_eq(recorder.safe_count(), 1)


func test_android_frame_check_does_not_allocate() -> void:
	init_modules("android")
	set_screen_without_fill(LANDSCAPE)
	var recorder: EventRecorder = new_recorder()
	LogCore.release()
	_run_frame_checks(100)
	var objects: float = Performance.get_monitor(Performance.OBJECT_COUNT)
	var memory: float = Performance.get_monitor(Performance.MEMORY_STATIC)
	_run_frame_checks(1000)
	var objects_after: float = Performance.get_monitor(Performance.OBJECT_COUNT)
	var memory_after: float = Performance.get_monitor(Performance.MEMORY_STATIC)
	# the OS values stay the same, so no frame recalculates
	assert_eq(recorder.safe_count(), 0)
	assert_eq(recorder.keyboard_count(), 0)
	assert_true(objects_after <= objects, "objects %d -> %d" % [objects, objects_after])
	assert_true(memory_after <= memory, "static memory %d -> %d" % [memory, memory_after])


# Frame checks that read both the OS keyboard height and the OS safe area.
func _run_frame_checks(count: int) -> void:
	for i: int in count:
		SafeAreaCore._next_rotation_check_ms = 0
		SafeAreaCore._on_frame()


func _set_second_notch() -> void:
	SafeAreaCoreDev.set_virtual_notch(120, 100, 0, 0)
	# the recalculation waits: the insets are still those of this publish
	assert_vector4(insets(), Vector4(60, 0, 60, 0))
