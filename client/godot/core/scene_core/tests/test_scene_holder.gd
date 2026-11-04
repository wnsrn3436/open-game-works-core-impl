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


## A node with a `process_mode` of its own does not inherit the disabled scene holder: the one in the scene resource,
## one `on_preload` adds, one `on_preload` gives a mode after adding it and one the test gives a mode during stage 6.
func test_nodes_with_a_process_mode_of_their_own_run_frames_only_after_stage_7() -> void:
	assert_true(await start_booted(SCENE_A))
	var counters: Array[Counter] = []
	TestScene.preload_hook = func(scene: SceneBase) -> void:
		var added: Counter = Counter.new()
		added.process_mode = Node.PROCESS_MODE_ALWAYS
		scene.add_child(added)
		var given: Counter = Counter.new()
		scene.add_child(given)
		given.process_mode = Node.PROCESS_MODE_PAUSABLE
		var later: Counter = Counter.new()
		scene.add_child(later)
		counters.append_array([scene.get_node("Counter") as Counter, added, given, later])
	TestScene.prepare_gate = Gate.new()
	var results: PackedInt32Array = PackedInt32Array()
	change_later(SCENE_B, results)
	await wait_trace("prepare:" + SCENE_B)
	assert_eq(counters.size(), 4)
	if counters.size() != 4:
		return
	counters[3].process_mode = Node.PROCESS_MODE_ALWAYS
	await _wait_frames_and_physics(3)
	for i: int in counters.size():
		assert_eq(counters[i].process_count, 0, "process of counter %d before stage 7" % i)
		assert_eq(counters[i].physics_count, 0, "physics process of counter %d before stage 7" % i)
	TestScene.prepare_gate.open(true)
	await wait_trace("started:" + SCENE_B)
	await _wait_frames_and_physics(2)
	var modes: PackedInt32Array = [
		Node.PROCESS_MODE_ALWAYS, Node.PROCESS_MODE_ALWAYS, Node.PROCESS_MODE_PAUSABLE, Node.PROCESS_MODE_ALWAYS,
	]
	for i: int in counters.size():
		assert_eq(counters[i].process_mode as int, modes[i], "mode of counter %d after stage 7" % i)
		assert_gt(counters[i].process_count, 0, "process of counter %d after stage 7" % i)
		assert_gt(counters[i].physics_count, 0, "physics process of counter %d after stage 7" % i)
	assert_eq(results, PackedInt32Array([1]))


## A node that processes before the core nodes is disabled before its own callback when scene code gives it a mode of
## its own: at the start of a frame and at the start of a physics frame.
func test_nodes_that_process_first_and_get_a_mode_during_stage_6_run_frames_only_after_stage_7() -> void:
	assert_true(await start_booted(SCENE_A))
	var counters: Array[Counter] = []
	TestScene.preload_hook = func(scene: SceneBase) -> void:
		for priority: int in [-1, -2000000]:
			for i: int in 2:
				var counter: Counter = Counter.new()
				counter.process_priority = priority
				counter.process_physics_priority = priority
				scene.add_child(counter)
				counters.append(counter)
	TestScene.prepare_gate = Gate.new()
	var results: PackedInt32Array = PackedInt32Array()
	change_later(SCENE_B, results)
	await wait_trace("prepare:" + SCENE_B)
	assert_eq(counters.size(), 4)
	if counters.size() != 4:
		return
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	# goes on at the start of a frame
	counters[0].process_mode = Node.PROCESS_MODE_ALWAYS
	counters[2].process_mode = Node.PROCESS_MODE_ALWAYS
	await tree.physics_frame
	# goes on at the start of a physics frame
	counters[1].process_mode = Node.PROCESS_MODE_ALWAYS
	counters[3].process_mode = Node.PROCESS_MODE_ALWAYS
	await _wait_frames_and_physics(3)
	for i: int in counters.size():
		assert_eq(counters[i].process_count, 0, "process of counter %d before stage 7" % i)
		assert_eq(counters[i].physics_count, 0, "physics process of counter %d before stage 7" % i)
	TestScene.prepare_gate.open(true)
	await wait_trace("started:" + SCENE_B)
	await _wait_frames_and_physics(2)
	for i: int in counters.size():
		assert_eq(counters[i].process_mode, Node.PROCESS_MODE_ALWAYS, "mode of counter %d after stage 7" % i)
		assert_gt(counters[i].process_count, 0, "process of counter %d after stage 7" % i)
		assert_gt(counters[i].physics_count, 0, "physics process of counter %d after stage 7" % i)
	assert_eq(results, PackedInt32Array([1]))


## The stop check runs only while the new scene is hidden and reads the nodes under the scene holder from the set that
## `node_added` and `node_removed` keep, without walking the tree.
func test_stop_check_runs_only_from_stage_4_until_stage_7_on_the_nodes_under_the_holder() -> void:
	assert_true(await start_booted(SCENE_A))
	var stop_check: Node = SceneCore._stop_check_node
	assert_false(stop_check.is_processing(), "after the boot transition")
	assert_false(stop_check.is_physics_processing(), "after the boot transition")
	TestScene.prepare_gate = Gate.new()
	var results: PackedInt32Array = PackedInt32Array()
	change_later(SCENE_B, results)
	await wait_trace("prepare:" + SCENE_B)
	var scene: TestScene = TestScene.last as TestScene
	assert_not_null(scene)
	if scene == null:
		return
	assert_true(stop_check.is_processing(), "during stage 6")
	assert_true(stop_check.is_physics_processing(), "during stage 6")
	assert_eq(SceneCore._watched.size(), _count_under(SceneCore._holder))
	var added: Node2D = Node2D.new()
	var child: Node = Node.new()
	added.add_child(child)
	scene.add_child(added)
	assert_true(SceneCore._watched.has(added))
	assert_true(SceneCore._watched.has(child))
	# a node that leaves the scene holder leaves the set, and its mode is not checked any more
	var taken: Counter = Counter.new()
	scene.add_child(taken)
	scene.remove_child(taken)
	assert_false(SceneCore._watched.has(taken))
	add_child_autofree(taken)
	taken.process_mode = Node.PROCESS_MODE_ALWAYS
	var watched_before_free: int = SceneCore._watched.size()
	added.queue_free()
	await _wait_frames_and_physics(2)
	assert_false(is_instance_valid(added))
	assert_eq(SceneCore._watched.size(), watched_before_free - 2, "a freed node and its child left the set")
	assert_eq(SceneCore._watched.size(), _count_under(SceneCore._holder))
	assert_eq(taken.process_mode, Node.PROCESS_MODE_ALWAYS)
	assert_gt(taken.process_count, 0)
	TestScene.prepare_gate.open(true)
	await wait_trace("started:" + SCENE_B)
	assert_false(stop_check.is_processing(), "after stage 7")
	assert_false(stop_check.is_physics_processing(), "after stage 7")
	assert_eq(SceneCore._watched.size(), 0)
	assert_eq(results, PackedInt32Array([1]))


## A transition that ends with `false` in stage 6 and stays in transition until `release` ends the stop check.
func test_stop_check_ends_when_the_transition_ends_with_false() -> void:
	assert_true(await start_booted(SCENE_A))
	var stop_check: Node = SceneCore._stop_check_node
	# restart through the retry popup
	TestScene.prepare_results = [false]
	var results: PackedInt32Array = PackedInt32Array()
	change_later(SCENE_B, results)
	await wait_trace("prepare:" + SCENE_B)
	await wait_popup_layout()
	assert_true(stop_check.is_processing(), "while the retry popup is open")
	UICore.close_all_popups()
	await wait_trace("restart")
	await UnitTestCore.wait_frames(2)
	assert_eq(results, PackedInt32Array([0]))
	assert_true(SceneCore.is_transitioning())
	assert_false(stop_check.is_processing(), "after the restart")
	assert_false(stop_check.is_physics_processing(), "after the restart")
	assert_eq(SceneCore._watched.size(), 0)
	# unrecoverable failure of the boot transition
	SceneCore.release()
	assert_true(SceneCore.init())
	stop_check = SceneCore._stop_check_node
	TestScene.prepare_results = [false]
	var failed: bool = await SceneCore.boot_change_scene(SCENE_B, null)
	assert_false(failed)
	assert_eq(errors(TAG), 1)
	assert_true(SceneCore.is_transitioning())
	assert_false(stop_check.is_processing(), "after the fatal failure")
	assert_false(stop_check.is_physics_processing(), "after the fatal failure")
	assert_eq(SceneCore._watched.size(), 0)


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


## Count of the nodes under `node`.
func _count_under(node: Node) -> int:
	var count: int = 0
	for child: Node in node.get_children():
		count += 1 + _count_under(child)
	return count
