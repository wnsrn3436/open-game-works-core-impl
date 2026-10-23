extends "res://core/cutscene_core/tests/support/cutscene_test_case.gd"
## The cutscene block and its pass list, and the cutscene root and view root on the safe area.


func test_the_playback_has_one_cutscene_block_that_passes_the_cutscene_actions_back_and_the_cutscene_root() -> void:
	assert_true(await start())
	ResolutionCoreDev.set_test_screen(Vector2i(1280, 720), Vector2i(1280, 720), ResolutionCore.FillMode.LETTERBOX, true)
	SafeAreaCoreDev.set_virtual_notch(40, 0, 0, 0)
	await UnitTestCore.wait_frames(2)
	var call: PLAY = await play("[cut_plain]")
	await UnitTestCore.wait_frames(1)
	assert_eq(block_reasons(), PackedStringArray(["cutscene"]))
	assert_true(InputBlockCore.pass_action(&"cutscene_advance"))
	assert_true(InputBlockCore.pass_action(&"cutscene_skip"))
	assert_true(InputBlockCore.pass_action(&"back"))
	assert_false(InputBlockCore.pass_action(&"menu_ok"))
	var center: Vector2 = ResolutionCore.game_to_window(root().get_global_rect().get_center())
	assert_true(InputBlockCore.pass_position(center), "the cutscene root area passes")
	await press_advance()
	await finish(call)
	assert_eq(block_reasons().size(), 0)
	SafeAreaCoreDev.clear_virtual_notch()
	assert_eq(errors(), 0)


func test_the_cutscene_root_and_the_view_root_fill_the_safe_area_with_a_virtual_notch() -> void:
	assert_true(await start())
	ResolutionCoreDev.set_test_screen(Vector2i(1280, 720), Vector2i(1280, 720), ResolutionCore.FillMode.LETTERBOX, true)
	SafeAreaCoreDev.set_virtual_notch(60, 30, 20, 10)
	await UnitTestCore.wait_frames(2)
	var call: PLAY = await play("[cut_plain]")
	await UnitTestCore.wait_frames(2)
	var area: Rect2 = SafeAreaCore.get_safe_area()
	assert_almost_eq(root().get_global_rect().position, area.position, Vector2(0.5, 0.5))
	assert_almost_eq(root().get_global_rect().size, area.size, Vector2(0.5, 0.5))
	assert_almost_eq(view_root().get_global_rect().position, area.position, Vector2(0.5, 0.5))
	assert_almost_eq(view_root().get_global_rect().size, area.size, Vector2(0.5, 0.5))
	await press_advance()
	await finish(call)
	SafeAreaCoreDev.clear_virtual_notch()
	assert_eq(errors(), 0)
