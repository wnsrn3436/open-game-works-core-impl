extends "res://core/shortcut_core/tests/support/shortcut_case.gd"
## `release` while a navigation waits: the navigation ends with `false` and does no stage after the wait, also when
## the operation it waited for ends.


func test_release_while_waiting_for_change_scene() -> void:
	assert_true(await start_at(SCENE_ROOT))
	TestScene.prepare_gate = Gate.new()
	TestScene.start_panel = PANEL_X
	navigate_later(shortcut("change_b"))
	await wait_trace("scene_gated:root_other")
	ShortcutCore.release()
	assert_eq(results, PackedInt32Array([0]))
	TestScene.prepare_gate.open(true)
	await wait_trace("scene_started:root_other")
	await UnitTestCore.wait_frames(3)
	assert_eq(Trace.with_prefix("flow:close:").size(), 0)
	assert_eq(Trace.count("flow:open:b:true"), 0)
	assert_eq(stack(), "r,x")
	assert_eq(probe.navigated_ids.size(), 0)


func test_release_while_waiting_for_close_panels_to() -> void:
	assert_true(await start_at(SCENE_ROOT, PackedStringArray([PANEL_A])))
	TestPanel.returned_gate = Gate.new()
	navigate_later(shortcut("root_c"))
	await wait_trace("panel_gated:r")
	ShortcutCore.release()
	assert_eq(results, PackedInt32Array([0]))
	TestPanel.returned_gate.open(true)
	await wait_trace("flow:close:r:true")
	await UnitTestCore.wait_frames(3)
	assert_eq(Trace.with_prefix("flow:open:").size(), 0)
	assert_eq(stack(), "r")
	assert_eq(probe.navigated_ids.size(), 0)


func test_release_while_waiting_for_open_panel() -> void:
	assert_true(await start_at(SCENE_ROOT))
	TestPanel.new_gate = Gate.new()
	navigate_later(shortcut("root_c"))
	await wait_trace("panel_gated:c")
	ShortcutCore.release()
	assert_eq(results, PackedInt32Array([0]))
	TestPanel.new_gate.open(true)
	await wait_trace("flow:open:c:true")
	await UnitTestCore.wait_frames(3)
	assert_eq(probe.navigated_ids.size(), 0)


func test_release_while_waiting_for_open_panels() -> void:
	assert_true(await start_at(SCENE_ROOT))
	TestPanel.new_gate = Gate.new()
	navigate_later(shortcut("root_bcd"))
	await wait_trace("panel_gated:d")
	ShortcutCore.release()
	assert_eq(results, PackedInt32Array([0]))
	TestPanel.new_gate.open(true)
	await wait_trace("flow:open:d:true")
	await UnitTestCore.wait_frames(3)
	assert_eq(stack(), "r,b,c,d")
	assert_eq(probe.navigated_ids.size(), 0)
