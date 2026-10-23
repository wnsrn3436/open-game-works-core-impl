extends "res://core/qa_core/tests/support/qa_test_case.gd"
## The debug screen and the stats display: the open and close input under a block, a pause and a time scale, the
## input cancel on open, the command line and the stats refresh.


func test_opens_under_a_block_a_pause_and_a_time_scale() -> void:
	assert_true(await start())
	var token: int = InputBlockCore.block("content")
	TimeCore.set_paused(true)
	TimeCore.set_time_scale(100)
	await UnitTestCore.wait_frames(1)
	var cancels: int = InputCore.get_cancel_count()
	press_f12()
	await UnitTestCore.wait_frames(1)
	assert_true(QACore._debug_open, "F12 opens the debug screen")
	assert_true(screen().visible)
	assert_eq(InputCore.get_cancel_count(), cancels + 1, "opening cancels the input")
	assert_true((await run("get_state")).ok, "a command ends")
	press_f12()
	await UnitTestCore.wait_frames(1)
	assert_false(QACore._debug_open, "F12 closes it")
	assert_false(screen().visible)
	for index: int in 4:
		var touch: InputEventScreenTouch = InputEventScreenTouch.new()
		touch.index = index
		touch.pressed = true
		touch.position = Vector2(100 + 100 * index, 300)
		InputCoreDev.inject_device_input(touch)
	await UnitTestCore.wait_frames(1)
	assert_true(QACore._debug_open, "four touches at once open it")
	for index: int in 4:
		var release: InputEventScreenTouch = InputEventScreenTouch.new()
		release.index = index
		release.position = Vector2(100 + 100 * index, 300)
		InputCoreDev.inject_device_input(release)
	TimeCore.set_paused(false)
	TimeCore.set_time_scale(1000)
	InputBlockCore.unblock(token)


func test_command_line_and_texts() -> void:
	assert_true(await start())
	press_f12()
	await UnitTestCore.wait_frames(1)
	var line: LineEdit = screen().find_child("CommandLine", true, false) as LineEdit
	line.text = "set_time_scale 1500"
	(screen().find_child("Run", true, false) as Button).pressed.emit()
	await UnitTestCore.wait_frames(3)
	assert_eq(TimeCore.get_time_scale(), 1500, "the typed command ran")
	var state_label: Label = screen().find_child("State", true, false) as Label
	var result_label: Label = screen().find_child("Result", true, false) as Label
	var commands_label: Label = screen().find_child("Commands", true, false) as Label
	assert_true(state_label.text.contains("\"boot_stage\""), "QAState")
	assert_true(result_label.text.contains("set_time_scale ok=true"), "the last command result")
	assert_true(commands_label.text.contains("tap x y"), "the command list with argument names")


func test_stats_display() -> void:
	assert_true(await start())
	var stats: Label = debug_root().get_node("Stats") as Label
	assert_false(stats.visible, "off at first")
	await run_ok("set_stats_visible", PackedStringArray(["true"]))
	assert_true(stats.visible, "shown while the debug screen is closed")
	assert_true(stats.text.begins_with("fps"))
	stats.text = ""
	await advance(STATS_REFRESH_MS - 1)
	assert_eq(stats.text, "", "not refreshed before QACore.statsRefreshMs")
	await advance(1)
	assert_true(stats.text.begins_with("fps"), "refreshed every QACore.statsRefreshMs")
	await run_ok("set_stats_visible", PackedStringArray(["false"]))
	assert_false(stats.visible)
	assert_false((await run("set_stats_visible", PackedStringArray(["yes"]))).ok)
	assert_eq(warns(), 1)


func press_f12() -> void:
	for pressed: bool in [true, false]:
		var event: InputEventKey = InputEventKey.new()
		event.keycode = KEY_F12
		event.physical_keycode = KEY_F12
		event.pressed = pressed
		InputCoreDev.inject_device_input(event)


func debug_root() -> Control:
	return UICore.get_layer(UICore.UILayer.DEBUG).get_node("QACoreDebug") as Control


func screen() -> Control:
	return debug_root().get_node("Screen") as Control
