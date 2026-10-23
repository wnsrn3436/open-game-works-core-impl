extends "res://core/qa_core/tests/support/qa_test_case.gd"
## Input commands: real input through `InputCore.inject_device_input`, window pixel positions, held inputs and their
## checks.

const PROBE := preload("res://core/qa_core/tests/support/qa_input_probe.gd")
const COMMAND := preload("res://core/qa_core/dev/qa_command.gd")
const INPUT := preload("res://core/qa_core/dev/qa_input.gd")
const ADVANCE: StringName = &"cutscene_advance"
const SKIP: StringName = &"cutscene_skip"
const PHASES: PackedStringArray = ["Start", "Move", "End", "Cancel"]
## Starts calls in its process callback, after the process callbacks of the other nodes, as the automation channel
## starts commands after them.
class LateStarter:
	extends Node
	var calls: Array[Callable] = []

	func _init() -> void:
		process_priority = 1000000

	func _process(_delta: float) -> void:
		var started: Array[Callable] = calls
		calls = []
		for call: Callable in started:
			call.call()


## U+1F44D U+1F3FD: two code points, one emoji.
const THUMBS_UP: String = "\U01F44D\U01F3FD"

## `<phase>:<pointer id>` of every `DragEvent`, and the position of every `End`.
var drags: PackedStringArray = PackedStringArray()
var drag_ends: Array[Vector2] = []
var devices: Array[InputCore.InputDevice] = []
var connection_changes: int = 0
## Process frames of the presses a test target control received, and of the clicks of a test button.
var press_frames: PackedInt64Array = PackedInt64Array()
var click_frames: PackedInt64Array = PackedInt64Array()
var probe: PROBE = null


func before_each() -> void:
	super()
	drags = PackedStringArray()
	drag_ends = []
	devices = []
	connection_changes = 0
	press_frames = PackedInt64Array()
	click_frames = PackedInt64Array()
	probe = null


func start_input() -> bool:
	var ok: bool = await start()
	assert_true(EventCore.subscribe(DragEvent, _on_drag))
	assert_true(EventCore.subscribe(InputDeviceChangedEvent, _on_device_changed))
	assert_true(EventCore.subscribe(GamepadConnectionChangedEvent, _on_connection_changed))
	probe = PROBE.new()
	add_child_autofree(probe)
	return ok


func test_tap_on_a_list_ui_button_clicks_it_once() -> void:
	assert_true(await start_input())
	add_button("go")
	var list: String = await run_ok("list_ui")
	var rect: Rect2 = JSONR.rect(element_field(list, "Go", "rect"), "")
	await run_ok("tap", center_args(rect))
	await UnitTestCore.wait_frames(2)
	assert_eq(clicks, PackedStringArray(["go"]), "one click")


func test_tap_in_a_letterbox_window() -> void:
	assert_true(await start_input())
	var window: Vector2i = (Engine.get_main_loop() as SceneTree).root.size
	ResolutionCoreDev.set_test_screen(Vector2i(1000, 720), window, ResolutionCore.FillMode.LETTERBOX, false)
	await UnitTestCore.wait_frames(2)
	add_button("go", Vector2(400, 300))
	var list: String = await run_ok("list_ui")
	var rect: Rect2 = JSONR.rect(element_field(list, "Go", "rect"), "")
	await run_ok("tap", center_args(rect))
	await UnitTestCore.wait_frames(2)
	assert_eq(clicks, PackedStringArray(["go"]), "one click in a letterbox window")


func test_tap_under_a_block_is_blocked_like_a_person() -> void:
	assert_true(await start_input())
	add_button("go")
	var list: String = await run_ok("list_ui")
	var rect: Rect2 = JSONR.rect(element_field(list, "Go", "rect"), "")
	var token: int = InputBlockCore.block("content")
	await UnitTestCore.wait_frames(1)
	await run_ok("tap", center_args(rect))
	await UnitTestCore.wait_frames(2)
	assert_eq(clicks, PackedStringArray(), "no click under the block")
	InputBlockCore.unblock(token)


func test_tap_anchor_and_get_anchor() -> void:
	assert_true(await start_input())
	assert_true(await UICore.open_panel(PANEL, null, false))
	await UnitTestCore.wait_frames(1)
	var go: Button = UICore.get_layer(UICore.UILayer.PANEL).find_child("Go", true, false) as Button
	var ui_button: UIButton = go.get_child(0) as UIButton
	ui_button.set_on_click(_on_click.bind("panel_go"))
	var anchor: String = await run_ok("get_anchor", PackedStringArray(["qa_go"]))
	assert_true(JSONR.boolean(anchor, "found") and JSONR.boolean(anchor, "visible"))
	var expected: AnchorResult = UICore.get_anchor_rect("qa_go")
	var start_point: Vector2 = ResolutionCore.game_to_window(expected.rect.position)
	var end_point: Vector2 = ResolutionCore.game_to_window(expected.rect.end)
	var window_rect: Rect2 = JSONR.rect(anchor, "rect")
	assert_almost_eq(window_rect.position, start_point, Vector2(0.01, 0.01), "rect is the anchor rectangle in window pixels")
	assert_almost_eq(window_rect.end, end_point, Vector2(0.01, 0.01))
	await run_ok("tap_anchor", PackedStringArray(["qa_go"]))
	await UnitTestCore.wait_frames(2)
	assert_eq(clicks, PackedStringArray(["panel_go"]), "tap_anchor presses the anchor center")
	assert_false((await run("tap_anchor", PackedStringArray(["qa_missing"]))).ok, "an anchor that is not there")
	assert_eq(await UICore.open_popup(POPUP, null, Callable()), UICore.PopupOpenResult.OPENED)
	await UnitTestCore.wait_frames(1)
	assert_true(UICore.is_modal_covered(go), "the popup covers the panel")
	assert_false((await run("tap_anchor", PackedStringArray(["qa_go"]))).ok, "an anchor under a modal popup")
	assert_eq(clicks, PackedStringArray(["panel_go"]))
	assert_eq(warns(), 2)


func test_tap_anchor_keys() -> void:
	assert_true(await start_input())
	var gold: int = GameDataDev.find_id_value("[gold]")
	assert_true(gold != 0, "[gold] is in the core test data")
	var item_button: Button = add_button("item", Vector2(100, 300))
	add_anchor(item_button, "qa_slot", gold)
	var nine_button: Button = add_button("nine", Vector2(400, 300))
	add_anchor(nine_button, "qa_slot", 9)
	await UnitTestCore.wait_frames(1)
	await run_ok("tap_anchor", PackedStringArray(["qa_slot", "[gold]"]))
	await UnitTestCore.wait_frames(2)
	await run_ok("tap_anchor", PackedStringArray(["qa_slot", "9"]))
	await UnitTestCore.wait_frames(2)
	assert_eq(clicks, PackedStringArray(["item", "nine"]), "each key presses its anchor")
	for key: String in ["[qa_no_such_id]", "0", "-1", "9.5"]:
		assert_false((await run("tap_anchor", PackedStringArray(["qa_slot", key]))).ok, key)
		assert_false((await run("get_anchor", PackedStringArray(["qa_slot", key]))).ok, key)
	assert_eq(clicks, PackedStringArray(["item", "nine"]), "a bad key presses nothing")
	assert_eq(warns(), 8)


func test_drag_key_and_text() -> void:
	assert_true(await start_input())
	var drag_args: PackedStringArray = window_args(100, 400) + window_args(500, 400)
	drag_args.append("100")
	var drag: Pending = start_command("drag", drag_args)
	var result: RunCommandResult = await finish(drag, 20)
	assert_true(result.ok)
	assert_true(drags.size() >= 3, "Start, Move and End")
	if drags.size() >= 3:
		assert_true(drags[0].begins_with("Start"))
		assert_true(drags[1].begins_with("Move"))
		assert_true(drags[drags.size() - 1].begins_with("End"))
	var key: Pending = start_command("key", PackedStringArray(["Space", "200"]))
	await UnitTestCore.wait_frames(2)
	assert_true(InputCore.is_pressed(ADVANCE), "the key holds the action")
	await advance(100, 2)
	assert_true(InputCore.is_pressed(ADVANCE), "still pressed before ms")
	result = await finish(key, 50)
	assert_true(result.ok)
	assert_false(InputCore.is_pressed(ADVANCE), "released after ms")
	assert_true(await UICore.open_panel(PANEL, null, false))
	var input: LineEdit = UICore.get_layer(UICore.UILayer.PANEL).find_child("Input", true, false) as LineEdit
	input.grab_focus()
	await UnitTestCore.wait_frames(1)
	await run_ok("text", PackedStringArray(["abc"]))
	assert_eq(input.text, "abc", "text goes into the focused text input element")
	assert_false((await run("text", PackedStringArray(["123456789"]))).ok, "over QACore.textMaxChars")
	assert_false((await run("text", PackedStringArray([""]))).ok, "empty")
	assert_eq(warns(), 2)


func test_drag_of_0_ms_moves_and_releases_in_the_next_frame() -> void:
	assert_true(await start_input())
	var drag_args: PackedStringArray = window_args(100, 400) + window_args(500, 400)
	drag_args.append("0")
	await run_ok("drag", drag_args)
	var pressed: int = probe.frame_of("touch_down:0")
	assert_true(pressed >= 0, "a press")
	assert_eq(probe.frame_of("drag:0"), pressed + 1, "the move in the next frame")
	assert_eq(probe.frame_of("touch_up:0"), pressed + 1, "the release in the same frame")
	assert_eq(drag_ends.size(), 1)
	if drag_ends.size() == 1:
		assert_almost_eq(drag_ends[0], Vector2(500, 400), Vector2(0.01, 0.01), "the release at the end position")


func test_every_touch_index_pressed() -> void:
	assert_true(await start_input())
	var button: Button = add_button("go", Vector2(600, 300))
	add_anchor(button, "qa_go")
	await UnitTestCore.wait_frames(1)
	for index: int in TOUCH_INDEX_COUNT:
		await run_ok("touch_down", PackedStringArray([str(index)]) + window_args(100 + index * 50, 600))
	var inputs: int = probe.inputs.size()
	var drag_args: PackedStringArray = window_args(100, 400) + window_args(500, 400)
	drag_args.append("0")
	for item: PackedStringArray in [
		PackedStringArray(["tap"]) + window_args(660, 330),
		PackedStringArray(["tap_anchor", "qa_go"]),
		PackedStringArray(["drag"]) + drag_args,
		PackedStringArray(["touch_down", str(TOUCH_INDEX_COUNT)]) + window_args(1, 1),
	]:
		var result: RunCommandResult = await run(item[0], item.slice(1))
		assert_false(result.ok, " ".join(item))
		assert_eq(warns(), 1, item[0])
	await UnitTestCore.wait_frames(2)
	assert_eq(probe.inputs.size(), inputs, "no device input")
	assert_eq(clicks, PackedStringArray(), "no click")
	for index: int in TOUCH_INDEX_COUNT:
		await run_ok("touch_up", PackedStringArray([str(index)]))


func test_ui_press_and_just_pressed_in_one_frame() -> void:
	assert_true(await start_input())
	assert_true(InputCore.set_keys(SKIP, PackedStringArray(["mouse_left"])))
	# The target takes the press and passes it on, so the press is a world input of the action too.
	var target: Control = Control.new()
	target.mouse_filter = Control.MOUSE_FILTER_PASS
	target.position = Vector2(400, 300)
	target.size = Vector2(200, 200)
	target.gui_input.connect(_on_target_input)
	UICore.get_layer(UICore.UILayer.SCENE_UI).add_child(target)
	probe.watched = SKIP
	var late: LateStarter = LateStarter.new()
	add_child_autofree(late)
	await UnitTestCore.wait_frames(1)
	assert_true((await run_late(late, "mouse_down", PackedStringArray(["left"]) + window_args(500, 400))).ok)
	assert_true((await run_late(late, "mouse_up", PackedStringArray(["left"]) + window_args(500, 400))).ok)
	assert_eq(press_frames.size(), 1, "the UI element received the press")
	if press_frames.size() == 1:
		assert_true(press_frames[0] in probe.just_pressed_frames, "the action is just pressed in the frame of the press")
	assert_true(await UICore.open_popup(POPUP, null, Callable()) == UICore.PopupOpenResult.OPENED)
	await UnitTestCore.wait_frames(2)
	var ok: Button = UICore.get_layer(UICore.UILayer.POPUP).find_child("Ok", true, false) as Button
	var ui_button: UIButton = ok.get_child(0) as UIButton
	ui_button.set_on_click(_on_frame_click)
	# A button the accept press clicks, as the action press clicks an action button.
	ok.action_mode = BaseButton.ACTION_MODE_BUTTON_PRESS
	probe.watched = ADVANCE
	await run_ok("set_input_device", PackedStringArray(["KeyboardMouse"]))
	await run_ok("key", PackedStringArray(["Down"]))
	await UnitTestCore.wait_frames(2)
	assert_true(ok.has_focus(), "the direction key starts the focus mode on the popup button")
	assert_true((await run_late(late, "key", PackedStringArray(["Space"]))).ok)
	await UnitTestCore.wait_frames(2)
	assert_eq(click_frames.size(), 1, "the accept key clicks the focused button")
	if click_frames.size() == 1:
		assert_true(click_frames[0] in probe.just_pressed_frames, "the key's action is just pressed in the click frame")


## Runs a command that `late` starts after the process callbacks of a frame.
func run_late(late: LateStarter, command_name: String, args: PackedStringArray) -> RunCommandResult:
	var pending: Pending = Pending.new()
	late.calls.append(_run_into.bind(pending, command_name, args))
	if not pending.done:
		await pending.finished
	return pending.result


func test_mouse_button_arguments_press_their_input_core_buttons() -> void:
	assert_true(await start_input())
	for pair: PackedStringArray in [
		PackedStringArray(["left", "mouse_left"]), PackedStringArray(["right", "mouse_right"]),
		PackedStringArray(["middle", "mouse_middle"]),
	]:
		assert_true(InputCore.set_keys(SKIP, PackedStringArray([pair[1]])), pair[1])
		await run_ok("mouse_down", PackedStringArray([pair[0]]) + window_args(100, 600))
		assert_true(InputCore.is_pressed(SKIP), "%s presses %s" % [pair[0], pair[1]])
		await run_ok("mouse_up", PackedStringArray([pair[0]]) + window_args(100, 600))
		assert_false(InputCore.is_pressed(SKIP), pair[0])


func test_text_counts_code_points() -> void:
	set_int("QACore.textMaxChars", 1)
	assert_true(await start_input())
	assert_true(await UICore.open_panel(PANEL, null, false))
	var input: LineEdit = UICore.get_layer(UICore.UILayer.PANEL).find_child("Input", true, false) as LineEdit
	input.grab_focus()
	await UnitTestCore.wait_frames(1)
	assert_false((await run("text", PackedStringArray([THUMBS_UP]))).ok, "two code points over 1")
	assert_eq(warns(), 1)
	assert_eq(probe.count_of("text"), 0, "no text input")
	QACore.release()
	set_int("QACore.textMaxChars", 2)
	QACore._test_launch_values = {}
	QACore._has_test_launch_values = true
	assert_true(QACore.init())
	await run_ok("text", PackedStringArray([THUMBS_UP]))
	var frames: PackedInt64Array = probe.frames_of("text")
	assert_eq(frames.size(), 2, "a text input a code point")
	if frames.size() == 2:
		assert_eq(frames[1], frames[0] + 1, "in two frames")
	assert_eq(input.text, THUMBS_UP)


func test_frame_start_only_puts_inputs_in() -> void:
	assert_true(await start_input())
	var command: COMMAND = COMMAND.new()
	command.name = "key_down"
	QACore._put_input(command, INPUT.key_event(KEY_SPACE, true))
	var pending: Array[InputEvent] = QACore._pending_inputs
	var started: Array[int] = [0]
	QACore._node.frame_started.connect(func() -> void: started[0] += 1)
	QACore._node.on_process_frame()
	assert_eq(QACore._frame_input_count, 1, "the input is put in")
	assert_true(is_same(QACore._pending_inputs, pending), "no new pending list in frame code")
	assert_eq(QACore._pending_inputs.size(), 1, "the pending list keeps its size in frame code")
	assert_false(QACore._input.keys.has(KEY_SPACE), "no held input record in frame code")
	assert_false(command.input_recorded, "no telemetry input in frame code")
	assert_eq(started[0], 0, "no frame_started in frame code")
	await UnitTestCore.wait_frames(1)
	assert_true(started[0] >= 1, "frame_started in the deferred frame start")
	assert_true(QACore._input.keys.has(KEY_SPACE), "the held input record in the deferred frame start")
	assert_true(command.input_recorded, "the telemetry input in the deferred frame start")
	assert_true(QACore._pending_inputs.is_empty() and QACore._pending_commands.is_empty(), "the recorded input is taken off")
	assert_eq(QACore._frame_input_count, 0)
	await UnitTestCore.wait_frames(1)
	assert_eq(probe.count_of("key_down"), 1, "put in once")
	assert_true(InputCore.is_pressed(ADVANCE), "the key is pressed")
	await run_ok("key_up", PackedStringArray(["Space"]))
	assert_false(InputCore.is_pressed(ADVANCE), "the key is released")


## The pump of a command is queued before the frame start, as when the command came after the last flush of the frame
## before and the frame has no physics step: the pump runs in the flush before the deferred frame start. In the process
## frame, so a `frame_ended` of the same frame comes after that flush.
func test_an_input_command_started_before_the_frame_start_flush_waits_for_the_next_frame_start() -> void:
	assert_true(await start_input())
	await (Engine.get_main_loop() as SceneTree).process_frame
	var tap: COMMAND = QACore._submit("tap", window_args(100, 300), false, 0)
	QACore._node.on_process_frame()
	if not tap.done:
		await tap.finished
	assert_true(tap.ok, tap.result)
	var downs: PackedInt64Array = probe.frames_of("touch_down")
	var ups: PackedInt64Array = probe.frames_of("touch_up")
	assert_eq(downs.size(), 1, "one press")
	assert_eq(ups.size(), 1, "one release")
	if downs.size() == 1 and ups.size() == 1:
		assert_eq(ups[0], downs[0] + 1, "the release in the next frame")
	await (Engine.get_main_loop() as SceneTree).process_frame
	var key: COMMAND = QACore._submit("key_down", PackedStringArray(["Space"]), false, 0)
	QACore._node.on_process_frame()
	if not key.done:
		await key.finished
	assert_true(key.ok, key.result)
	assert_eq(probe.count_of("key_down"), 1, "the input is in when key_down ends")
	assert_true(InputCore.is_pressed(ADVANCE), "the key is pressed when key_down ends")
	await run_ok("key_up", PackedStringArray(["Space"]))


func test_held_inputs_make_simultaneous_input() -> void:
	assert_true(await start_input())
	var frame: int = Engine.get_process_frames()
	await run_ok("key_down", PackedStringArray(["Space"]))
	assert_eq(Engine.get_process_frames(), frame + 1, "key_down ends the next frame")
	await run_ok("touch_down", PackedStringArray(["0"]) + window_args(100, 300))
	await run_ok("touch_down", PackedStringArray(["1"]) + window_args(700, 300))
	assert_eq(Engine.get_process_frames(), frame + 3, "each command ends the next frame")
	assert_true(InputCore.is_pressed(ADVANCE), "the key is pressed")
	assert_true(QACore._input.touches.has(0) and QACore._input.touches.has(1), "both touches are held")
	await run_ok("touch_move", PackedStringArray(["0"]) + window_args(400, 300))
	assert_true(drags.size() >= 1 and drags[0] == "Start:0", "touch_move makes a DragEvent of pointer 0")
	await run_ok("touch_up", PackedStringArray(["0"]))
	await run_ok("touch_up", PackedStringArray(["1"]))
	await run_ok("key_up", PackedStringArray(["Space"]))
	assert_false(InputCore.is_pressed(ADVANCE), "the key is released")
	assert_true(QACore._input.touches.is_empty())


func test_mouse_and_gamepad_devices() -> void:
	assert_true(await start_input())
	var before: PackedInt32Array = PackedInt32Array()
	before.resize(8)
	var connected: int = InputCore.get_connected_gamepads(before)
	await run_ok("mouse_down", PackedStringArray(["left"]) + window_args(100, 300))
	assert_eq(InputCore.get_device(), InputCore.InputDevice.KEYBOARD_MOUSE, "mouse_down")
	await run_ok("mouse_up", PackedStringArray(["left"]) + window_args(100, 300))
	await run_ok("pad_button_down", PackedStringArray(["a"]))
	assert_eq(InputCore.get_device(), InputCore.InputDevice.GAMEPAD, "pad_button_down")
	await run_ok("pad_button_up", PackedStringArray(["a"]))
	assert_true(InputCore.set_pad_buttons(SKIP, PackedStringArray(["left_x+"])))
	await run_ok("pad_axis", PackedStringArray(["left_x", "0.75"]))
	assert_almost_eq(InputCore.get_strength(SKIP), 0.75, 0.001, "the axis value is the strength of its action")
	await run_ok("pad_axis", PackedStringArray(["left_x", "1"]))
	assert_almost_eq(InputCore.get_strength(SKIP), 1.0, 0.001, "1 on the + direction")
	await run_ok("pad_axis", PackedStringArray(["left_x", "0"]))
	assert_almost_eq(InputCore.get_strength(SKIP), 0.0, 0.001, "0 after the axis is back at 0")
	assert_true(QACore._input.axes.is_empty())
	var gamepads: PackedInt32Array = PackedInt32Array()
	gamepads.resize(8)
	assert_eq(InputCore.get_connected_gamepads(gamepads), connected, "the connected gamepads stay")
	assert_eq(connection_changes, 0, "no GamepadConnectionChangedEvent")


func test_bad_held_input_commands_fail() -> void:
	assert_true(await start_input())
	await run_ok("touch_down", PackedStringArray(["0"]) + window_args(100, 300))
	await run_ok("key_down", PackedStringArray(["Space"]))
	var cases: Array[PackedStringArray] = [
		PackedStringArray(["touch_down", "0", "200", "200"]),
		PackedStringArray(["touch_up", "1"]),
		PackedStringArray(["touch_move", "2", "1", "1"]),
		PackedStringArray(["touch_down", str(TOUCH_INDEX_COUNT), "1", "1"]),
		PackedStringArray(["key_down", "Space"]),
		PackedStringArray(["key_up", "Escape"]),
		PackedStringArray(["key", "NoSuchKey"]),
		PackedStringArray(["key", "Ctrl+A"]),
		PackedStringArray(["pad_axis", "left_x", "1.5"]),
		PackedStringArray(["pad_axis", "trigger_left", "-0.5"]),
		PackedStringArray(["pad_button_down", "z"]),
		PackedStringArray(["mouse_down", "side", "1", "1"]),
		PackedStringArray(["mouse_down", "mouse_left", "1", "1"]),
		PackedStringArray(["mouse_up", "left", "1", "1"]),
	]
	for item: PackedStringArray in cases:
		assert_false((await run(item[0], item.slice(1))).ok, " ".join(item))
	assert_eq(warns(), cases.size())
	assert_eq(QACore._input.touches.keys(), [0], "the held touch stays")
	await run_ok("touch_up", PackedStringArray(["0"]))
	await run_ok("key_up", PackedStringArray(["Space"]))


func _on_drag(event: DragEvent) -> void:
	var phase: String = PHASES[event.phase]
	drags.append("%s:%d" % [phase, event.pointer_id])
	if event.phase == InputCore.GesturePhase.END:
		drag_ends.append(event.position)


func _on_connection_changed(_event: GamepadConnectionChangedEvent) -> void:
	connection_changes += 1


func _on_target_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and (event as InputEventMouseButton).pressed:
		press_frames.append(Engine.get_process_frames())


func _on_frame_click() -> void:
	click_frames.append(Engine.get_process_frames())


func _on_device_changed(event: InputDeviceChangedEvent) -> void:
	devices.append(event.device)
