extends "res://core/tutorial_core/tests/support/tutorial_test_case.gd"
## Start check: candidates, the start step, the conditions that stop it, login and the owner hook.


func test_the_candidate_with_the_smaller_order_starts_with_its_first_step() -> void:
	assert_true(await start())
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_second]", "[tutorial_first]"])))
	assert_eq(events, PackedStringArray(["started:[tutorial_first]:1"]))
	assert_true(TutorialCore.is_running())
	assert_eq(current_text(), "[tutorial_first]:1")


func test_failed_start_requirement_or_hook_false_does_not_start() -> void:
	assert_true(await start())
	allow(PackedStringArray(["[tutorial_gated]"]))
	assert_false(TutorialCore.check_start())
	assert_eq(events, PackedStringArray())
	allow(PackedStringArray())
	hook_calls = PackedInt64Array()
	assert_false(TutorialCore.check_start())
	assert_true(hook_calls.has(id_of("[tutorial_first]")), "the hook was asked")
	assert_eq(events, PackedStringArray())
	Hooks.flag_a = true
	# The judge result is cached until a UserState kind the judge reads changes.
	await touch_user_state()
	assert_eq(events, PackedStringArray())
	allow(PackedStringArray(["[tutorial_gated]"]))
	assert_true(TutorialCore.check_start())
	assert_eq(events, PackedStringArray(["started:[tutorial_gated]:1"]))


func test_a_throwing_hook_does_not_start_with_an_error_log_and_the_next_check_calls_it_again() -> void:
	assert_true(await start())
	var first: int = id_of("[tutorial_first]")
	allow(PackedStringArray(["[tutorial_first]"]))
	throwing = {first: true}
	hook_calls = PackedInt64Array()
	assert_false(TutorialCore.check_start())
	assert_eq(UnitTestCore.check_script_errors(), 1, "the hook threw")
	assert_eq(UnitTestCore.check_logs("error", "TutorialCore"), 1)
	assert_eq(events, PackedStringArray())
	throwing = {}
	assert_true(TutorialCore.check_start())
	assert_eq(hook_calls.count(first), 2, "the next start check called the hook again")
	assert_eq(events, PackedStringArray(["started:[tutorial_first]:1"]))


func test_progress_step_k_starts_from_the_next_step_and_the_last_step_is_completed() -> void:
	assert_true(await start())
	put_progress(id_of("[tutorial_first]"), 1)
	put_progress(id_of("[tutorial_second]"), 2)
	assert_false(TutorialCore.is_completed(id_of("[tutorial_first]")))
	assert_true(TutorialCore.is_completed(id_of("[tutorial_second]")))
	allow(PackedStringArray(["[tutorial_second]"]))
	assert_false(TutorialCore.check_start())
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_first]", "[tutorial_second]"])))
	assert_eq(events, PackedStringArray(["started:[tutorial_first]:2"]))


func test_check_start_is_false_during_a_scene_transition_and_with_a_shown_tutorial() -> void:
	assert_true(await start())
	assert_true(await SceneCore.boot_change_scene(SCENE_A, null))
	var results: PackedInt32Array = PackedInt32Array()
	_change_later(SCENE_B, results)
	assert_true(SceneCore.is_transitioning())
	allow(PackedStringArray(["[tutorial_first]"]))
	assert_false(TutorialCore.check_start())
	allow(PackedStringArray())
	while results.is_empty() and SceneCore.is_initialized():
		await frames()
	assert_eq(events, PackedStringArray())
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_first]"])))
	assert_true(await wait_shown())
	assert_eq(shown_text(), "[tutorial_first]")
	allow(PackedStringArray(["[tutorial_first]", "[tutorial_second]"]))
	assert_false(TutorialCore.check_start())
	assert_eq(events, PackedStringArray(["started:[tutorial_first]:1"]))


func test_scene_start_and_check_start_before_login_do_not_start() -> void:
	assert_true(await start(false))
	allow(PackedStringArray(["[tutorial_first]"]))
	assert_false(TutorialCore.check_start())
	assert_true(await SceneCore.boot_change_scene(SCENE_A, null))
	await frames(2)
	assert_eq(events, PackedStringArray())
	# The UserState delta of the login raises a start check, which starts the tutorial.
	assert_true(await log_in())
	assert_eq(events, PackedStringArray(["started:[tutorial_first]:1"]))


func test_a_scene_object_hook_is_called_while_it_lives_and_the_default_follows_its_destruction() -> void:
	assert_true(await start(false, false))
	TestScene.register_hook = true
	assert_true(await SceneCore.boot_change_scene(SCENE_A, null))
	assert_true(await log_in())
	var calls: int = TestScene.hook_calls
	assert_gt(calls, 0, "the scene hook was called by the start check of the login")
	assert_false(TutorialCore.check_start())
	assert_gt(TestScene.hook_calls, calls)
	assert_eq(events, PackedStringArray())
	TestScene.register_hook = false
	calls = TestScene.hook_calls
	assert_true(await SceneCore.change_scene(SCENE_B, null))
	await frames(2)
	assert_eq(TestScene.hook_calls, calls)
	assert_eq(events, PackedStringArray(["started:[tutorial_first]:1"]))


func test_is_completed_of_a_tutorial_not_in_the_table_is_false_with_an_error() -> void:
	assert_true(await start())
	assert_false(TutorialCore.is_completed(987654321))
	assert_eq(errors(), 1)


func _change_later(scene_key: String, results: PackedInt32Array) -> void:
	var ok: bool = await SceneCore.change_scene(scene_key, null)
	results.append(1 if ok else 0)


func test_the_shown_tutorial_moving_to_its_next_step_runs_a_start_check() -> void:
	assert_true(await start())
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_popup]"])))
	assert_true(await wait_shown())
	# The hook allows the next candidate only now, so no trigger but the start check of the step move can start it.
	allowed[id_of("[tutorial_prompt]")] = true
	await click(view().advance_button)
	assert_eq(events, PackedStringArray([
		"started:[tutorial_popup]:1", "started:[tutorial_popup]:2", "started:[tutorial_prompt]:1",
	]))
	assert_true(await wait_shown())
	assert_eq(shown_text(), "[tutorial_prompt]")
