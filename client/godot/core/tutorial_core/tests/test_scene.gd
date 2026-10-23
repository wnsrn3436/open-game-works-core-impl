extends "res://core/tutorial_core/tests/support/tutorial_test_case.gd"
## Scene transitions: `SceneEndedEvent` stops the step progress, `SceneStartedEvent` goes on with it.

var _at_scene_end: PackedStringArray = PackedStringArray()


func _on_scene_ended(_event: SceneEndedEvent) -> void:
	_at_scene_end = PackedStringArray([
		"block:%s" % has_block(), "view:%s" % view_visible(), "shown:%s" % shown_text(),
	])


func test_a_scene_change_stops_the_step_and_the_next_scene_shows_it_again() -> void:
	assert_true(await start())
	assert_true(await SceneCore.boot_change_scene(SCENE_A, null))
	add_anchor("tc_anchor", Rect2(560, 300, 160, 60))
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_anchor]", "[tutorial_panel]"])))
	assert_true(await wait_shown())
	assert_true(has_block())
	assert_true(EventCore.subscribe(SceneEndedEvent, _on_scene_ended))
	TestScene.hold_prepare = true
	var results: PackedInt32Array = PackedInt32Array()
	_change_later(SCENE_B, results)
	while _at_scene_end.is_empty() and SceneCore.is_initialized():
		await frames()
	assert_eq(_at_scene_end, PackedStringArray(["block:false", "view:false", "shown:none"]))
	await frames(3)
	assert_true(UICore.get_anchor_rect("tc_anchor").visible, "the anchor is visible during the transition")
	assert_false(view_visible())
	assert_false(has_block())
	assert_eq(TutorialCore._runs.size(), 2)
	for run: TutorialCore._RUN in TutorialCore._runs:
		assert_eq(run.stage, TutorialCore._RUN.Stage.STOPPED)
	TestScene.open_prepare()
	while results.is_empty() and SceneCore.is_initialized():
		await frames()
	assert_eq(results, PackedInt32Array([1]))
	assert_true(await wait_shown())
	assert_true(has_block())
	assert_eq(current_text(), "[tutorial_anchor]:1")


func _change_later(scene_key: String, results: PackedInt32Array) -> void:
	var ok: bool = await SceneCore.change_scene(scene_key, null)
	results.append(1 if ok else 0)
