extends "res://core/qa_core/tests/support/qa_test_case.gd"
## Command order, argument checks, the command logs, content commands, the time limit and `list_commands`.

const BUILTINS := preload("res://core/qa_core/dev/qa_builtins.gd")


class Gate:
	extends RefCounted
	signal opened
	var is_open: bool = false

	func open() -> void:
		is_open = true
		opened.emit()


## An object the test frees to destroy the object of a callback.
class Holder:
	extends Object

	func state() -> String:
		return "{\"hp\": 3}"

	func handle(_args: PackedStringArray) -> RunCommandResult:
		var result: RunCommandResult = RunCommandResult.new()
		result.ok = true
		return result


## `args` of the built-in command table of the spec, joined by commas.
const BUILTIN_ARGS: Dictionary[String, String] = {
	"get_state": "", "get_stats": "", "get_telemetry": "", "clear_telemetry": "", "capture_screen": "",
	"capture_video": "ms", "list_ui": "", "get_anchor": "anchor,key", "tap": "x,y",
	"tap_anchor": "anchor,key", "drag": "x1,y1,x2,y2,ms", "key": "key,ms", "text": "text",
	"touch_down": "index,x,y", "touch_move": "index,x,y", "touch_up": "index", "key_down": "key",
	"key_up": "key", "mouse_move": "x,y", "mouse_down": "button,x,y", "mouse_up": "button,x,y",
	"pad_button_down": "button", "pad_button_up": "button", "pad_axis": "axis,value", "go_to_scene": "scene",
	"open_panel": "panel", "set_time_scale": "permille", "set_step_mode": "mode", "leave_match": "",
	"step": "ms", "set_language": "code", "set_server_time_offset": "ms",
	"set_user_state": "kind,item,value", "set_item_balance": "item,balance",
	"delete_user_state": "kind,item", "set_mission_progress": "mission,progress,claimed",
	"set_reset_counter": "counter,count", "set_quality_level": "level", "set_text_scale": "permille",
	"force_network_failure": "kind", "set_network_delay": "ms", "expire_access_token": "",
	"set_social_account": "account", "simulate_push": "message,mode", "set_push_permission": "status",
	"drop_peer": "participant", "drop_matchmaker": "", "set_test_screen": "width,height,fill_mode",
	"set_virtual_notch": "left,top,right,bottom", "set_virtual_keyboard": "height",
	"set_input_device": "device", "focus_ui": "path", "restart": "", "quit": "", "extract_logs": "offsets",
	"get_requests": "", "get_user_state": "kind", "get_resources": "", "get_sound": "", "list_commands": "",
	"set_stats_visible": "visible",
}

var gate: Gate = null
var order: PackedStringArray = PackedStringArray()


func before_each() -> void:
	super()
	gate = Gate.new()
	order = PackedStringArray()


func test_a_command_starts_after_the_one_before_ends() -> void:
	assert_true(await start())
	assert_true(QACore.register_command("qa.first", "Waits for the gate.", PackedStringArray(), _first))
	assert_true(QACore.register_command("qa.second", "Records its start.", PackedStringArray(), _second))
	var first: Pending = start_command("qa.first")
	var second: Pending = start_command("qa.second")
	await UnitTestCore.wait_frames(3)
	assert_eq(order, PackedStringArray(["first:start"]), "the second waits for the first")
	assert_false(second.done)
	gate.open()
	await finish(first)
	await finish(second)
	assert_eq(order, PackedStringArray(["first:start", "first:end", "second:start"]))
	assert_true(first.result.ok and second.result.ok)


func test_bad_arguments_fail_without_the_target_operation() -> void:
	assert_true(await start())
	var safe_area: String = JSONR.at(await state(), "safe_area")
	var cases: Array[PackedStringArray] = [
		PackedStringArray(["no_such_command"]),
		PackedStringArray(["tap", "1"]),
		PackedStringArray(["get_state", "extra"]),
		PackedStringArray(["set_time_scale", "0"]),
		PackedStringArray(["set_time_scale", "-1"]),
		PackedStringArray(["set_time_scale", "1e3"]),
		PackedStringArray(["set_time_scale", ".5"]),
		PackedStringArray(["set_time_scale", str(TIME_SCALE_MAX_PERMILLE + 1)]),
		PackedStringArray(["set_server_time_offset", "1.5"]),
		PackedStringArray(["set_server_time_offset", "+5"]),
		PackedStringArray(["set_server_time_offset", " 5"]),
		PackedStringArray(["set_server_time_offset", "1234567890123456789"]),
		PackedStringArray(["set_language", "xx"]),
		PackedStringArray(["set_virtual_notch", "-1", "0", "0", "0"]),
		PackedStringArray(["set_virtual_notch", "NONE"]),
		PackedStringArray(["capture_video", "0"]),
		PackedStringArray(["capture_video", str(VIDEO_MAX_MS + 1)]),
		PackedStringArray(["drop_peer", "-1"]),
		PackedStringArray(["drop_peer", "others"]),
	]
	for item: PackedStringArray in cases:
		var label: String = " ".join(item)
		var result: RunCommandResult = await run(item[0], item.slice(1))
		assert_false(result.ok, label)
		assert_true(JSONR.text(result.result, "") != "<not a string>", label + ": the result is an English reason")
		assert_eq(warns(), 1, label + ": one warn log")
		assert_eq(errors(), 0, label + ": no error log")
	assert_eq(TimeCore.get_time_scale(), 1000, "set_time_scale was not called")
	assert_eq(request_count(), 0, "no cheat request")
	assert_eq(restarts, 0, "set_language did not restart")
	assert_eq(JSONR.at(await state(), "safe_area"), safe_area, "set_virtual_notch was not called")


func test_one_info_log_per_command_without_arguments() -> void:
	assert_true(await start())
	assert_true(QACore.register_command("qa.echo", "Returns its arguments.", PackedStringArray(["a"]), _echo))
	await run_ok("qa.echo", PackedStringArray(["qa_secret_account"]))
	await run("no_such_command", PackedStringArray(["qa_secret_argument"]))
	assert_eq(warns(), 1)
	var text: String = log_text()
	assert_eq(text.count("command qa.echo ok=true"), 1, "one info log of the name and ok")
	assert_eq(text.count("command no_such_command ok=false"), 1, "an unknown command too")
	assert_eq(text.count("qa_secret_account"), 0, "no argument in the logs")
	assert_eq(text.count("qa_secret_argument"), 0, "no argument in the logs")


func test_content_commands() -> void:
	assert_true(await start())
	assert_true(QACore.register_command("qa.echo", "Returns its arguments.", PackedStringArray(["a", "b"]), _echo))
	var result: RunCommandResult = await run("qa.echo", PackedStringArray(["x", "y"]))
	assert_true(result.ok)
	assert_eq(JSONR.text(result.result, "0"), "x", "the result of the handler")
	assert_eq(JSONR.text(result.result, "1"), "y")
	assert_false(QACore.register_command("qa.echo", "Another.", PackedStringArray(), _second), "a second registration")
	assert_eq(errors(), 1)
	result = await run("qa.echo", PackedStringArray(["z", "w"]))
	assert_eq(JSONR.text(result.result, "0"), "z", "the first handler stays")
	result = await run("qa.echo", PackedStringArray(["z"]))
	assert_false(result.ok, "a wrong argument count")
	assert_eq(warns(), 1)
	assert_true(QACore.register_command("qa.refuse", "Fails.", PackedStringArray(), _refuse))
	result = await run("qa.refuse")
	assert_false(result.ok, "a failed handler")
	assert_eq(JSONR.text(result.result, ""), "refused")
	assert_eq(warns(), 1)
	for bad_name: String in ["echo", "qa.Echo", "Qa.echo", "qa.echo.more", "qa."]:
		assert_false(QACore.register_command(bad_name, "", PackedStringArray(), _echo), bad_name)
	assert_eq(errors(), 5, "each name format violation logs an error")


func test_a_handler_result_that_is_not_json_fails() -> void:
	assert_true(await start())
	assert_true(QACore.register_command("qa.plain", "Returns text that is not JSON.", PackedStringArray(), _plain))
	assert_true(QACore.register_command("qa.plain_failure", "Fails with text.", PackedStringArray(), _plain_failure))
	for command_name: String in ["qa.plain", "qa.plain_failure"]:
		var result: RunCommandResult = await run(command_name)
		assert_false(result.ok, command_name)
		assert_eq(JSONR.text(result.result, ""), "the handler result is not JSON", command_name)
		assert_eq(warns(), 1, command_name + ": a warn log")
	assert_eq(errors(), 0)


func test_a_destroyed_handler_or_content_state_callback_is_not_called() -> void:
	assert_true(await start())
	var holder: Holder = Holder.new()
	assert_true(QACore.register_command("qa.held", "Held by an object.", PackedStringArray(), holder.handle))
	QACore.set_content_state(holder.state)
	assert_eq(JSONR.integer(await state(), "content.hp"), 3, "the callback runs while its object lives")
	holder.free()
	for i: int in 2:
		var result: RunCommandResult = await run("qa.held")
		assert_false(result.ok, "the destroyed handler")
		assert_eq(warns(), 1, "the command failure is a warn log")
		assert_eq(JSONR.keys(await state(), "content"), PackedStringArray(), "content is {}")
	assert_eq(errors(), 2, "one error log for the handler and one for the callback")
	var other: Holder = Holder.new()
	QACore.set_content_state(other.state)
	other.free()
	await state()
	assert_eq(errors(), 1, "a new registration logs again")


func test_a_command_over_the_time_limit_fails_and_the_next_starts() -> void:
	assert_true(await start())
	assert_true(QACore.register_command("qa.first", "Waits for the gate.", PackedStringArray(), _first))
	assert_true(QACore.register_command("qa.second", "Records its start.", PackedStringArray(), _second))
	var first: Pending = start_command("qa.first")
	var second: Pending = start_command("qa.second")
	await UnitTestCore.wait_frames(3)
	await advance(COMMAND_TIMEOUT_MS - 1)
	assert_false(first.done, "running at QACore.commandTimeoutMs - 1")
	await advance(1)
	assert_true(first.done, "ended at QACore.commandTimeoutMs")
	assert_false(first.result.ok)
	assert_eq(JSONR.text(first.result.result, ""), "the command went over its time limit")
	assert_eq(warns(), 1)
	await finish(second)
	assert_true(second.result.ok, "the next command starts")
	assert_eq(order, PackedStringArray(["first:start", "second:start"]))
	gate.open()
	await UnitTestCore.wait_frames(1)
	assert_eq(warns(), 0, "the late handler result is dropped")


func test_the_argument_ms_adds_to_the_time_limit() -> void:
	var timeout_ms: int = 1000
	set_int("QACore.commandTimeoutMs", timeout_ms)
	assert_true(await start())
	var limits: Dictionary[String, int] = {
		"drag 1 1 2 2 300": 300, "key A 200": 200, "key A": 0, "capture_video 500": 500, "step 100": 100,
		"tap 1 1": 0, "set_network_delay 700": 0,
	}
	for line: String in limits:
		var parts: PackedStringArray = line.split(" ")
		assert_eq(BUILTINS.extra_limit_ms(parts[0], parts.slice(1)), limits[line], line)
	var ms: int = 1500
	var key: Pending = start_command("key", PackedStringArray(["A", str(ms)]))
	await UnitTestCore.wait_frames(2)
	assert_eq(QACore._running.limit_ms, timeout_ms + ms, "QACore.commandTimeoutMs + ms")
	await advance(ms - 1)
	assert_false(key.done, "past QACore.commandTimeoutMs, inside its limit")
	await advance(1)
	await UnitTestCore.wait_frames(2)
	assert_true(key.done)
	assert_true(key.result.ok, "the key ended after ms, not at QACore.commandTimeoutMs")
	assert_eq(warns(), 0)


func test_list_commands() -> void:
	assert_true(await start())
	assert_true(QACore.register_command("qa.echo", "Returns its arguments.", PackedStringArray(["a", "b"]), _echo))
	var list: String = await run_ok("list_commands")
	var names: PackedStringArray = PackedStringArray()
	for i: int in JSONR.count(list, ""):
		names.append(JSONR.text(list, "%d.name" % i))
	assert_true("get_state" in names and "tap" in names and "set_stats_visible" in names)
	var echo: int = names.find("qa.echo")
	assert_true(echo >= 0, "the content command is listed")
	assert_eq(JSONR.text(list, "%d.description" % echo), "Returns its arguments.")
	assert_eq(JSONR.count(list, "%d.args" % echo), 2)
	var drag: int = names.find("drag")
	assert_eq(JSONR.count(list, "%d.args" % drag), 5, "drag has five arguments")
	for command_name: String in BUILTIN_ARGS:
		var index: int = names.find(command_name)
		assert_true(index >= 0, command_name + " is listed")
		if index < 0:
			continue
		var args: PackedStringArray = PackedStringArray()
		for i: int in JSONR.count(list, "%d.args" % index):
			args.append(JSONR.text(list, "%d.args.%d" % [index, i]))
		assert_eq(args, BUILTIN_ARGS[command_name].split(",", false), command_name + ": the args of the table")
		assert_false(JSONR.text(list, "%d.description" % index).is_empty(), command_name + ": a description")
	var builtins: int = 0
	for command_name: String in names:
		if not command_name.contains("."):
			builtins += 1
	assert_eq(builtins, BUILTIN_ARGS.size(), "every built-in command and no other")
	var tap_anchor: int = names.find("tap_anchor")
	assert_eq(JSONR.at(list, "%d.args" % tap_anchor), JSONR.at("[\"anchor\", \"key\"]", ""), "tap_anchor")


func _first(_args: PackedStringArray) -> RunCommandResult:
	order.append("first:start")
	if not gate.is_open:
		await gate.opened
	order.append("first:end")
	return _ok("")


func _second(_args: PackedStringArray) -> RunCommandResult:
	order.append("second:start")
	return _ok("")


func _echo(args: PackedStringArray) -> RunCommandResult:
	var items: PackedStringArray = PackedStringArray()
	for arg: String in args:
		items.append(JSON.stringify(arg))
	return _ok("[" + ",".join(items) + "]")


func _refuse(_args: PackedStringArray) -> RunCommandResult:
	var result: RunCommandResult = RunCommandResult.new()
	result.result = JSON.stringify("refused")
	return result


func _plain(_args: PackedStringArray) -> RunCommandResult:
	return _ok("done")


func _plain_failure(_args: PackedStringArray) -> RunCommandResult:
	var result: RunCommandResult = RunCommandResult.new()
	result.result = "refused"
	return result


func _ok(json: String) -> RunCommandResult:
	var result: RunCommandResult = RunCommandResult.new()
	result.ok = true
	result.result = json
	return result
