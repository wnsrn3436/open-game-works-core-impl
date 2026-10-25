extends "res://core/qa_core/tests/support/qa_test_case.gd"
## Setup commands and read commands: their target operation, the result and the checks; the restart after the
## response; the app exit after `quit`; the commands of modules outside the module list; the screen commands of a
## headless run.

const BUILTINS := preload("res://core/qa_core/dev/qa_builtins.gd")


## Counts the app exit requests the root passes down.
class CloseWatcher:
	extends Node
	var close_requests: int = 0

	func _notification(what: int) -> void:
		if what == NOTIFICATION_WM_CLOSE_REQUEST:
			close_requests += 1


func test_go_to_scene_and_open_panel() -> void:
	assert_true(await start())
	await run_ok("go_to_scene", PackedStringArray([SCENE_OTHER]))
	assert_eq(SceneCore.current_scene_key(), SCENE_OTHER, "change_scene ran")
	await run_ok("open_panel", PackedStringArray([PANEL]))
	assert_eq(UICore.get_current_panel_key(), PANEL, "open_panel ran")
	assert_eq(JSONR.text(await state(), "panels.0"), PANEL)
	await run_ok("open_panel", PackedStringArray([PANEL_OTHER]))
	assert_eq(UICore.get_panel_stack(), PackedStringArray([PANEL, PANEL_OTHER]), "open_panel keeps the stack")


func test_go_to_scene_gives_the_result_of_change_scene() -> void:
	assert_true(await start(true, false))
	assert_false((await run("go_to_scene", PackedStringArray([SCENE_OTHER]))).ok, "change_scene before the boot change")
	assert_eq(UnitTestCore.check_logs(ERROR, "SceneCore"), 1, "change_scene ran once")
	assert_eq(warns(), 1)


func test_screen_commands() -> void:
	assert_true(await start())
	await run_ok("set_test_screen", PackedStringArray(["1600", "900", "Letterbox"]))
	var json: String = await state()
	assert_eq(JSONR.integer(json, "window_size.0"), 1600, "set_test_screen ran")
	assert_eq(JSONR.integer(json, "window_size.1"), 900)
	assert_eq(ResolutionCore.get_fill_mode(), ResolutionCore.FillMode.LETTERBOX)
	var safe: Rect2 = JSONR.rect(json, "safe_area")
	await run_ok("set_virtual_notch", PackedStringArray(["10", "20", "30", "40"]))
	var notched: Rect2 = JSONR.rect(await state(), "safe_area")
	assert_true(notched.size.x < safe.size.x and notched.size.y < safe.size.y, "set_virtual_notch ran")
	await run_ok("set_virtual_notch", PackedStringArray(["none"]))
	assert_eq(JSONR.rect(await state(), "safe_area"), safe, "clear_virtual_notch ran")
	await run_ok("set_virtual_keyboard", PackedStringArray(["300"]))
	assert_true(SafeAreaCore.get_keyboard_area().size.y > 0.0, "set_virtual_keyboard ran")
	await run_ok("set_virtual_keyboard", PackedStringArray(["none"]))
	assert_eq(SafeAreaCore.get_keyboard_area(), Rect2(), "clear_virtual_keyboard ran")
	for args: PackedStringArray in [
		PackedStringArray(["set_virtual_keyboard", "0"]),
		PackedStringArray(["set_virtual_keyboard", "-1"]),
		PackedStringArray(["set_test_screen", "0", "900", "Crop"]),
		PackedStringArray(["set_test_screen", "1600", "900", "Fit"]),
	]:
		assert_false((await run(args[0], args.slice(1))).ok, " ".join(args))
	assert_eq(SafeAreaCore.get_keyboard_area(), Rect2())
	assert_eq(warns(), 4)


func test_time_scale_and_network_setups() -> void:
	assert_true(await start())
	await run_ok("set_time_scale", PackedStringArray(["1500"]))
	assert_eq(TimeCore.get_time_scale(), 1500, "set_time_scale ran")
	await run_ok("set_network_delay", PackedStringArray(["0"]))
	await run_ok("force_network_failure", PackedStringArray(["timeout"]))
	await run_ok("force_network_failure", PackedStringArray(["connection_failed"]))
	await run_ok("force_network_failure", PackedStringArray(["none"]))
	assert_false((await run("force_network_failure", PackedStringArray(["slow"]))).ok)
	assert_false((await run("set_network_delay", PackedStringArray(["-1"]))).ok)
	assert_eq(warns(), 2)


func test_force_network_failure_fails_the_requests_until_none() -> void:
	assert_true(await start())
	await run_ok("force_network_failure", PackedStringArray(["connection_failed"]))
	var failed: RunCommandResult = await run("set_server_time_offset", PackedStringArray(["5"]))
	assert_false(failed.ok, "the request fails")
	assert_eq(request_count(), 0, "a forced failure does not reach the transport")
	assert_eq(warns(), 1)
	UnitTestCore.check_logs(WARN, "NetworkCore")
	UnitTestCore.check_logs(ERROR, "NetworkCore")
	await run_ok("force_network_failure", PackedStringArray(["none"]))
	add_ok("core/cheat/SetTimeOffset")
	await run_ok("set_server_time_offset", PackedStringArray(["5"]))
	assert_eq(request_count(), 1, "none lets the requests through")


func test_set_network_delay_delays_the_responses_until_0() -> void:
	assert_true(await start())
	var delay_ms: int = 300
	await run_ok("set_network_delay", PackedStringArray([str(delay_ms)]))
	add_ok("core/cheat/SetTimeOffset")
	var delayed: Pending = start_command("set_server_time_offset", PackedStringArray(["5"]))
	await UnitTestCore.wait_frames(6)
	assert_eq(request_count(), 1, "the request went out")
	assert_false(delayed.done, "the response waits for the delay")
	await advance(delay_ms)
	await UnitTestCore.wait_frames(4)
	assert_true(delayed.done, "the response comes after the delay")
	assert_true(delayed.result.ok)
	await run_ok("set_network_delay", PackedStringArray(["0"]))
	add_ok("core/cheat/SetTimeOffset")
	var direct: Pending = start_command("set_server_time_offset", PackedStringArray(["6"]))
	await UnitTestCore.wait_frames(6)
	assert_true(direct.done, "0 takes the delay away")


func test_quit_requests_the_app_exit_after_the_response() -> void:
	assert_true(await start())
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	var auto_accept: bool = tree.auto_accept_quit
	tree.auto_accept_quit = false
	var watcher: CloseWatcher = CloseWatcher.new()
	tree.root.add_child(watcher)
	await run_ok("quit")
	assert_eq(watcher.close_requests, 0, "not before the response")
	await UnitTestCore.wait_frames(1)
	assert_eq(watcher.close_requests, 1, "the OS app exit request after the response")
	await UnitTestCore.wait_frames(2)
	assert_eq(watcher.close_requests, 1, "once")
	tree.root.remove_child(watcher)
	watcher.free()
	tree.auto_accept_quit = auto_accept


func test_commands_of_modules_outside_the_module_list() -> void:
	assert_true(await start())
	var cases: Array[PackedStringArray] = [
		PackedStringArray(["expire_access_token"]),
		PackedStringArray(["set_social_account", "fake_one"]),
		PackedStringArray(["simulate_push", "[push_info]", "opened"]),
		PackedStringArray(["set_push_permission", "Granted"]),
		PackedStringArray(["set_quality_level", "High"]),
		PackedStringArray(["set_text_scale", "1200"]),
		PackedStringArray(["drop_peer", "1"]),
		PackedStringArray(["drop_matchmaker"]),
		PackedStringArray(["leave_match"]),
	]
	for item: PackedStringArray in cases:
		var result: RunCommandResult = await run(item[0], item.slice(1))
		assert_false(result.ok, " ".join(item))
		assert_true(JSONR.text(result.result, "").ends_with("is not in the module list"), " ".join(item))
	assert_eq(warns(), cases.size())


func test_argument_checks_come_before_the_module() -> void:
	assert_true(await start())
	for item: PackedStringArray in [
		PackedStringArray(["set_social_account", "Not-Snake"]),
		PackedStringArray(["simulate_push", "[qa_no_such_id]", "opened"]),
		PackedStringArray(["simulate_push", "[push_info]", "shown"]),
		PackedStringArray(["set_push_permission", "granted"]),
		PackedStringArray(["set_quality_level", "low"]),
		PackedStringArray(["set_text_scale", "999"]),
		PackedStringArray(["drop_peer", "-1"]),
		PackedStringArray(["drop_peer", "others"]),
	]:
		var result: RunCommandResult = await run(item[0], item.slice(1))
		assert_false(result.ok, " ".join(item))
		assert_false(JSONR.text(result.result, "").ends_with("is not in the module list"), " ".join(item) + ": the argument check")
	assert_eq(warns(), 8)


func test_set_language_and_restart_publish_after_the_response() -> void:
	assert_true(await start())
	await run_ok("set_language", PackedStringArray(["zh-Hans"]))
	assert_eq(restarts, 0, "not before the response")
	await UnitTestCore.wait_frames(1)
	assert_eq(restarts, 1, "one RestartRequestedEvent after the response")
	assert_eq(restart_module, "QACore")
	await run_ok("restart")
	assert_eq(restarts, 1)
	await UnitTestCore.wait_frames(1)
	assert_eq(restarts, 2)
	await UnitTestCore.wait_frames(2)
	assert_eq(restarts, 2, "once a command")


func test_get_requests_has_the_requests_that_ended_before_qa_core_init() -> void:
	assert_true(await start(false))
	add_ok("core/cheat/SetTimeOffset")
	var cheat: CoreCheatContract.SetTimeOffsetRequest = CoreCheatContract.SetTimeOffsetRequest.new()
	cheat.offset_ms = 5
	assert_true(await NetworkCoreDev.send_cheat(cheat), "a request that ends before QACore.init")
	assert_true(QACore.init(), "QACore.init")
	var requests: String = await run_ok("get_requests")
	assert_eq(JSONR.count(requests, ""), 1, "NetworkCore keeps the records from its own init")
	assert_eq(JSONR.text(requests, "0.name"), "core/cheat/SetTimeOffset")


func test_read_commands() -> void:
	assert_true(await start())
	add_ok("core/cheat/SetTimeOffset")
	await run_ok("set_server_time_offset", PackedStringArray(["5"]))
	var requests: String = await run_ok("get_requests")
	assert_eq(JSONR.count(requests, ""), 1)
	assert_eq(JSONR.text(requests, "0.name"), "core/cheat/SetTimeOffset")
	assert_eq(JSONR.text(requests, "0.kind"), "Interaction")
	assert_true(JSONR.boolean(requests, "0.ok"))
	assert_eq(JSONR.integer(requests, "0.error_code"), 0)
	var sent: PackedByteArray = UnitTestCore.received_requests()[0].body
	assert_eq(JSONR.text(requests, "0.request"), Marshalls.raw_to_base64(sent), "the request body in base64")
	var all: String = await run_ok("get_user_state", PackedStringArray(["all"]))
	assert_eq(JSONR.at(all, ""), JSONR.at(UserStateCoreDev.export_json(), ""), "export_json of every kind")
	var one: String = await run_ok("get_user_state", PackedStringArray(["ItemBalanceUserState"]))
	assert_eq(JSONR.at(one, ""), JSONR.at(UserStateCoreDev.export_json(CoreContract.ItemBalanceUserState), ""))
	assert_false((await run("get_user_state", PackedStringArray(["NoSuchUserState"]))).ok, "an unknown kind")
	assert_eq(warns(), 1)
	var resources: String = await run_ok("get_resources")
	var loaded: Dictionary[String, int] = ResourceCoreDev.list_loaded_resources()
	assert_eq(JSONR.count(resources, "resources"), loaded.size())
	assert_eq(JSONR.count(resources, "scopes"), ResourceCoreDev.list_scopes().size())
	assert_eq(JSONR.text(resources, "scopes.0.kind"), "Global")
	var sound: String = await run_ok("get_sound")
	assert_eq(JSONR.text(sound, "bgm"), SoundCore.get_bgm_key())
	assert_eq(JSONR.count(sound, "playing"), 0)
	assert_eq(JSONR.count(sound, "haptics"), 0)
	var stats: String = await run_ok("get_stats")
	for field: String in ["fps", "frame_ms", "static_memory_bytes", "video_memory_bytes", "draw_calls", "primitives",
			"object_count", "last_scene_load_ms", "boot_ms", "quality_level"]:
		assert_true(JSONR.has(stats, field), field)
	assert_eq(JSONR.text(stats, "quality_level"), "", "no QualityCore")
	var logs: String = await run_ok("extract_logs")
	assert_eq(JSONR.count(logs, ""), LogCoreDev.list_log_files().size(), "one item a log file")
	var found: bool = false
	for i: int in JSONR.count(logs, ""):
		assert_true(JSONR.text(logs, "%d.path" % i).begins_with("log/"))
		found = found or JSONR.text(logs, "%d.content" % i).contains("command get_stats ok=true")
	assert_true(found, "the log file content")


func test_extract_logs_from_byte_offsets() -> void:
	assert_true(await start())
	LogCore.log_info("QACoreTest", "multi-byte 로그 ✓")
	var all: String = await run_ok("extract_logs", PackedStringArray(["{}"]))
	var files: int = JSONR.count(all, "")
	assert_true(files > 0, "a log file")
	for i: int in files:
		assert_eq(JSONR.integer(all, "%d.offset" % i), 0, "no offset reads from 0")
		assert_eq(JSONR.integer(all, "%d.size" % i), JSONR.text(all, "%d.content" % i).to_utf8_buffer().size(), "byte size")
	var last: int = files - 1
	var path: String = JSONR.text(all, "%d.path" % last)
	var size: int = JSONR.integer(all, "%d.size" % last)
	assert_true(JSONR.text(all, "%d.content" % last).contains("multi-byte 로그 ✓"))
	var since: String = await run_ok("extract_logs", PackedStringArray([JSON.stringify({path: size, "log/none.txt": 3})]))
	assert_eq(JSONR.count(since, ""), files, "one item a log file")
	for i: int in last:
		assert_eq(JSONR.integer(since, "%d.offset" % i), 0, "a path without an offset reads from 0")
	assert_eq(JSONR.text(since, "%d.path" % last), path)
	assert_eq(JSONR.integer(since, "%d.offset" % last), size, "reads from the offset")
	var content: String = JSONR.text(since, "%d.content" % last)
	var bytes: PackedByteArray = FileAccess.get_file_as_bytes(CoreBuildInfo.storage_root + path)
	assert_eq(JSONR.integer(since, "%d.size" % last), size + content.to_utf8_buffer().size(), "size is the file byte size")
	assert_eq(content.to_utf8_buffer(), bytes.slice(size, size + content.to_utf8_buffer().size()), "the bytes from the offset")
	assert_true(content.contains("command extract_logs ok=true"), "only the lines after the offset")
	assert_false(content.contains("multi-byte"), "no line before the offset")
	var shorter: String = await run_ok("extract_logs", PackedStringArray([JSON.stringify({path: 1 << 40})]))
	assert_eq(JSONR.integer(shorter, "%d.offset" % last), 0, "an offset past the end reads from 0")
	assert_true(JSONR.text(shorter, "%d.content" % last).contains("multi-byte 로그 ✓"))
	for i: int in JSONR.count(since, ""):
		assert_ne(JSONR.text(since, "%d.path" % i), "log/none.txt", "a path that is not a log file is not read")
	for arg: String in ["[0]", "[]", "log", "{\"%s\": -1}" % path, "{\"%s\": 1.5}" % path, "{\"%s\": \"0\"}" % path]:
		assert_false((await run("extract_logs", PackedStringArray([arg]))).ok, arg)
	assert_false((await run("extract_logs", PackedStringArray(["{}", "{}"]))).ok, "two arguments")
	assert_eq(warns(), 7)


func test_extract_logs_moves_off_a_continuation_byte_and_replaces_bad_bytes() -> void:
	assert_true(await start())
	var paths: PackedStringArray = LogCoreDev.list_log_files()
	assert_false(paths.is_empty(), "a log file")
	var path: String = paths[paths.size() - 1]
	var file: FileAccess = FileAccess.open(CoreBuildInfo.storage_root + path, FileAccess.READ_WRITE)
	assert_not_null(file)
	file.seek_end()
	var start_at: int = file.get_position()
	# `a`, `한` (3 bytes), `b`, then 0xFF, which no UTF-8 sequence has, and a line end.
	file.store_buffer(PackedByteArray([0x61, 0xED, 0x95, 0x9C, 0x62, 0xFF, 0x0A]))
	file.close()
	var logs: String = await run_ok("extract_logs", PackedStringArray([JSON.stringify({path: start_at + 2})]))
	var last: int = JSONR.count(logs, "") - 1
	assert_eq(JSONR.text(logs, "%d.path" % last), path)
	assert_eq(JSONR.integer(logs, "%d.offset" % last), start_at + 4, "the offset moves to the byte after 한")
	assert_true(JSONR.text(logs, "%d.content" % last).begins_with("b\uFFFD\n"), "b, then U+FFFD for the byte 0xFF")
	var whole: String = await run_ok("extract_logs", PackedStringArray([JSON.stringify({path: start_at})]))
	assert_true(JSONR.text(whole, "%d.content" % last).begins_with("a한b\uFFFD\n"), "from a byte that begins a character")
	assert_eq(BUILTINS.utf8_text(PackedByteArray([0x61, 0xE2, 0x82, 0x62, 0xC0, 0x80, 0xED, 0xA0, 0x80])),
		"a\uFFFD\uFFFDb" + "\uFFFD".repeat(5), "one U+FFFD a byte of a cut, overlong or surrogate sequence")
	assert_eq(errors() + warns(), 0)


func test_extract_logs_reads_a_byte_0x00_as_u0000() -> void:
	assert_true(await start())
	var paths: PackedStringArray = LogCoreDev.list_log_files()
	assert_false(paths.is_empty(), "a log file")
	var path: String = paths[paths.size() - 1]
	var file: FileAccess = FileAccess.open(CoreBuildInfo.storage_root + path, FileAccess.READ_WRITE)
	assert_not_null(file)
	file.seek_end()
	var start_at: int = file.get_position()
	file.store_buffer(PackedByteArray([0x61, 0x00, 0x62, 0x0A]))
	file.close()
	var logs: String = await run_ok("extract_logs", PackedStringArray([JSON.stringify({path: start_at})]))
	assert_true(logs.contains("\"content\":\"a\\u0000b\\n"), "U+0000 for the byte 0x00: " + logs.right(200))
	assert_eq(BUILTINS.utf8_json(PackedByteArray([0x00, 0xE2, 0x82, 0x00, 0x22, 0x00])),
		"\"\\u0000\uFFFD\uFFFD\\u0000\\\"\\u0000\"", "U+0000 at the ends and next to a cut sequence")
	assert_eq(BUILTINS.utf8_json(PackedByteArray()), "\"\"")
	assert_eq(errors() + warns(), 0)


func test_screen_commands_of_a_headless_run() -> void:
	if not QACore.is_headless():
		pass_test("not a headless run")
		return
	assert_true(await start())
	assert_false((await run("capture_screen")).ok, "capture_screen in a headless run")
	assert_false((await run("capture_video", PackedStringArray(["1000"]))).ok, "capture_video in a headless run")
	assert_false((await run("capture_screen", PackedStringArray(["jpg"]))).ok, "capture_screen jpg in a headless run")
	assert_eq(warns(), 3)
	var stats: String = await run_ok("get_stats")
	for field: String in ["video_memory_bytes", "draw_calls", "primitives"]:
		assert_eq(JSONR.integer(stats, field), 0, field + " of a headless run")
