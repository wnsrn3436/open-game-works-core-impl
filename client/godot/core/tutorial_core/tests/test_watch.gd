extends "res://core/tutorial_core/tests/support/tutorial_test_case.gd"
## Requirement watch and start watch: `RequirementCore` keeps a watch of TutorialCore only while it is needed.


func test_the_requirement_watch_is_taken_off_when_the_requirement_step_ends() -> void:
	assert_true(await start())
	add_anchor("tc_anchor", Rect2(560, 300, 160, 60))
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_cue]"])))
	assert_true(TutorialCore.notify_cue(GameData.TutorialCue.OPENED))
	assert_eq(current_text(), "[tutorial_cue]:2")
	var requirement_id: int = _step_requirement()
	assert_true(_step_watched(requirement_id))
	Hooks.flag_a = true
	await touch_user_state()
	assert_eq(current_text(), "[tutorial_cue]:3")
	assert_false(_step_watched(requirement_id))


func test_the_requirement_watch_is_taken_off_while_the_step_progress_is_stopped() -> void:
	assert_true(await start())
	assert_true(await SceneCore.boot_change_scene(SCENE_A, null))
	add_anchor("tc_anchor", Rect2(560, 300, 160, 60))
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_cue]"])))
	assert_true(TutorialCore.notify_cue(GameData.TutorialCue.OPENED))
	var requirement_id: int = _step_requirement()
	assert_true(_step_watched(requirement_id))
	TestScene.hold_prepare = true
	var results: PackedInt32Array = PackedInt32Array()
	_change_later(SCENE_B, results)
	while TutorialCore._runs[0].stage != TutorialCore._RUN.Stage.STOPPED and SceneCore.is_initialized():
		await frames()
	assert_false(_step_watched(requirement_id))
	TestScene.open_prepare()
	while results.is_empty() and SceneCore.is_initialized():
		await frames()
	assert_eq(results, PackedInt32Array([1]))
	assert_true(_step_watched(requirement_id))
	assert_eq(current_text(), "[tutorial_cue]:2")


func test_the_requirement_watch_is_taken_off_by_skip() -> void:
	assert_true(await start())
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_time_step]"])))
	assert_true(await wait_shown())
	var requirement_id: int = _step_requirement()
	assert_true(_step_watched(requirement_id))
	respond_saved(id_of("[tutorial_time_step]"), 1)
	assert_true(TutorialCore.skip())
	assert_eq(events, PackedStringArray(["started:[tutorial_time_step]:1", "completed:[tutorial_time_step]:true"]))
	assert_false(_step_watched(requirement_id))


func test_the_start_watch_is_taken_off_when_every_tutorial_with_its_start_requirement_is_finished() -> void:
	assert_true(await start())
	Hooks.flag_a = true
	# The judge result is cached until a UserState kind the judge reads changes.
	await touch_user_state()
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_gated]"])))
	assert_eq(events, PackedStringArray(["started:[tutorial_gated]:1"]))
	var gated: int = _start_requirement("[tutorial_gated]")
	var time_start: int = _start_requirement("[tutorial_time_start]")
	assert_true(_start_watched(gated))
	assert_true(_start_watched(time_start))
	assert_true(await wait_shown())
	respond_saved(id_of("[tutorial_gated]"), 1)
	await click(view().advance_button)
	assert_eq(events, PackedStringArray(["started:[tutorial_gated]:1", "completed:[tutorial_gated]:false"]))
	assert_false(_start_watched(gated))
	assert_true(_start_watched(time_start), "a tutorial with this start requirement is not finished")


## `complete_requirement` of the current step of the only active tutorial.
func _step_requirement() -> int:
	assert_eq(TutorialCore._runs.size(), 1)
	var requirement_id: int = TutorialCore._runs[0].current().complete_requirement
	assert_ne(requirement_id, 0)
	return requirement_id


func _start_requirement(id_name: String) -> int:
	var requirement_id: int = TutorialCore._defs_by_id[id_of(id_name)].start_requirement
	assert_ne(requirement_id, 0)
	return requirement_id


func _step_watched(requirement_id: int) -> bool:
	return _watched(requirement_id, TutorialCore._node.step_requirement_call)


func _start_watched(requirement_id: int) -> bool:
	return _watched(requirement_id, TutorialCore._node.start_requirement_call)


## Whether `RequirementCore` keeps a watch of `requirement_id` with `callback`: `watch` refuses a second watch of the
## same pair with an error log. A watch the probe takes is taken off again at once.
func _watched(requirement_id: int, callback: Callable) -> bool:
	var trigger: RequirementTrigger = RequirementTrigger.new()
	trigger.kind = RequirementCore.TriggerKind.USER_STATE_CHANGED
	var triggers: Array[RequirementTrigger] = [trigger]
	if RequirementCore.watch(requirement_id, triggers, callback):
		RequirementCore.unwatch(requirement_id, callback)
		return false
	assert_eq(UnitTestCore.check_logs("error", "RequirementCore"), 1, "watch refuses a second watch of the pair")
	return true


func _change_later(scene_key: String, results: PackedInt32Array) -> void:
	var ok: bool = await SceneCore.change_scene(scene_key, null)
	results.append(1 if ok else 0)
