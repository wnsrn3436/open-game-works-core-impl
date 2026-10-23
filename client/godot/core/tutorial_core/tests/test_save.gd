extends "res://core/tutorial_core/tests/support/tutorial_test_case.gd"
## Saving the progress step: when `SaveTutorialProgress` goes, failures, the resend and the resume.


func test_a_save_step_sends_its_step_once_and_other_steps_before_the_last_do_not() -> void:
	assert_true(await start())
	var first: int = id_of("[tutorial_first]")
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_first]"])))
	assert_true(await wait_shown())
	await click(view().advance_button)
	assert_eq(saves(), PackedStringArray())
	respond_saved(first, 2)
	assert_true(await wait_shown())
	await click(view().advance_button)
	await frames(2)
	assert_eq(saves(), PackedStringArray(["[tutorial_first]:2"]))


func test_the_last_step_sends_the_last_step_then_completes_and_the_next_candidate_starts() -> void:
	assert_true(await start())
	var first: int = id_of("[tutorial_first]")
	respond_saved(first, 2)
	respond_saved(first, 3)
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_first]"])))
	for i: int in 3:
		assert_true(await wait_shown())
		if i == 2:
			# The start checks of the earlier saves' UserState deltas may come while the first tutorial is `Paused`;
			# the second tutorial becomes a candidate only for the start check of the tutorial end.
			allow(PackedStringArray(["[tutorial_first]", "[tutorial_second]"]))
		await click(view().advance_button)
	await frames(2)
	assert_eq(saves(), PackedStringArray(["[tutorial_first]:2", "[tutorial_first]:3"]))
	assert_eq(events, PackedStringArray([
		"started:[tutorial_first]:1", "started:[tutorial_first]:2", "started:[tutorial_first]:3",
		"completed:[tutorial_first]:false", "started:[tutorial_second]:1",
	]))


func test_a_failed_save_goes_on_and_the_next_save_sends_a_larger_step() -> void:
	assert_true(await start())
	var second: int = id_of("[tutorial_second]")
	respond_save_error()
	respond_saved(second, 1)
	respond_saved(second, 2)
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_second]"])))
	assert_true(await wait_shown())
	await click(view().advance_button)
	assert_eq(current_text(), "[tutorial_second]:2")
	assert_true(await wait_shown())
	await click(view().advance_button)
	await frames(2)
	# The start check of the move to step 2 sends step 1 again after the failure response.
	assert_eq(saves(), PackedStringArray(["[tutorial_second]:1", "[tutorial_second]:1", "[tutorial_second]:2"]))
	assert_false(UICore.is_system_popup_visible(), "no screen for the failure")


func test_a_failed_last_save_is_sent_again_once_by_the_scene_start() -> void:
	assert_true(await start())
	var second: int = id_of("[tutorial_second]")
	assert_true(await SceneCore.boot_change_scene(SCENE_A, null))
	respond_saved(second, 1)
	respond_save_error()
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_second]"])))
	for i: int in 2:
		assert_true(await wait_shown())
		await click(view().advance_button)
	await frames(2)
	assert_eq(saves(), PackedStringArray(["[tutorial_second]:1", "[tutorial_second]:2"]))
	UnitTestCore.add_pending(SAVE)
	assert_true(await SceneCore.change_scene(SCENE_B, null))
	await frames(2)
	assert_eq(saves(), PackedStringArray(["[tutorial_second]:1", "[tutorial_second]:2", "[tutorial_second]:2"]))
	assert_false(TutorialCore.check_start())
	await frames(2)
	assert_eq(saves().size(), 3, "no resend while the response is awaited")
	var envelope: CoreContract.ResponseEnvelope = CoreContract.ResponseEnvelope.new()
	envelope.server_time_at = SERVER_TIME
	envelope.user_state = progress_delta(second, 2)
	envelope.body = CoreContract.SaveTutorialProgressResponse.new().encode()
	assert_true(UnitTestCore.release_pending(SAVE, NetworkCore.TransferResult.DONE, 200, UnitTestCore.make_response(envelope)))
	await frames(2)
	assert_false(TutorialCore.check_start())
	await frames(2)
	assert_eq(saves().size(), 3, "no resend after the stored step")
	assert_true(TutorialCore.is_completed(second))


func test_a_save_in_flight_puts_no_network_block_and_the_next_anchor_tap_reaches_the_anchor() -> void:
	assert_true(await start())
	var anchor: Button = add_anchor("tc_anchor", Rect2(560, 300, 160, 60))
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_anchor]"])))
	assert_true(await wait_shown())
	UnitTestCore.add_pending(SAVE)
	await click(anchor)
	assert_eq(saves(), PackedStringArray(["[tutorial_anchor]:1"]))
	assert_eq(current_text(), "[tutorial_anchor]:2")
	assert_true(await wait_shown())
	var blocks: Array[ActiveBlockInfo] = []
	blocks.resize(32)
	var count: int = InputBlockCoreDev.list_active(blocks)
	for i: int in count:
		assert_ne(blocks[i].reason, "network")
	clicks = PackedStringArray()
	await click(anchor)
	assert_eq(clicks, PackedStringArray(["tc_anchor"]))
	assert_true(UnitTestCore.release_pending(SAVE, NetworkCore.TransferResult.DONE, 200, _saved_bytes(id_of("[tutorial_anchor]"), 1)))
	await frames(2)


func test_a_progress_step_from_a_response_delta_resumes_after_release_and_init() -> void:
	assert_true(await start())
	var first: int = id_of("[tutorial_first]")
	respond_saved(first, 2)
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_first]"])))
	for i: int in 2:
		assert_true(await wait_shown())
		await click(view().advance_button)
	await frames(2)
	TutorialCore.release()
	assert_true(TutorialCore.init())
	assert_true(TutorialCore.register_can_start_tutorial(_can_start))
	events = PackedStringArray()
	assert_true(TutorialCore.check_start())
	assert_eq(events, PackedStringArray(["started:[tutorial_first]:3"]))


func test_a_step_not_above_the_stored_progress_is_not_sent() -> void:
	assert_true(await start())
	var first: int = id_of("[tutorial_first]")
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_first]"])))
	assert_true(await wait_shown())
	put_progress(first, 2)
	await click(view().advance_button)
	assert_true(await wait_shown())
	await click(view().advance_button)
	await frames(2)
	assert_eq(current_text(), "[tutorial_first]:3")
	assert_eq(saves(), PackedStringArray())


func test_a_skip_whose_save_failed_stays_completed() -> void:
	assert_true(await start())
	var second: int = id_of("[tutorial_second]")
	assert_true(await SceneCore.boot_change_scene(SCENE_A, null))
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_second]"])))
	assert_true(await wait_shown())
	respond_save_error()
	assert_true(TutorialCore.skip())
	await frames(2)
	assert_eq(saves(), PackedStringArray(["[tutorial_second]:2"]))
	assert_true(TutorialCore.is_completed(second))
	# The scene start and `check_start` send the skipped step again; those fail too.
	respond_save_error()
	assert_true(await SceneCore.change_scene(SCENE_B, null))
	await frames(2)
	respond_save_error()
	assert_false(TutorialCore.check_start())
	await frames(2)
	assert_eq(events, PackedStringArray(["started:[tutorial_second]:1", "completed:[tutorial_second]:true"]))


func _saved_bytes(tutorial_id: int, step: int) -> PackedByteArray:
	var envelope: CoreContract.ResponseEnvelope = CoreContract.ResponseEnvelope.new()
	envelope.server_time_at = SERVER_TIME
	envelope.user_state = progress_delta(tutorial_id, step)
	envelope.body = CoreContract.SaveTutorialProgressResponse.new().encode()
	return UnitTestCore.make_response(envelope)
