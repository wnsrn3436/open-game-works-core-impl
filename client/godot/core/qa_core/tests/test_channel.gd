extends "res://core/qa_core/tests/support/qa_test_case.gd"
## The automation channel with a loopback WebSocket server the test runs: the hello, requests and responses, a
## response the channel cannot take, the length limit, the token outside the logs, held inputs on a disconnect, and
## `release` and a new `init`. Browser runs have no listen socket, so these tests run natively only.

const SERVER := preload("res://core/qa_core/tests/support/qa_loopback_server.gd")
const PROBE := preload("res://core/qa_core/tests/support/qa_input_probe.gd")
const NATIVE: PackedStringArray = ["android", "ios", "windows", "macos", "linux"]
const TOKEN: String = "qa-automation-token-7f3a91"
const ADVANCE: StringName = &"cutscene_advance"
const PHASES: PackedStringArray = ["Start", "Move", "End", "Cancel"]
## Outbound room the channel test gives the connection: smaller than the big response.
const OUTBOUND_LIMIT: int = 1024

var server: SERVER = null
## `<phase>:<pointer id>` of every `DragEvent`.
var drags: PackedStringArray = PackedStringArray()


func before_each() -> void:
	super()
	drags = PackedStringArray()


func after_each() -> void:
	if server != null:
		server.stop()
	server = null
	super()


## Starts the server and the modules with the channel launch values. Returns false when the test is skipped.
func start_channel() -> bool:
	UnitTestCore.require_platform(NATIVE)
	if not CoreBuildInfo.platform in NATIVE:
		return false
	server = SERVER.new()
	assert_true(server.start(), "the loopback server listens")
	assert_true(await start(false))
	connect_launch_values()
	assert_true(QACore.init())
	assert_true(await pump_until(1), "the hello came")
	return true


func connect_launch_values() -> void:
	QACore._test_launch_values = {"OGW_AUTOMATION_PORT": str(server.port), "OGW_AUTOMATION_TOKEN": TOKEN}
	QACore._has_test_launch_values = true


## Polls the server a frame at a time until it has `count` messages. They come over a real connection, so they end
## the wait, not a frame count; a release of the modules, as at the test time limit, ends it too. False when they did
## not come.
func pump_until(count: int) -> bool:
	server.poll()
	while server.messages.size() < count:
		if not EventCore.is_initialized():
			return false
		await UnitTestCore.wait_frames(1)
		server.poll()
	return true


## Polls the server a frame at a time until its connection is closed. Ends like `pump_until`.
func pump_until_closed() -> void:
	server.poll()
	while not server.is_closed() and EventCore.is_initialized():
		await UnitTestCore.wait_frames(1)
		server.poll()


func request(id: int, command_name: String, args: PackedStringArray = PackedStringArray()) -> String:
	var items: PackedStringArray = PackedStringArray()
	for arg: String in args:
		items.append(JSON.stringify(arg))
	return "{\"id\": %d, \"command\": %s, \"args\": [%s]}" % [id, JSON.stringify(command_name), ",".join(items)]


func test_hello_requests_and_responses() -> void:
	if not await start_channel():
		return
	assert_eq(JSONR.text(server.messages[0], "token"), TOKEN, "the first message is the hello with the token")
	assert_true(server.send(request(5, "list_commands")))
	assert_true(await pump_until(2))
	var response: String = server.messages[1]
	assert_eq(JSONR.integer(response, "id"), 5)
	assert_true(JSONR.boolean(response, "ok"))
	assert_eq(JSONR.text(response, "bytes"), "")
	var direct: RunCommandResult = await run("list_commands")
	assert_eq(JSONR.at(response, "result"), JSONR.at(direct.result, ""), "the same result as run_command")
	assert_true(server.send("not json"))
	assert_true(await pump_until(3))
	assert_eq(JSONR.integer(server.messages[2], "id"), 0)
	assert_false(JSONR.boolean(server.messages[2], "ok"))
	assert_eq(JSONR.text(server.messages[2], "result"), "malformed request")
	assert_true(server.send(request(6, "no_such_command")))
	assert_true(await pump_until(4))
	assert_eq(JSONR.integer(server.messages[3], "id"), 6)
	assert_false(JSONR.boolean(server.messages[3], "ok"))
	assert_eq(warns(), 1)
	assert_false(log_text().contains(TOKEN), "the token is in no log")


func test_malformed_requests_are_answered_without_a_command() -> void:
	if not await start_channel():
		return
	var messages: Dictionary[String, int] = {
		"not json": 0,
		"[1, 2]": 0,
		"{\"id\": 1.5, \"command\": \"get_state\", \"args\": []}": 0,
		"{\"id\": 7, \"command\": 5, \"args\": []}": 7,
		"{\"id\": 7, \"command\": \"get_state\", \"args\": [1]}": 7,
	}
	var count: int = 1
	for message: String in messages:
		assert_true(server.send(message))
		count += 1
		assert_true(await pump_until(count), message)
		var response: String = server.messages[count - 1]
		assert_eq(JSONR.integer(response, "id"), messages[message], message)
		assert_false(JSONR.boolean(response, "ok"), message)
		assert_eq(JSONR.text(response, "result"), "malformed request", message)
		assert_eq(JSONR.text(response, "bytes"), "", message)
	assert_eq(warns() + errors(), 0, "no log")
	assert_eq(log_text().count("command get_state"), 0, "no command ran")


func test_a_result_of_none_is_null() -> void:
	if not await start_channel():
		return
	assert_true(server.send(request(3, "tap", window_args(640, 600))))
	assert_true(await pump_until(2))
	assert_eq(JSONR.integer(server.messages[1], "id"), 3)
	assert_true(JSONR.boolean(server.messages[1], "ok"))
	assert_true(JSONR.is_null(server.messages[1], "result"), "a tap has no result")


func test_a_message_over_the_limit_disconnects() -> void:
	if not await start_channel():
		return
	assert_true(server.send("x".repeat(CHANNEL_MAX_BYTES + 1)))
	await pump_until_closed()
	assert_true(server.is_closed(), "QACore closed the connection")
	assert_null(QACore._channel)
	assert_eq(warns(), 1, "a warn log")
	assert_false(log_text().contains(TOKEN))


func test_a_response_the_channel_cannot_take_becomes_a_short_failure() -> void:
	if not await start_channel():
		return
	assert_true(QACore.register_command("qa.big", "Returns a big result.", PackedStringArray(), _big))
	QACore._channel.outbound_limit = OUTBOUND_LIMIT
	assert_true(server.send(request(7, "qa.big")))
	assert_true(await pump_until(2))
	var response: String = server.messages[1]
	assert_eq(JSONR.integer(response, "id"), 7, "a response of the same id")
	assert_false(JSONR.boolean(response, "ok"))
	assert_eq(JSONR.text(response, "result"), "the response could not be sent")
	assert_eq(warns(), 1, "a warn log")
	assert_eq(log_text().count("command qa.big ok=true"), 1, "the command itself ended")
	assert_true(server.send(request(8, "get_stats")))
	assert_true(await pump_until(3))
	assert_eq(JSONR.integer(server.messages[2], "id"), 8, "the channel goes on")
	assert_true(JSONR.boolean(server.messages[2], "ok"))


func test_a_handler_result_that_is_not_json_gives_a_json_response() -> void:
	if not await start_channel():
		return
	assert_true(QACore.register_command("qa.plain", "Returns text that is not JSON.", PackedStringArray(), _plain))
	assert_true(server.send(request(9, "qa.plain")))
	assert_true(await pump_until(2))
	var response: String = server.messages[1]
	assert_eq(JSONR.integer(response, "id"), 9, "the response is JSON")
	assert_false(JSONR.boolean(response, "ok"))
	assert_eq(JSONR.text(response, "result"), "the handler result is not JSON")
	assert_eq(warns(), 1)


func test_a_disconnect_lets_go_of_held_inputs() -> void:
	if not await start_channel():
		return
	assert_true(EventCore.subscribe(DragEvent, _on_drag))
	assert_true(server.send(request(1, "key_down", PackedStringArray(["Space"]))))
	var touch: PackedStringArray = PackedStringArray(["0"]) + window_args(100, 300)
	assert_true(server.send(request(2, "touch_down", touch)))
	var moved: PackedStringArray = PackedStringArray(["0"]) + window_args(400, 300)
	assert_true(server.send(request(3, "touch_move", moved)))
	assert_true(server.send(request(4, "pad_axis", PackedStringArray(["left_x", "0.5"]))))
	# Not `left`: the engine makes a left mouse button input of every touch input.
	assert_true(server.send(request(5, "mouse_down", PackedStringArray(["right"]) + window_args(700, 300))))
	assert_true(server.send(request(6, "pad_button_down", PackedStringArray(["a"]))))
	assert_true(await pump_until(7))
	for i: int in range(1, 7):
		assert_true(JSONR.boolean(server.messages[i], "ok"), server.messages[i])
	assert_true(InputCore.is_pressed(ADVANCE))
	assert_true(Input.is_joy_button_pressed(0, JOY_BUTTON_A), "the gamepad button is pressed")
	assert_true(Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT), "the mouse button is pressed")
	assert_eq(drags, PackedStringArray(["Start:0"]), "the held touch drags")
	assert_false(QACore._input.touches.is_empty() or QACore._input.axes.is_empty())
	server.close()
	server.poll()
	while QACore._channel != null and EventCore.is_initialized():
		await UnitTestCore.wait_frames(1)
		server.poll()
	await UnitTestCore.wait_frames(1)
	assert_null(QACore._channel, "the channel saw the disconnect")
	assert_false(InputCore.is_pressed(ADVANCE), "the key is released")
	assert_false(Input.is_joy_button_pressed(0, JOY_BUTTON_A), "the gamepad button is released")
	assert_false(Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT), "the mouse button is released")
	assert_eq(drags, PackedStringArray(["Start:0", "End:0"]), "the touch is released")
	assert_true(QACore._input.touches.is_empty() and QACore._input.keys.is_empty() and QACore._input.axes.is_empty())
	assert_true(QACore._input.mouse_buttons.is_empty() and QACore._input.pad_buttons.is_empty())
	assert_eq(Input.get_joy_axis(0, JOY_AXIS_LEFT_X), 0.0, "the axis is back at 0")


func test_a_disconnect_ends_the_running_and_waiting_commands() -> void:
	if not await start_channel():
		return
	var probe: PROBE = PROBE.new()
	add_child_autofree(probe)
	var drag: PackedStringArray = window_args(100, 300) + window_args(600, 300)
	drag.append("1000")
	assert_true(server.send(request(1, "drag", drag)))
	assert_true(server.send(request(2, "touch_down", PackedStringArray(["1"]) + window_args(800, 300))))
	server.poll()
	while probe.count_of("drag") < 2 and EventCore.is_initialized():
		await advance(50, 1)
		server.poll()
	assert_eq(QACore._running.name if QACore._running != null else "", "drag", "the drag runs")
	assert_eq(QACore._queue.size(), 1, "the touch_down waits")
	var before_close: int = probe.inputs.size()
	server.close()
	server.poll()
	while QACore._channel != null and EventCore.is_initialized():
		await UnitTestCore.wait_frames(1)
		server.poll()
	var inputs: int = probe.inputs.size()
	for i: int in 5:
		await advance(50, 1)
	assert_null(QACore._running, "the drag ended")
	assert_true(QACore._queue.is_empty(), "the touch_down ended")
	var text: String = log_text()
	assert_eq(text.count("command drag ok=false"), 1, "the drag ended with ok = false")
	assert_eq(text.count("command touch_down ok=false"), 1, "the touch_down ended with ok = false")
	assert_eq(warns(), 2)
	assert_eq(probe.count_of("drag", inputs), 0, "no move after the disconnect")
	assert_eq(probe.count_of("touch_down", inputs), 0, "no press after the disconnect")
	assert_eq(probe.count_of("touch_up", before_close), 1, "the release of the held touch")
	assert_eq(probe.frame_of("touch_down:1"), -1, "the waiting touch_down put in nothing")
	assert_true(QACore._input.touches.is_empty())


func test_release_disconnects_and_init_connects_again() -> void:
	if not await start_channel():
		return
	QACore.release()
	await pump_until_closed()
	assert_true(server.is_closed(), "release closed the connection")
	connect_launch_values()
	assert_true(QACore.init())
	assert_true(await pump_until(2), "a new hello")
	assert_eq(server.connections, 2)
	assert_eq(JSONR.text(server.messages[1], "token"), TOKEN)



func _big(_args: PackedStringArray) -> RunCommandResult:
	var result: RunCommandResult = RunCommandResult.new()
	result.ok = true
	result.result = JSON.stringify("x".repeat(OUTBOUND_LIMIT * 2))
	return result


func _plain(_args: PackedStringArray) -> RunCommandResult:
	var result: RunCommandResult = RunCommandResult.new()
	result.ok = true
	result.result = "done"
	return result


func _on_drag(event: DragEvent) -> void:
	drags.append("%s:%d" % [PHASES[event.phase], event.pointer_id])
