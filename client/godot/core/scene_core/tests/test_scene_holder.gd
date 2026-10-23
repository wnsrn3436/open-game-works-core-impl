extends "res://core/scene_core/tests/support/scene_case.gd"
## The scene holder from stage 4 to stage 7 and the scene UI root.


func test_new_scene_is_not_on_screen_from_stage_4_until_stage_7() -> void:
	assert_true(await start_booted(SCENE_A))
	TestScene.prepare_gate = Gate.new()
	var results: PackedInt32Array = PackedInt32Array()
	change_later(SCENE_B, results)
	await wait_trace("prepare:" + SCENE_B)
	var scene: TestScene = TestScene.last as TestScene
	assert_not_null(scene)
	if scene == null:
		return
	assert_false(scene.visible_in_preload)
	var layer: CanvasLayer = scene.get_node("Layer") as CanvasLayer
	var spatial: Node3D = scene.get_node("Spatial") as Node3D
	assert_false(scene.probe.is_visible_in_tree())
	assert_false(layer.visible)
	assert_false(spatial.is_visible_in_tree())
	# a node the scene adds before stage 7 is hidden too
	var added: Node2D = Node2D.new()
	scene.add_child(added)
	assert_false(added.visible)
	TestScene.prepare_gate.open(true)
	await wait_trace("started:" + SCENE_B)
	assert_true(scene.probe.is_visible_in_tree())
	assert_true(layer.visible)
	assert_true(spatial.is_visible_in_tree())
	assert_true(added.visible)
	assert_eq(results, PackedInt32Array([1]))


func test_new_scene_reads_its_children_in_on_preload_and_runs_frames_only_after_stage_7() -> void:
	assert_true(await start_booted(SCENE_A))
	TestScene.prepare_gate = Gate.new()
	var results: PackedInt32Array = PackedInt32Array()
	change_later(SCENE_B, results)
	await wait_trace("prepare:" + SCENE_B)
	var scene: TestScene = TestScene.last as TestScene
	assert_not_null(scene)
	if scene == null:
		return
	assert_true(scene.children_ready_in_preload)
	await UnitTestCore.wait_frames(3)
	assert_eq(scene.process_count, 0)
	TestScene.prepare_gate.open(true)
	await wait_trace("started:" + SCENE_B)
	await UnitTestCore.wait_frames(2)
	assert_gt(scene.process_count, 0)


func test_scene_ui_root_is_under_the_scene_ui_safe_area_root() -> void:
	assert_true(await start_booted(SCENE_A))
	assert_true(await SceneCore.change_scene(SCENE_UI, null))
	var scene: TestScene = TestScene.last as TestScene
	var ui_root: Control = scene.ui_root
	var area: SafeAreaRoot = SceneCore._scene_ui_area
	assert_eq(ui_root.get_parent(), area)
	assert_eq(area.get_parent(), UICore.get_layer(UICore.UILayer.SCENE_UI))
	assert_true(_rect_of(ui_root).is_equal_approx(SafeAreaCore.get_safe_area()))
	await set_notch_screen()
	assert_true(_rect_of(ui_root).is_equal_approx(SafeAreaCore.get_safe_area()))
	SafeAreaCoreDev.set_virtual_notch(40, 30, 20, 10)
	await UnitTestCore.wait_frames(2)
	assert_true(_rect_of(ui_root).is_equal_approx(SafeAreaCore.get_safe_area()))
	SafeAreaCoreDev.clear_virtual_notch()
	TestScene.prepare_gate = Gate.new()
	var results: PackedInt32Array = PackedInt32Array()
	change_later(SCENE_B, results)
	await wait_trace("loaded:" + SCENE_B)
	assert_false(is_instance_valid(ui_root), "destroyed by stage 3")
	assert_eq(area.get_child_count(), 0)
	TestScene.prepare_gate.open(true)
	await wait_trace("started:" + SCENE_B)


func test_ignore_element_under_the_scene_ui_root_passes_the_parent_check_under_a_virtual_notch() -> void:
	assert_true(await start_booted(SCENE_A))
	await set_notch_screen()
	SafeAreaCoreDev.set_virtual_notch(40, 30, 20, 10)
	await UnitTestCore.wait_frames(2)
	assert_false(SafeAreaCore.get_safe_area().is_equal_approx(ResolutionCore.get_visible_game_area()))
	TestScene.prepare_gate = Gate.new()
	var results: PackedInt32Array = PackedInt32Array()
	change_later(SCENE_UI_IGNORE, results)
	await wait_trace("prepare:" + SCENE_UI_IGNORE)
	var scene: TestScene = TestScene.last as TestScene
	assert_not_null(scene)
	if scene == null:
		return
	# under the scene holder, the scene UI root already has the place of the safe area root
	assert_true(_rect_of(scene.ui_root).is_equal_approx(SafeAreaCore.get_safe_area()))
	await UnitTestCore.wait_frames(2)
	assert_eq(errors("SafeAreaCore"), 0, "no parent rule error under the scene holder")
	TestScene.prepare_gate.open(true)
	await wait_trace("started:" + SCENE_UI_IGNORE)
	await UnitTestCore.wait_frames(2)
	assert_eq(results, PackedInt32Array([1]))
	assert_eq(errors("SafeAreaCore"), 0, "no parent rule error after stage 7")
	var background: Control = scene.ui_root.get_node("Background") as Control
	assert_true(background.get_global_rect().is_equal_approx(ResolutionCore.get_visible_game_area()))
	SafeAreaCoreDev.clear_virtual_notch()


func test_ignore_element_made_in_on_prepare_after_an_inset_change_passes_the_parent_check() -> void:
	assert_true(await start_booted(SCENE_A))
	await set_notch_screen()
	TestScene.prepare_hook = func(scene: SceneBase) -> void:
		SafeAreaCoreDev.set_virtual_notch(40, 30, 20, 10)
		var element: Control = Control.new()
		element.name = "Made"
		scene.ui_root.add_child(element)
		element.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		element.add_child(SafeAreaIgnore.new())
	TestScene.prepare_gate = Gate.new()
	var results: PackedInt32Array = PackedInt32Array()
	change_later(SCENE_UI_IGNORE, results)
	await wait_trace("prepare:" + SCENE_UI_IGNORE)
	var scene: TestScene = TestScene.last as TestScene
	assert_not_null(scene)
	if scene == null:
		return
	assert_false(SafeAreaCore.get_safe_area().is_equal_approx(ResolutionCore.get_visible_game_area()))
	# the scene UI root followed the inset change before stage 7
	assert_true(_rect_of(scene.ui_root).is_equal_approx(SafeAreaCore.get_safe_area()))
	await UnitTestCore.wait_frames(2)
	assert_eq(errors("SafeAreaCore"), 0, "no parent rule error under the scene holder")
	TestScene.prepare_gate.open(true)
	await wait_trace("started:" + SCENE_UI_IGNORE)
	await UnitTestCore.wait_frames(2)
	assert_eq(results, PackedInt32Array([1]))
	assert_eq(errors("SafeAreaCore"), 0, "no parent rule error after stage 7")
	var visible_area: Rect2 = ResolutionCore.get_visible_game_area()
	for path: String in ["Background", "Made"]:
		var element: Control = scene.ui_root.get_node(path) as Control
		assert_true(element.get_global_rect().is_equal_approx(visible_area), path)
	SafeAreaCoreDev.clear_virtual_notch()


func test_scene_without_ui_root_adds_nothing_to_the_scene_ui_layer() -> void:
	assert_true(await start_booted(SCENE_A))
	assert_true(await SceneCore.change_scene(SCENE_B, null))
	assert_eq(SceneCore._scene_ui_area.get_child_count(), 0)


func _rect_of(control: Control) -> Rect2:
	return Rect2(control.global_position, control.size)
