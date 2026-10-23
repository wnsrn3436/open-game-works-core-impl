extends "res://core/scene_core/tests/support/scene_case.gd"
## The retry popup of a failed `on_prepare`.

## Active blocks with reason tag `scene` at each `on_prepare` call.
var _scene_blocks_at_prepare: PackedInt32Array = PackedInt32Array()


func test_prepare_failure_opens_retry_popup_without_block_and_retry_prepares_again() -> void:
	assert_true(await start_booted(SCENE_A))
	TestScene.prepare_results = [false]
	TestScene.prepare_hook = _record_blocks
	var results: PackedInt32Array = PackedInt32Array()
	change_later(SCENE_B, results)
	await wait_trace("prepare:" + SCENE_B)
	await wait_popup_layout()
	assert_true(UICore.is_system_popup_visible())
	assert_eq(scene_blocks(), 0)
	assert_eq(retry_popup_label(), ReservedString.scene_retry())
	assert_true(await tap_system_popup_button())
	await wait_trace("started:" + SCENE_B)
	assert_eq(Trace.count("prepare:" + SCENE_B), 2)
	assert_eq(_scene_blocks_at_prepare, PackedInt32Array([1, 1]))
	assert_eq(results, PackedInt32Array([1]))
	assert_eq(probe.restart_count, 0)


## A test screen whose window size is not the headless window's: the tap on the popup button still reaches it.
func test_retry_popup_button_tap_under_a_test_screen_prepares_again() -> void:
	assert_true(await start_booted(SCENE_A))
	await set_notch_screen()
	TestScene.prepare_results = [false]
	var results: PackedInt32Array = PackedInt32Array()
	change_later(SCENE_B, results)
	await wait_trace("prepare:" + SCENE_B)
	await wait_popup_layout()
	assert_true(UICore.is_system_popup_visible())
	assert_true(await tap_system_popup_button())
	await wait_trace("started:" + SCENE_B)
	assert_eq(Trace.count("prepare:" + SCENE_B), 2)
	assert_eq(results, PackedInt32Array([1]))
	assert_false(UICore.is_system_popup_visible())


func test_prepare_failing_every_retry_opens_restart_popup_and_restart_requests_restart_once() -> void:
	assert_true(await start_booted(SCENE_A))
	var failures: Array[bool] = []
	for i: int in RETRY_COUNT + 1:
		failures.append(false)
	TestScene.prepare_results = failures
	var results: PackedInt32Array = PackedInt32Array()
	change_later(SCENE_B, results)
	for i: int in RETRY_COUNT:
		await wait_trace_count("prepare:" + SCENE_B, i + 1)
		await wait_popup_layout()
		assert_eq(retry_popup_label(), ReservedString.scene_retry())
		assert_true(await tap_system_popup_button())
	await wait_trace_count("prepare:" + SCENE_B, RETRY_COUNT + 1)
	await wait_popup_layout()
	assert_true(UICore.is_system_popup_visible())
	assert_eq(retry_popup_label(), ReservedString.scene_restart())
	assert_true(await tap_system_popup_button())
	await wait_trace("restart")
	await UnitTestCore.wait_frames(2)
	assert_eq(probe.restart_count, 1)
	assert_eq(results, PackedInt32Array([0]))
	assert_true(SceneCore.is_transitioning())
	assert_eq(Trace.count("prepare:" + SCENE_B), RETRY_COUNT + 1)


func test_retry_popup_closed_without_button_requests_restart_once() -> void:
	assert_true(await start_booted(SCENE_A))
	TestScene.prepare_results = [false]
	var results: PackedInt32Array = PackedInt32Array()
	change_later(SCENE_B, results)
	await wait_trace("prepare:" + SCENE_B)
	await wait_popup_layout()
	assert_true(UICore.is_system_popup_visible())
	UICore.close_all_popups()
	await wait_trace("restart")
	await UnitTestCore.wait_frames(2)
	assert_eq(probe.restart_count, 1)
	assert_eq(results, PackedInt32Array([0]))
	assert_true(SceneCore.is_transitioning())
	assert_eq(Trace.count("prepare:" + SCENE_B), 1)


func test_retry_popup_does_not_close_on_back_input() -> void:
	assert_true(await start_booted(SCENE_A))
	TestScene.prepare_results = [false]
	var results: PackedInt32Array = PackedInt32Array()
	change_later(SCENE_B, results)
	await wait_trace("prepare:" + SCENE_B)
	await wait_popup_layout()
	assert_true(UICore.is_system_popup_visible())
	_press_back()
	await UnitTestCore.wait_frames(3)
	assert_true(UICore.is_system_popup_visible())
	assert_eq(probe.restart_count, 0)
	assert_eq(Trace.count("prepare:" + SCENE_B), 1)
	assert_true(results.is_empty())
	assert_true(await tap_system_popup_button())
	await wait_trace("started:" + SCENE_B)


func _record_blocks(_scene: Node) -> void:
	_scene_blocks_at_prepare.append(scene_blocks())


## Back input: the default key of action `back`.
func _press_back() -> void:
	var press: InputEventKey = InputEventKey.new()
	press.keycode = KEY_ESCAPE
	press.pressed = true
	InputCoreDev.inject_device_input(press)
	var lift: InputEventKey = InputEventKey.new()
	lift.keycode = KEY_ESCAPE
	lift.pressed = false
	InputCoreDev.inject_device_input(lift)
