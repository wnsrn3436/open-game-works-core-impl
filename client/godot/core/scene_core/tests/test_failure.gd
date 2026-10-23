extends "res://core/scene_core/tests/support/scene_case.gd"
## Unrecoverable failures and the `Transition` channel overlay after a transition.


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
