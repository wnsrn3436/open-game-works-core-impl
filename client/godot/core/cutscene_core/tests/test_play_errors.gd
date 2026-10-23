extends "res://core/cutscene_core/tests/support/cutscene_test_case.gd"
## Failures of `play` and `register_actor`, the state after a failed `play`, and resources that do not load.


func assert_not_started() -> void:
	assert_false(CutsceneCore.is_playing())
	assert_false(root().visible, "the cutscene root is hidden")
	assert_eq(root().get_child_count(), 0, "no cutscene view")
	assert_false(block_reasons().has("cutscene"), "no cutscene block")
	assert_true(UICore.get_block_pass_list() != null)


func test_play_during_a_playback_fails_and_the_playback_goes_on() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_line]")
	assert_true(line_running())
	var result: CutsceneResult = await CutsceneCore.play(id("[cut_plain]"), scope)
	assert_eq(result.status, CutsceneCore.CutsceneStatus.FAILED)
	assert_eq(result.choices.size(), 0)
	assert_eq(errors(), 1)
	assert_true(CutsceneCore.is_playing())
	assert_eq(CutsceneCore._cutscene_id, id("[cut_line]"))
	assert_true(line_running())
	assert_eq(text_label().text, "Hello")
	await press_advance()
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)


func test_play_of_a_cutscene_without_steps_fails() -> void:
	assert_true(await start())
	var result: CutsceneResult = await CutsceneCore.play(987654321, scope)
	assert_eq(result.status, CutsceneCore.CutsceneStatus.FAILED)
	assert_eq(result.choices.size(), 0)
	assert_eq(errors(), 1)
	assert_not_started()


func test_play_without_a_scope_fails() -> void:
	assert_true(await start())
	var result: CutsceneResult = await CutsceneCore.play(id("[cut_line]"), null)
	assert_eq(result.status, CutsceneCore.CutsceneStatus.FAILED)
	assert_eq(errors(), 1)
	assert_not_started()


func test_a_view_whose_advance_button_has_an_action_fails_the_view_check() -> void:
	set_setting("cutsceneView", VIEW_ACTION)
	assert_true(await start())
	var call: PLAY = await play("[cut_line]")
	assert_true(call.done)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.FAILED)
	assert_eq(call.result.choices.size(), 0)
	assert_eq(errors(), 1)
	assert_not_started()
	await press_back()
	assert_false(CutsceneCore._paused, "no back override")
	assert_eq(errors(), 0)


func test_a_view_resource_that_does_not_load_fails() -> void:
	set_setting("cutsceneView", "prefab/cutscene_test_absent")
	assert_true(await start())
	var call: PLAY = await play("[cut_line]")
	assert_true(call.done)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.FAILED)
	assert_eq(errors(), 1)
	assert_gt(UnitTestCore.check_logs(ERROR, "ResourceCore"), 0)
	assert_not_started()


func test_a_line_whose_resource_and_voice_do_not_load_plays_to_the_end_with_the_fallback() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_missing]")
	assert_true(line_running(), "step 4 ran")
	var fallback: Texture2D = ResourceCore.get_loaded("image/cutscene_test_missing", ResourceCore.BaseKind.TEXTURE_2D, scope) as Texture2D
	assert_true(view().portrait.visible)
	assert_eq(view().portrait.texture, fallback)
	await press_advance()
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	assert_eq(errors(), 0, "no CutsceneCore error")
	assert_gt(UnitTestCore.check_logs(ERROR, "ResourceCore"), 0)
	UnitTestCore.check_logs(ERROR, "SoundCore")


func test_register_actor_failures() -> void:
	assert_true(await start())
	var other: Node2D = Node2D.new()
	add_child(other)
	autofree(other)
	assert_false(CutsceneCore.register_actor("hero", other), "a registered key")
	var destroyed: Node2D = Node2D.new()
	destroyed.free()
	assert_false(CutsceneCore.register_actor("new_actor", destroyed), "a destroyed object")
	var control: Control = Control.new()
	autofree(control)
	assert_false(CutsceneCore.register_actor("new_actor", control), "not an actor object")
	assert_false(CutsceneCore.register_actor("new_actor", null), "no object")
	assert_eq(errors(), 4)
	var actor_3d: Node3D = Node3D.new()
	autofree(actor_3d)
	assert_true(CutsceneCore.register_actor("new_actor", actor_3d), "a Node3D is an actor")


func test_registering_another_object_after_the_registered_one_is_destroyed_succeeds() -> void:
	assert_true(await start())
	hero.free()
	var other: Node2D = Node2D.new()
	add_child(other)
	autofree(other)
	assert_true(CutsceneCore.register_actor("hero", other))
	var direct: Node2D = Node2D.new()
	assert_true(CutsceneCore.register_actor("direct", direct))
	direct.free()
	var again: Node2D = Node2D.new()
	autofree(again)
	assert_true(CutsceneCore.register_actor("direct", again))
	assert_eq(errors(), 0)
