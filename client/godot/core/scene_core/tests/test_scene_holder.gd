extends "res://core/scene_core/tests/support/scene_case.gd"
## The scene holder from stage 4 to stage 7 and the scene UI root.

const Counter := preload("res://core/scene_core/tests/support/process_counter.gd")


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


## An object directly under the scene root that is hidden in the scene resource stays hidden after the transition,
## and the other objects of the scene are on screen.
func test_node_hidden_in_the_scene_resource_is_still_hidden_after_the_transition() -> void:
	assert_true(await start_booted(SCENE_A))
	TestScene.prepare_gate = Gate.new()
	var results: PackedInt32Array = PackedInt32Array()
	change_later(SCENE_B, results)
	await wait_trace("prepare:" + SCENE_B)
	var scene: TestScene = TestScene.last as TestScene
	assert_not_null(scene)
	if scene == null:
		return
	TestScene.prepare_gate.open(true)
	await wait_trace("started:" + SCENE_B)
	assert_false((scene.get_node("Hidden2D") as Node2D).visible)
	assert_false((scene.get_node("HiddenLayer") as CanvasLayer).visible)
	assert_false((scene.get_node("Hidden3D") as Node3D).visible)
	assert_true(scene.probe.is_visible_in_tree())
	assert_true((scene.get_node("Layer") as CanvasLayer).visible)
	assert_true((scene.get_node("Spatial") as Node3D).is_visible_in_tree())
	assert_eq(results, PackedInt32Array([1]))


## Stage 7 makes every object SceneCore hid visible again, also one that scene code hid before stage 7.
func test_node_that_on_prepare_hides_is_visible_after_stage_7() -> void:
	assert_true(await start_booted(SCENE_A))
	TestScene.prepare_hook = func(scene: SceneBase) -> void:
		(scene as TestScene).probe.visible = false
		(scene.get_node("Layer") as CanvasLayer).visible = false
		(scene.get_node("Spatial") as Node3D).visible = false
	var results: PackedInt32Array = PackedInt32Array()
	change_later(SCENE_B, results)
	await wait_trace("started:" + SCENE_B)
	var scene: TestScene = TestScene.last as TestScene
	assert_not_null(scene)
	if scene == null:
		return
	assert_true(scene.probe.is_visible_in_tree())
	assert_true((scene.get_node("Layer") as CanvasLayer).visible)
	assert_true((scene.get_node("Spatial") as Node3D).is_visible_in_tree())
	assert_false((scene.get_node("Hidden2D") as Node2D).visible)
	assert_eq(results, PackedInt32Array([1]))


## A node with a `process_mode` of its own does not inherit the disabled scene holder: the one in the scene resource
## and one `on_preload` adds with its mode.
func test_nodes_with_a_process_mode_of_their_own_run_frames_only_after_stage_7() -> void:
	assert_true(await start_booted(SCENE_A))
	var counters: Array[Counter] = []
	TestScene.preload_hook = func(scene: SceneBase) -> void:
		var added: Counter = Counter.new()
		added.process_mode = Node.PROCESS_MODE_PAUSABLE
		scene.add_child(added)
		counters.append_array([scene.get_node("Counter") as Counter, added])
	TestScene.prepare_gate = Gate.new()
	var results: PackedInt32Array = PackedInt32Array()
	change_later(SCENE_B, results)
	await wait_trace("prepare:" + SCENE_B)
	assert_eq(counters.size(), 2)
	if counters.size() != 2:
		return
	await _wait_frames_and_physics(3)
	for i: int in counters.size():
		assert_eq(counters[i].process_mode, Node.PROCESS_MODE_DISABLED, "mode of counter %d before stage 7" % i)
		assert_eq(counters[i].process_count, 0, "process of counter %d before stage 7" % i)
		assert_eq(counters[i].physics_count, 0, "physics process of counter %d before stage 7" % i)
	TestScene.prepare_gate.open(true)
	await wait_trace("started:" + SCENE_B)
	await _wait_frames_and_physics(2)
	var modes: PackedInt32Array = [Node.PROCESS_MODE_ALWAYS, Node.PROCESS_MODE_PAUSABLE]
	for i: int in counters.size():
		assert_eq(counters[i].process_mode as int, modes[i], "mode of counter %d after stage 7" % i)
		assert_gt(counters[i].process_count, 0, "process of counter %d after stage 7" % i)
		assert_gt(counters[i].physics_count, 0, "physics process of counter %d after stage 7" % i)
	assert_eq(results, PackedInt32Array([1]))


## Stage 7 gives each remembered node that is not freed the one mode read when it was disabled, without reading its
## mode: also when scene code gave it another mode before stage 7. A node added again with a mode of its own is
## remembered with the mode read then.
func test_remembered_node_gets_its_remembered_mode_back_at_stage_7() -> void:
	assert_true(await start_booted(SCENE_A))
	var counters: Array[Counter] = []
	TestScene.preload_hook = func(scene: SceneBase) -> void:
		for mode: int in [Node.PROCESS_MODE_PAUSABLE, Node.PROCESS_MODE_ALWAYS, Node.PROCESS_MODE_ALWAYS]:
			var counter: Counter = Counter.new()
			counter.process_mode = mode as Node.ProcessMode
			scene.add_child(counter)
			counters.append(counter)
	TestScene.prepare_gate = Gate.new()
	var results: PackedInt32Array = PackedInt32Array()
	change_later(SCENE_B, results)
	await wait_trace("prepare:" + SCENE_B)
	var scene: TestScene = TestScene.last as TestScene
	assert_not_null(scene)
	if scene == null or counters.size() != 3:
		assert_eq(counters.size(), 3)
		return
	var in_resource: Counter = scene.get_node("Counter") as Counter
	# scene code gives remembered nodes other modes
	in_resource.process_mode = Node.PROCESS_MODE_PAUSABLE
	counters[0].process_mode = Node.PROCESS_MODE_ALWAYS
	counters[1].process_mode = Node.PROCESS_MODE_INHERIT
	# added again with a mode of its own: remembered with that mode
	scene.remove_child(counters[2])
	counters[2].process_mode = Node.PROCESS_MODE_WHEN_PAUSED
	scene.add_child(counters[2])
	assert_eq(counters[2].process_mode, Node.PROCESS_MODE_DISABLED, "disabled when added again")
	# a remembered node freed before stage 7
	var freed: Counter = Counter.new()
	freed.process_mode = Node.PROCESS_MODE_ALWAYS
	scene.add_child(freed)
	freed.free()
	await UnitTestCore.wait_frames(2)
	TestScene.prepare_gate.open(true)
	await wait_trace("started:" + SCENE_B)
	assert_eq(in_resource.process_mode, Node.PROCESS_MODE_ALWAYS, "remembered mode of the resource node")
	assert_eq(counters[0].process_mode, Node.PROCESS_MODE_PAUSABLE, "remembered mode after another mode")
	assert_eq(counters[1].process_mode, Node.PROCESS_MODE_ALWAYS, "remembered mode after inherit")
	assert_eq(counters[2].process_mode, Node.PROCESS_MODE_WHEN_PAUSED, "mode read when added again")
	assert_eq(SceneCore._stopped.size(), 0)
	assert_eq(errors(TAG), 0)
	assert_eq(results, PackedInt32Array([1]))


## A node that scene code adds while the stage 4 hiding notifies it, to a node whose children the hiding already went
## through, is hidden and disabled through `node_added` until stage 7.
func test_node_added_by_a_handler_of_the_stage_4_hiding_runs_frames_only_after_stage_7() -> void:
	assert_true(await start_booted(SCENE_A))
	var counters: Array[Counter] = []
	var sprites: Array[Node2D] = []
	TestScene.ready_hook = func(scene: SceneBase) -> void:
		var probe: Node2D = (scene as TestScene).probe
		probe.visibility_changed.connect(func() -> void:
			if counters.is_empty():
				var counter: Counter = Counter.new()
				counter.process_mode = Node.PROCESS_MODE_ALWAYS
				scene.add_child(counter)
				counters.append(counter)
				var sprite: Node2D = Node2D.new()
				scene.add_child(sprite)
				sprites.append(sprite))
	TestScene.prepare_gate = Gate.new()
	var results: PackedInt32Array = PackedInt32Array()
	change_later(SCENE_B, results)
	await wait_trace("prepare:" + SCENE_B)
	assert_eq(counters.size(), 1, "the hiding of stage 4 ran the handler")
	if counters.size() != 1:
		return
	assert_false(sprites[0].visible, "hidden before stage 7")
	await _wait_frames_and_physics(3)
	assert_eq(counters[0].process_count, 0, "process before stage 7")
	assert_eq(counters[0].physics_count, 0, "physics process before stage 7")
	TestScene.prepare_gate.open(true)
	await wait_trace("started:" + SCENE_B)
	await _wait_frames_and_physics(2)
	assert_true(sprites[0].visible, "visible after stage 7")
	assert_eq(counters[0].process_mode, Node.PROCESS_MODE_ALWAYS)
	assert_gt(counters[0].process_count, 0, "process after stage 7")
	assert_gt(counters[0].physics_count, 0, "physics process after stage 7")
	assert_eq(results, PackedInt32Array([1]))


## A node that scene code removes from the scene, or frees, while the stage 4 hiding notifies it, before the hiding
## reached that node, is skipped by the hiding, and the nodes added later are still hidden and disabled.
func test_node_removed_by_a_handler_of_the_stage_4_hiding_is_skipped() -> void:
	await _check_node_left_during_the_stage_4_hiding(false)


func test_node_freed_by_a_handler_of_the_stage_4_hiding_is_skipped() -> void:
	await _check_node_left_during_the_stage_4_hiding(true)


func _check_node_left_during_the_stage_4_hiding(frees: bool) -> void:
	var label: String = "freed" if frees else "removed"
	assert_true(await start_booted(SCENE_A))
	var taken: Array[Node] = []
	TestScene.ready_hook = func(scene: SceneBase) -> void:
		var probe: Node2D = (scene as TestScene).probe
		probe.visibility_changed.connect(func() -> void:
			if taken.is_empty():
				var spatial: Node = scene.get_node("Spatial")
				taken.append(spatial)
				scene.remove_child(spatial)
				if frees:
					spatial.free())
	TestScene.prepare_gate = Gate.new()
	var results: PackedInt32Array = PackedInt32Array()
	change_later(SCENE_B, results)
	await wait_trace("prepare:" + SCENE_B)
	var scene: TestScene = TestScene.last as TestScene
	assert_not_null(scene)
	if scene == null or taken.size() != 1:
		assert_eq(taken.size(), 1, "the hiding of stage 4 ran the handler (%s)" % label)
		return
	if not frees:
		assert_true((taken[0] as Node3D).visible, "the removed node is not hidden")
		taken[0].free()
	var counter: Counter = Counter.new()
	counter.process_mode = Node.PROCESS_MODE_ALWAYS
	scene.add_child(counter)
	await _wait_frames_and_physics(3)
	assert_eq(counter.process_count, 0, "process before stage 7 (%s)" % label)
	assert_eq(counter.physics_count, 0, "physics process before stage 7 (%s)" % label)
	TestScene.prepare_gate.open(true)
	await wait_trace("started:" + SCENE_B)
	await _wait_frames_and_physics(2)
	assert_gt(counter.process_count, 0, "process after stage 7 (%s)" % label)
	assert_eq(errors(TAG), 0)
	assert_eq(results, PackedInt32Array([1]))


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


## Waits `count` frames and `count` physics frames.
func _wait_frames_and_physics(count: int) -> void:
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	await UnitTestCore.wait_frames(count)
	for i: int in count:
		await tree.physics_frame


func _rect_of(control: Control) -> Rect2:
	return Rect2(control.global_position, control.size)

