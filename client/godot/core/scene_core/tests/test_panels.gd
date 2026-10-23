extends "res://core/scene_core/tests/support/scene_case.gd"
## The panel lock and the root panel.

var _start_open_result: int = -1
var _stack_size_at_start: int = -1
var _stack_bottom_at_start: String = ""
var _root_panel_at_start: String = "-"


func test_panel_open_is_refused_until_the_panel_lock_is_off_and_works_in_on_start() -> void:
	assert_true(await start_booted(SCENE_A))
	TestScene.prepare_gate = Gate.new()
	TestScene.start_hook = _open_panel_in_start
	var results: PackedInt32Array = PackedInt32Array()
	change_later(SCENE_B, results)
	await wait_trace("prepare:" + SCENE_B)
	var early: bool = await UICore.open_panel(OTHER_PANEL, null, false)
	assert_false(early)
	assert_eq(warns("UICore"), 1)
	assert_false(Trace.has("panel:OtherPanel"))
	TestScene.prepare_gate.open(true)
	await wait_trace("panel:OtherPanel")
	await wait_trace("started:" + SCENE_B)
	# The panel open that `on_start` began ends after its open flow.
	while _start_open_result == -1 and SceneCore.is_initialized():
		await UnitTestCore.wait_frames(1)
	assert_eq(_start_open_result, 1)
	assert_eq(UICore.get_current_panel_key(), OTHER_PANEL)


func test_on_start_sees_the_root_panel_as_the_only_stack_entry() -> void:
	assert_true(await start_booted(SCENE_A))
	TestScene.start_hook = _record_stack
	assert_true(await SceneCore.change_scene(SCENE_PANEL, null))
	assert_eq(_stack_size_at_start, 1)
	assert_eq(_stack_bottom_at_start, PANEL)
	assert_eq(_root_panel_at_start, PANEL)
	assert_eq(SceneCore.current_root_panel_key(), PANEL)
	assert_true(await SceneCore.change_scene(SCENE_B, null))
	assert_eq(_stack_size_at_start, 0)
	assert_eq(_root_panel_at_start, "")
	assert_eq(SceneCore.current_root_panel_key(), "")


func test_root_panel_prepare_failure_is_fatal_without_on_start() -> void:
	assert_true(await start_booted(SCENE_A))
	var ok: bool = await SceneCore.change_scene(SCENE_FAIL_PANEL, null)
	assert_false(ok)
	assert_false(Trace.has("start:" + SCENE_FAIL_PANEL))
	assert_eq(probe.fatal_count, 1)
	assert_eq(errors(TAG), 1)
	UnitTestCore.check_logs(ERROR, "UICore")
	assert_true(SceneCore.is_transitioning())


func _open_panel_in_start(_scene: Node) -> void:
	var ok: bool = await UICore.open_panel(OTHER_PANEL, null, false)
	_start_open_result = 1 if ok else 0


func _record_stack(_scene: Node) -> void:
	var stack: PackedStringArray = PackedStringArray(UICore.get_panel_stack())
	_stack_size_at_start = stack.size()
	_stack_bottom_at_start = stack[0] if stack.size() > 0 else ""
	_root_panel_at_start = SceneCore.current_root_panel_key()
