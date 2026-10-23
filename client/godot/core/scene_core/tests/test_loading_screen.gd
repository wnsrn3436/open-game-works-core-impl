extends "res://core/scene_core/tests/support/scene_case.gd"
## The loading screen: its making, its place, its minimum display time and its progress.


func test_loading_screen_root_that_is_not_loading_screen_base_logs_and_transition_goes_on_without_it() -> void:
	set_string("loadingScreen", BAD_LOADING)
	assert_true(await start_booted(SCENE_A))
	var ok: bool = await SceneCore.change_scene(SCENE_B, null)
	assert_true(ok)
	assert_eq(errors(TAG), 1)
	assert_false(Trace.has("loading_show"))
	assert_eq(SceneCore._loading_area.get_child_count(), 0)
	assert_eq(SceneCore.current_scene_key(), SCENE_B)


func test_empty_loading_screen_key_fails_the_load_logs_and_transition_goes_on_without_it() -> void:
	set_string("loadingScreen", "")
	assert_true(await start_booted(SCENE_A))
	var ok: bool = await SceneCore.change_scene(SCENE_B, null)
	assert_true(ok)
	assert_eq(UnitTestCore.check_logs(ERROR, "ResourceCore"), 1)
	assert_eq(errors(TAG), 1)
	assert_false(Trace.has("loading_show"))
	assert_null(SceneCore._loading_screen)
	assert_eq(SceneCore._loading_area.get_child_count(), 0)
	assert_eq(SceneCore.current_scene_key(), SCENE_B)
	# the next transition tries again
	assert_true(await SceneCore.change_scene(SCENE_A, null))
	assert_eq(errors(TAG), 1)
	assert_false(Trace.has("loading_show"))


func test_two_transitions_make_the_loading_screen_once_in_the_global_scope() -> void:
	assert_true(await start_booted(SCENE_A))
	assert_true(await SceneCore.change_scene(SCENE_B, null))
	assert_true(await SceneCore.change_scene(SCENE_A, null))
	assert_eq(TestLoading.made_count, 1)
	assert_eq(Trace.count("loading_show"), 2)
	assert_true(ResourceCore.get_global_scope().keys.has(LOADING))


func test_loading_screen_fills_the_loading_safe_area_root() -> void:
	assert_true(await start_booted(SCENE_A))
	TestLoading.show_gate = Gate.new()
	var results: PackedInt32Array = PackedInt32Array()
	change_later(SCENE_B, results)
	await wait_trace("loading_show")
	await UnitTestCore.wait_frames(2)
	var area: SafeAreaRoot = SceneCore._loading_area
	assert_eq(area.get_parent(), UICore.get_layer(UICore.UILayer.LOADING))
	var screen: LoadingScreenBase = SceneCore._loading_screen
	assert_not_null(screen)
	if screen == null:
		return
	assert_eq(screen.get_parent(), area)
	_assert_layout(screen)
	await set_notch_screen()
	_assert_layout(screen)
	SafeAreaCoreDev.set_virtual_notch(40, 30, 20, 10)
	await UnitTestCore.wait_frames(2)
	_assert_layout(screen)
	SafeAreaCoreDev.clear_virtual_notch()
	TestLoading.show_gate.open()
	await wait_trace("started:" + SCENE_B)
	var layer: Node = UICore.get_layer(UICore.UILayer.LOADING)
	SceneCore.release()
	for child: Node in layer.get_children():
		assert_false(child is SafeAreaRoot and not child.is_queued_for_deletion(), "Loading layer safe area root")


func test_loading_screen_hides_after_the_minimum_display_time() -> void:
	set_int("SceneCore.loadingMinDisplayMs", 500)
	assert_true(await start_booted(SCENE_A))
	var results: PackedInt32Array = PackedInt32Array()
	change_later(SCENE_B, results)
	await wait_trace("start:" + SCENE_B)
	await UnitTestCore.wait_frames(3)
	assert_false(Trace.has("loading_hide"))
	await advance(499)
	assert_false(Trace.has("loading_hide"))
	await advance(1)
	await wait_trace("loading_hide")
	await wait_trace("started:" + SCENE_B)
	assert_eq(results, PackedInt32Array([1]))


func test_progress_starts_at_0_never_falls_and_reaches_1000() -> void:
	assert_true(await start_booted(SCENE_A))
	TestScene.preload_keys = PackedStringArray([PRELOAD_ITEM, SCENE_B, SCENE_UI])
	TestScene.prepare_gate = Gate.new()
	TestScene.prepare_results = []
	var results: PackedInt32Array = PackedInt32Array()
	change_later(SCENE_PANEL, results)
	await wait_trace("prepare:" + SCENE_PANEL)
	assert_eq(TestScene.progress_at_preload, PackedInt32Array([0]), "0 until on_preload returns")
	var before_prepare: PackedInt32Array = TestLoading.progress.duplicate()
	TestScene.prepare_gate.open(true)
	await wait_trace("started:" + SCENE_PANEL)
	var values: PackedInt32Array = TestLoading.progress
	assert_eq(values[0], 0)
	for i: int in range(1, values.size()):
		assert_true(values[i] > values[i - 1], "never falls: %s" % [values])
		assert_true(values[i] <= 1000)
	assert_eq(values[values.size() - 1], 1000)
	# the scene load, then one rise for each of the three preload items: 5 tasks with on_prepare
	assert_eq(before_prepare, PackedInt32Array([0, 200, 400, 600, 800]))
	assert_eq(results, PackedInt32Array([1]))


func test_progress_reaches_1000_without_pool_fill_items() -> void:
	assert_true(await start_booted(SCENE_A))
	assert_true(await SceneCore.change_scene(SCENE_B, null))
	assert_eq(TestLoading.progress, PackedInt32Array([0, 500, 1000]))


# The loading screen has the place and size of the safe area, and its background with the ignore mark covers the
# visible game area.
func _assert_layout(screen: LoadingScreenBase) -> void:
	var loading: TestLoading = screen as TestLoading
	assert_true(Rect2(screen.global_position, screen.size).is_equal_approx(SafeAreaCore.get_safe_area()))
	var background: Control = loading.background
	var visible_area: Rect2 = ResolutionCore.get_visible_game_area()
	assert_true(Rect2(background.global_position, background.size).is_equal_approx(visible_area))
