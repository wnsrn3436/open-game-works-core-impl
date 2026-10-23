extends "res://core/scene_core/tests/support/scene_case.gd"
## Lifecycle: init check, release in every waiting stage, init again and destruction of the core node outside
## release.

## Entries a stopped transition must not add after `release`.
const _LATER_STAGES: PackedStringArray = [
	"loaded:", "preload:", "prepare:", "panel:", "start:", "loading_hide", "started:"
]

## The release point of `_check_release_while_waiting`.
var _point: String = ""
## Set when `_release_at` released: the trace size, the loading screen and the scene resource of the new scene then.
var _trace_at_release: int = -1
var _loading_at_release: LoadingScreenBase = null
## Set by `_release_at` at the point `preload`: the scope and the scene resource of the new scene.
var _scope_at_release: Scope = null
var _resource_at_release: WeakRef = null


func test_is_initialized_before_init_after_init_and_after_release() -> void:
	assert_true(await start_modules(false))
	assert_false(SceneCore.is_initialized())
	assert_true(SceneCore.init())
	assert_true(SceneCore.is_initialized())
	SceneCore.release()
	assert_false(SceneCore.is_initialized())


func test_operations_before_init_log_an_error() -> void:
	assert_true(await start_modules(false))
	assert_false(await SceneCore.change_scene(SCENE_A, null))
	assert_false(await SceneCore.boot_change_scene(SCENE_A, null))
	assert_eq(SceneCore.current_scene_key(), "")
	assert_null(SceneCore.current_scope())
	assert_eq(SceneCore.current_root_panel_key(), "")
	assert_false(SceneCore.is_transitioning())
	assert_eq(errors(TAG), 6)
	assert_true(SceneCore.init())
	assert_false(SceneCore.init())
	assert_eq(errors(TAG), 1)


func test_no_current_scene_before_the_first_transition() -> void:
	assert_true(await start_modules())
	assert_eq(SceneCore.current_scene_key(), "")
	assert_null(SceneCore.current_scope())
	assert_eq(SceneCore.current_root_panel_key(), "")
	assert_false(SceneCore.is_transitioning())


func test_release_puts_static_vars_back_and_takes_its_objects_out() -> void:
	assert_true(await start_booted(SCENE_UI))
	assert_true(await SceneCore.change_scene(SCENE_PANEL, null))
	var node: Node = SceneCore._node
	var holder: Node = SceneCore._holder
	var scene_ui_area: SafeAreaRoot = SceneCore._scene_ui_area
	var loading_area: SafeAreaRoot = SceneCore._loading_area
	var scene: SceneBase = SceneCore._scene
	var loading_screen: LoadingScreenBase = SceneCore._loading_screen
	assert_true(node.is_inside_tree())
	SceneCore.release()
	assert_false(node.is_inside_tree())
	assert_false(holder.is_inside_tree())
	assert_false(scene_ui_area.is_inside_tree())
	assert_false(loading_area.is_inside_tree())
	assert_false(SceneCore._is_initialized)
	assert_null(SceneCore._session)
	assert_null(SceneCore._node)
	assert_null(SceneCore._holder)
	assert_null(SceneCore._scene_ui_area)
	assert_null(SceneCore._loading_area)
	assert_eq(SceneCore._loading_screen_key, "")
	assert_eq(SceneCore._min_display_ms, 0)
	assert_eq(SceneCore._retry_count, 0)
	assert_null(SceneCore._scene)
	assert_eq(SceneCore._scene_key, "")
	assert_null(SceneCore._scope)
	assert_eq(SceneCore._root_panel, "")
	assert_null(SceneCore._ui_root)
	assert_null(SceneCore._new_scene)
	assert_false(SceneCore._booted)
	assert_false(SceneCore._transitioning)
	assert_eq(SceneCore._transition_key, "")
	assert_null(SceneCore._job)
	assert_eq(SceneCore._block_token, 0)
	assert_null(SceneCore._loading_screen)
	assert_false(SceneCore._loading_shown)
	assert_eq(SceneCore._shown_at, 0)
	assert_false(SceneCore._hiding)
	assert_eq(SceneCore._hidden.size(), 0)
	assert_eq(SceneCore._progress_done, 0)
	assert_eq(SceneCore._progress_total, 0)
	assert_eq(SceneCore._progress_last, 0)
	assert_eq(SceneCore._deadline, 0)
	assert_null(SceneCore._deadline_wait)
	assert_null(SceneCore._preload_wait)
	assert_null(SceneCore._popup_wait)
	assert_null(SceneCore._popup_param)
	await UnitTestCore.wait_frames(1)
	assert_false(is_instance_valid(scene))
	assert_false(is_instance_valid(loading_screen))
	assert_false(is_instance_valid(node))
	assert_eq(scene_blocks(), 0)


func test_release_while_waiting_for_on_show() -> void:
	await _check_release_while_waiting("on_show")


func test_release_while_waiting_for_the_destruction_of_the_previous_scene() -> void:
	await _check_release_while_waiting("destroy")


func test_release_while_waiting_for_the_scene_load() -> void:
	await _check_release_while_waiting("scene_load")


func test_release_while_waiting_for_a_preload_item() -> void:
	await _check_release_while_waiting("preload")


func test_release_while_waiting_for_the_pool_fill() -> void:
	await _check_release_while_waiting("prefill")


func test_release_while_waiting_for_on_prepare() -> void:
	await _check_release_while_waiting("on_prepare")


func test_release_while_the_retry_popup_is_open() -> void:
	await _check_release_while_waiting("retry_popup")


func test_release_while_waiting_for_the_root_panel_prepare() -> void:
	await _check_release_while_waiting("root_panel")


func test_release_while_waiting_for_on_start() -> void:
	await _check_release_while_waiting("on_start")


func test_release_while_waiting_for_the_minimum_display_time() -> void:
	await _check_release_while_waiting("min_display")


func test_release_while_waiting_for_on_hide() -> void:
	await _check_release_while_waiting("on_hide")


func test_transition_stopped_in_a_callback_that_never_returns_keeps_no_scene_resource() -> void:
	assert_true(await start_booted(SCENE_A))
	TestScene.prepare_gate = Gate.new()
	var results: PackedInt32Array = PackedInt32Array()
	change_later(SCENE_B, results)
	await wait_trace("prepare:" + SCENE_B)
	var scope: Scope = (TestScene.last as SceneBase).scope
	var resource: WeakRef = weakref(ResourceCore.get_loaded(SCENE_B, ResourceCore.BaseKind.PACKED_SCENE, scope))
	assert_true(resource.get_ref() != null, "the scope holds the scene resource")
	SceneCore.release()
	# the gate never opens, so the transition never resumes
	TestScene.prepare_gate = null
	ResourceCore.release_scope(scope)
	await UnitTestCore.wait_frames(2)
	assert_true(resource.get_ref() == null, "the stopped transition holds the scene resource")


func test_core_node_destroyed_outside_release_cleans_up_without_errors() -> void:
	assert_true(await start_booted(SCENE_A))
	TestScene.prepare_gate = Gate.new()
	var results: PackedInt32Array = PackedInt32Array()
	change_later(SCENE_B, results)
	await wait_trace("prepare:" + SCENE_B)
	var node: Node = SceneCore._node
	node.get_parent().remove_child(node)
	node.free()
	TestScene.prepare_gate = null
	assert_false(SceneCore.is_initialized())
	assert_eq(results, PackedInt32Array([0]))
	assert_eq(scene_blocks(), 0)
	await UnitTestCore.wait_frames(1)
	assert_true(SceneCore.init())
	assert_true(await SceneCore.boot_change_scene(SCENE_A, null))


# Releases SceneCore while the transition waits at `point`, then checks that the transition stopped, the current
# scene, the new scene and the loading screen are destroyed, and that SceneCore works again after `init`.
func _check_release_while_waiting(point: String) -> void:
	_point = point
	_trace_at_release = -1
	_loading_at_release = null
	_scope_at_release = null
	_resource_at_release = null
	assert_true(await start_booted(SCENE_UI))
	var old_scene: TestScene = TestScene.last as TestScene
	var old_ui_root: Control = old_scene.ui_root
	var old_scope: Scope = old_scene.scope
	var target: String = SCENE_B
	# The trace entry after which the test releases. Empty: a deferred call from a hook releases, queued before the
	# transition starts the wait, so that it runs while the transition waits.
	var entry: String = ""
	match point:
		"on_show":
			TestLoading.show_gate = Gate.new()
			entry = "loading_show"
		"destroy":
			TestScene.exit_hook = _release_deferred
		"scene_load":
			ResourceCore.add_scope_release_listener(_on_scope_released)
		"preload":
			TestScene.preload_keys = PackedStringArray([PRELOAD_ITEM])
			TestScene.preload_hook = _release_deferred
		"prefill":
			TestScene.prefill_keys = PackedStringArray([POOL_ITEM])
			TestScene.preload_hook = _release_deferred
		"on_prepare":
			TestScene.prepare_gate = Gate.new()
			entry = "prepare:" + SCENE_B
		"retry_popup":
			TestScene.prepare_results = [false]
			entry = "prepare:" + SCENE_B
		"root_panel":
			TestPanel.prepare_gate = Gate.new()
			target = SCENE_PANEL
			entry = "panel_prepare:Panel"
		"on_start":
			TestScene.start_gate = Gate.new()
			entry = "start:" + SCENE_B
		"min_display":
			set_int("SceneCore.loadingMinDisplayMs", 500)
			SceneCore.release()
			assert_true(SceneCore.init())
			assert_true(await SceneCore.boot_change_scene(SCENE_UI, null))
			old_scene = TestScene.last as TestScene
			old_ui_root = old_scene.ui_root
			entry = "start:" + SCENE_B
		"on_hide":
			TestLoading.hide_gate = Gate.new()
			entry = "loading_hide"
	var results: PackedInt32Array = PackedInt32Array()
	change_later(target, results)
	if entry.is_empty():
		await _wait_released()
	else:
		await wait_trace(entry)
		if point == "retry_popup":
			await wait_popup_layout()
			assert_true(UICore.is_system_popup_visible())
		if point == "min_display":
			await UnitTestCore.wait_frames(2)
		_release_at()
	var new_scene: Node = TestScene.last
	if new_scene == old_scene:
		new_scene = null
	TestLoading.show_gate = null
	TestLoading.hide_gate = null
	TestScene.prepare_gate = null
	TestScene.start_gate = null
	TestScene.exit_hook = Callable()
	TestScene.preload_hook = Callable()
	# the root panel open goes on, and the stopped transition gets its result
	if TestPanel.prepare_gate != null:
		TestPanel.prepare_gate.open()
	TestPanel.prepare_gate = null
	assert_eq(results, PackedInt32Array([0]), point)
	assert_false(SceneCore.is_initialized())
	assert_eq(scene_blocks(), 0, point)
	await advance(1000)
	UICore.close_all_popups()
	await UnitTestCore.wait_frames(2)
	assert_false(is_instance_valid(old_scene), point + ": current scene")
	assert_false(is_instance_valid(old_ui_root), point + ": scene UI root")
	if new_scene != null:
		assert_false(is_instance_valid(new_scene), point + ": new scene")
	assert_false(is_instance_valid(_loading_at_release), point + ": loading screen")
	for i: int in range(_trace_at_release, Trace.entries.size()):
		for stage: String in _LATER_STAGES:
			# the root panel open is UICore's and ends after the release
			if point == "root_panel" and stage == "panel:":
				continue
			assert_false(Trace.entries[i].begins_with(stage), point + ": " + Trace.entries[i])
	_assert_released_state()
	if point == "destroy":
		# the scopes are left to ResourceCore: the stopped transition neither releases the previous one nor makes one
		assert_false(old_scope.released, "the stopped transition released the scope of the previous scene")
		for scope: Scope in ResourceCoreDev.list_scopes():
			assert_ne(scope.name, SCENE_B, "the stopped transition made a scope")
	if point == "preload":
		# the preload wait ended: the stopped transition keeps neither its request nor the scene resource
		assert_true(TestScene.preload_request_ref.get_ref() == null, "the stopped transition holds the preload request")
		ResourceCore.release_scope(_scope_at_release)
		await UnitTestCore.wait_frames(2)
		assert_true(_resource_at_release.get_ref() == null, "the stopped transition holds the scene resource")
	assert_eq(probe.restart_count, 0, point)
	assert_eq(probe.fatal_count, 0, point)
	assert_eq(results, PackedInt32Array([0]), point)
	# the first test item after init again
	TestScene.prepare_results = []
	TestScene.preload_keys = PackedStringArray()
	TestScene.prefill_keys = PackedStringArray()
	set_int("SceneCore.loadingMinDisplayMs", 0)
	assert_true(SceneCore.init())
	assert_true(await SceneCore.boot_change_scene(SCENE_A, null))
	assert_true(await SceneCore.change_scene(SCENE_B, null))
	assert_eq(SceneCore.current_scene_key(), SCENE_B)
	assert_eq(SceneCore.current_scope().name, SCENE_B)
	assert_false(SceneCore.is_transitioning())


func _release_at() -> void:
	_loading_at_release = SceneCore._loading_screen
	var scene: SceneBase = SceneCore._new_scene
	if _point == "preload" and scene != null:
		_scope_at_release = scene.scope
		_resource_at_release = weakref(ResourceCore.get_loaded(SCENE_B, ResourceCore.BaseKind.PACKED_SCENE, scene.scope))
	_trace_at_release = Trace.entries.size()
	SceneCore.release()


# A scene hook: queues the release. The transition goes on to its wait before the deferred call runs.
func _release_deferred(_scene: SceneBase) -> void:
	_release_waiting.call_deferred()


# The scope release listener of the point `scene_load`: the scope of the previous scene is released right before the
# scene load starts.
func _on_scope_released(scope: Scope) -> void:
	if scope.kind != ResourceCore.ScopeKind.SCENE or scope.name != SCENE_UI:
		return
	ResourceCore.remove_scope_release_listener(_on_scope_released)
	_release_waiting.call_deferred()


# Checks that the transition waits at `_point`, then releases.
func _release_waiting() -> void:
	match _point:
		"destroy":
			assert_null(SceneCore._scene, "the transition is in stage 3")
			assert_true(Trace.has("exit:" + SCENE_UI))
			assert_false(Trace.has("destroyed:" + SCENE_UI), "the previous scene is not destroyed yet")
		"scene_load":
			assert_true(Trace.has("destroyed:" + SCENE_UI))
			assert_null(SceneCore._new_scene, "the scene is not made yet")
			assert_false(ResourceCore.is_loaded(SCENE_B, ResourceCore.BaseKind.PACKED_SCENE), "the scene load waits")
		"preload":
			assert_false(ResourceCore.is_loaded(PRELOAD_ITEM, ResourceCore.BaseKind.PACKED_SCENE), "the preload waits")
			assert_not_null(SceneCore._preload_wait)
		"prefill":
			assert_false(ResourceCore.is_loaded(POOL_ITEM, ResourceCore.BaseKind.PACKED_SCENE), "the pool fill waits")
			assert_false(Trace.has("pool_item"))
	_release_at()


# Waits until `_release_at` released, at most 300 frames.
func _wait_released() -> void:
	for _i: int in 300:
		if _trace_at_release >= 0:
			return
		await UnitTestCore.wait_frames(1)
	fail_test("no release at " + _point)


# A stopped transition left the state of the released module as `release` put it.
func _assert_released_state() -> void:
	assert_false(SceneCore._transitioning, _point)
	assert_false(SceneCore._booted, _point)
	assert_null(SceneCore._job, _point)
	assert_null(SceneCore._scene, _point)
	assert_null(SceneCore._new_scene, _point)
	assert_null(SceneCore._scope, _point)
	assert_eq(SceneCore._scene_key, "", _point)
	assert_eq(SceneCore._root_panel, "", _point)
	assert_eq(SceneCore._block_token, 0, _point)
	assert_false(SceneCore._loading_shown, _point)
	assert_false(SceneCore._hiding, _point)
	assert_eq(SceneCore._hidden.size(), 0, _point)
	assert_eq(SceneCore._progress_done, 0, _point)
	assert_eq(SceneCore._progress_total, 0, _point)
	assert_null(SceneCore._preload_wait, _point)
	assert_null(SceneCore._popup_wait, _point)
