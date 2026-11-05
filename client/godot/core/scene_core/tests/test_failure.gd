extends "res://core/scene_core/tests/support/scene_case.gd"
## Unrecoverable failures and the `Transition` channel overlay after a transition.

## The gate that `_open_gate_with_false` opens.
static var _hidden_gate: Gate = null


func test_missing_scene_resource_is_fatal_after_the_block_is_lifted() -> void:
	assert_true(await start_booted(SCENE_A))
	Trace.clear()
	var ok: bool = await SceneCore.change_scene(MISSING, null)
	assert_false(ok)
	UnitTestCore.check_logs(ERROR, "ResourceCore")
	await _assert_fatal_stop()


func test_scene_root_that_is_not_scene_base_is_fatal_after_the_block_is_lifted() -> void:
	assert_true(await start_booted(SCENE_A))
	Trace.clear()
	var ok: bool = await SceneCore.change_scene(NOT_SCENE, null)
	assert_false(ok)
	await _assert_fatal_stop()


## A root of another engine class is not the scene base type, also when its script extends `SceneBase`.
func test_scene_root_of_another_engine_class_with_the_scene_base_script_is_fatal() -> void:
	assert_true(await start_booted(SCENE_A))
	Trace.clear()
	var ok: bool = await SceneCore.change_scene(NODE2D_ROOT, null)
	assert_false(ok)
	assert_eq(SceneCore.current_scene_key(), "")
	await _assert_fatal_stop()


## `InputBlockCore` is released, so `block` gives the invalid token 0.
func test_transition_block_that_cannot_be_set_in_stage_1_is_fatal() -> void:
	assert_true(await start_booted(SCENE_A))
	Trace.clear()
	InputBlockCore.release()
	var ok: bool = await SceneCore.change_scene(SCENE_B, null)
	assert_false(ok)
	assert_gt(errors("InputBlockCore"), 0)
	assert_eq(errors(TAG), 1)
	assert_eq(probe.fatal_count, 1)
	assert_true(SceneCore.is_transitioning())
	assert_false(Trace.has("exit:" + SCENE_A))
	assert_false(Trace.has("loaded:" + SCENE_B))
	assert_true(InputBlockCore.init())


## `InputBlockCore` is released while the retry popup is open, so `block` of the retry gives the invalid token 0.
func test_transition_block_that_cannot_be_set_again_at_the_retry_is_fatal() -> void:
	assert_true(await start_booted(SCENE_A))
	TestScene.prepare_results = [false]
	var results: PackedInt32Array = PackedInt32Array()
	change_later(SCENE_B, results)
	await wait_trace("prepare:" + SCENE_B)
	await wait_popup_layout()
	assert_true(UICore.is_system_popup_visible())
	assert_eq(retry_popup_label(), ReservedString.scene_retry())
	InputBlockCore.release()
	# what the `[scene_retry]` button calls after the popup closes
	SceneCore._popup_param.buttons[0].callback.call()
	await wait_trace("fatal")
	assert_eq(results, PackedInt32Array([0]))
	assert_gt(errors("InputBlockCore"), 0)
	assert_eq(errors(TAG), 1)
	assert_eq(probe.fatal_count, 1)
	assert_eq(probe.restart_count, 0)
	assert_true(SceneCore.is_transitioning())
	assert_eq(Trace.count("prepare:" + SCENE_B), 1)
	assert_false(Trace.has("start:" + SCENE_B))
	assert_true(InputBlockCore.init())


## The retry popup opens while `close_all_popups` closes the popups: `on_prepare` returns `false` in the hidden callback
## of a popup that `close_all_popups` closes, and `UICore.open_system_popup` gives `false` then.
func test_retry_popup_that_cannot_be_opened_is_fatal() -> void:
	assert_true(await start_booted(SCENE_A))
	TestScene.prepare_gate = Gate.new()
	var results: PackedInt32Array = PackedInt32Array()
	change_later(SCENE_B, results)
	await wait_trace("prepare:" + SCENE_B)
	var button: SystemPopupButton = SystemPopupButton.new()
	button.label = ReservedString.scene_retry()
	var param: SystemPopupParam = SystemPopupParam.new()
	param.body = ReservedString.scene_prepare_failed()
	param.buttons = [button]
	_hidden_gate = TestScene.prepare_gate
	assert_true(await UICore.open_system_popup(param, _open_gate_with_false))
	UICore.close_all_popups()
	await wait_trace("fatal")
	assert_eq(results, PackedInt32Array([0]))
	assert_eq(warns("UICore"), 1)
	assert_eq(errors(TAG), 1)
	assert_eq(probe.fatal_count, 1)
	assert_eq(probe.fatal_scene_blocks, 0)
	assert_eq(probe.restart_count, 0)
	assert_true(SceneCore.is_transitioning())
	assert_eq(SceneCore._popup_wait, null)
	assert_false(UICore.is_system_popup_visible())
	assert_false(Trace.has("start:" + SCENE_B))


func test_overlay_is_clear_after_success_failure_and_stop() -> void:
	assert_true(await start_booted(SCENE_A))
	TestLoading.fade_on_show = true
	assert_true(await SceneCore.change_scene(SCENE_B, null))
	assert_eq(transition_opacity(), 0.0, "after success")
	# stop: release while waiting in stage 6
	TestScene.prepare_gate = Gate.new()
	var results: PackedInt32Array = PackedInt32Array()
	change_later(SCENE_A, results)
	await wait_trace("prepare:" + SCENE_A)
	assert_eq(transition_opacity(), 1.0, "the loading screen faded the overlay")
	SceneCore.release()
	TestScene.prepare_gate = null
	assert_eq(results, PackedInt32Array([0]))
	assert_eq(transition_opacity(), 0.0, "after stop")
	# failure
	assert_true(SceneCore.init())
	assert_true(await SceneCore.boot_change_scene(SCENE_A, null))
	var failed: bool = await SceneCore.change_scene(NOT_SCENE, null)
	assert_false(failed)
	assert_eq(errors(TAG), 1)
	assert_eq(transition_opacity(), 0.0, "after failure")


# The checks of an unrecoverable failure in stage 4.
func _assert_fatal_stop() -> void:
	assert_eq(errors(TAG), 1)
	assert_eq(probe.fatal_count, 1)
	assert_eq(probe.fatal_scene_blocks, 0, "block lifted before FatalErrorRequestedEvent")
	assert_eq(scene_blocks(), 0)
	assert_gt(Trace.entries.size(), 0)
	if Trace.entries.size() > 0:
		assert_eq(Trace.entries[Trace.entries.size() - 1], "fatal")
	assert_false(Trace.has("loading_hide"))
	for entry: String in Trace.entries:
		assert_false(entry.begins_with("preload:"), entry)
		assert_false(entry.begins_with("prepare:"), entry)
		assert_false(entry.begins_with("start:"), entry)
		assert_false(entry.begins_with("started:"), entry)
	assert_true(SceneCore.is_transitioning())
	var again: bool = await SceneCore.change_scene(SCENE_B, null)
	assert_false(again)
	assert_eq(warns(TAG), 1)
	assert_false(Trace.has("loaded:" + SCENE_B))


# The hidden callback of the popup of `test_retry_popup_that_cannot_be_opened_is_fatal`.
static func _open_gate_with_false() -> void:
	_hidden_gate.open(false)
