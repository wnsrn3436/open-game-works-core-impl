extends "res://core/qa_core/tests/support/qa_test_case.gd"
## QAState: values before they are decided, the fields of modules outside the module list, a boot, invariants,
## softlock, the content state and step mode.

const ENTRY := preload("res://core/qa_core/tests/support/qa_test_entry.gd")
const ADVANCE: StringName = &"cutscene_advance"
const OPTIONAL_FIELDS: PackedStringArray = [
	"cutscene_playing", "tutorial", "completed_tutorials", "match_state", "room_code", "room_mode_id", "room_mode",
]


func test_state_before_its_values_are_decided() -> void:
	ResourceCoreDev.set_test_key_list(resource_keys())
	var started: bool = (
		LogCore.init() and EventCore.init() and TimeCore.init() and LocalDataCore.init() and ResourceCore.init()
		and PoolCore.init() and DataCore.init() and UserStateCore.init() and ResolutionCore.init()
		and SafeAreaCore.init() and InputBlockCore.init() and InputCore.init() and LocalizationCore.init()
		and SoundCore.init() and TweenCore.init() and UICore.init() and ScreenEffectCore.init() and MessageCore.init()
		and NetworkCore.init() and SceneCore.init() and QACore.init()
	)
	assert_true(started, "init without data")
	var json: String = await state()
	assert_eq(JSONR.text(json, "data_version"), "")
	assert_eq(JSONR.text(json, "language"), "")
	assert_eq(JSONR.integer(json, "user_id"), 0)
	assert_eq(JSONR.integer(json, "server_time"), 0)
	assert_eq(JSONR.text(json, "boot_stage"), "None")
	assert_eq(JSONR.text(json, "environment"), "")
	for field: String in OPTIONAL_FIELDS:
		assert_true(JSONR.is_null(json, field), field + " of a module outside the module list is null")
	assert_eq(JSONR.at(json, "content"), "{}")
	assert_eq(JSONR.count(json, "invariant_failures"), 0)
	assert_true(JSONR.is_null(json, "softlock"))
	assert_true(await DataCore.load(null))
	json = await state()
	assert_eq(JSONR.text(json, "data_version"), DataCore.get_data_version(), "data_version after the load")
	var now: int = TimeCore.get_monotonic_time()
	TimeCore.sync_server_time(SERVER_TIME, now, now)
	json = await state()
	assert_eq(JSONR.integer(json, "server_time"), TimeCore.get_server_time(), "server_time after the sync")
	assert_eq(JSONR.integer(json, "time_scale"), 1000)
	assert_eq(JSONR.count(json, "window_size"), 2)


func test_state_through_a_boot() -> void:
	set_string("titleScene", SCENE)
	set_string("firstScene", SCENE_OTHER)
	ResourceCoreDev.set_test_key_list(resource_keys())
	var entry: ENTRY = ENTRY.new()
	UnitTestCore.start_test_boot(entry, boot_modules())
	var stages: PackedStringArray = PackedStringArray()
	# The boot gets to Done through threaded loads, so Done ends the loop, not a frame count. A shutdown of the boot, as
	# at the test time limit, ends it too.
	while not (BootstrapCore.boot_stage() == BootstrapCore.BootStage.DONE and not stages.is_empty()):
		if BootstrapCore.boot_stage() == BootstrapCore.BootStage.NONE:
			break
		if QACore.is_initialized():
			var json: String = await state()
			var stage: String = JSONR.text(json, "boot_stage")
			if not stage in stages:
				stages.append(stage)
			var before_prepare: bool = stage == "InitModules" or stage == "LoadData"
			if before_prepare:
				assert_eq(JSONR.text(json, "language"), "", "no language before Prepare")
			if stage == "InitModules":
				assert_eq(JSONR.text(json, "data_version"), "", "no data version before LoadData")
			assert_eq(JSONR.integer(json, "user_id"), 0, "not logged in")
		await advance(16, 1)
	assert_true(stages.size() >= 2, "get_state worked through the boot stages")
	var done: String = await state()
	assert_eq(JSONR.text(done, "boot_stage"), "Done")
	assert_eq(JSONR.text(done, "language"), LocalizationCore.get_language_code(), "the language after Prepare")
	assert_eq(JSONR.text(done, "scene_key"), SCENE_OTHER)
	assert_eq(JSONR.text(done, "environment"), "LOCAL")


func test_invariants() -> void:
	assert_true(await start())
	assert_true(QACore.register_invariant("qa.holds", _holds))
	assert_true(QACore.register_invariant("qa.broken", _broken))
	await UnitTestCore.wait_frames(3)
	var json: String = await state()
	assert_eq(JSONR.count(json, "invariant_failures"), 1)
	assert_eq(JSONR.text(json, "invariant_failures.0"), "qa.broken")
	assert_eq(errors(), 1, "one error log for the name")
	await UnitTestCore.wait_frames(3)
	assert_eq(errors(), 0, "no second error log")
	for bad_name: String in ["broken", "qa.Broken", "a.b.c"]:
		assert_false(QACore.register_invariant(bad_name, _holds), bad_name)
	assert_false(QACore.register_invariant("qa.broken", _holds), "a second registration")
	assert_eq(errors(), 4)


func test_softlock_of_a_block() -> void:
	assert_true(await start())
	var token: int = InputBlockCore.block("cutscene")
	await advance(SOFTLOCK_BLOCK_MS - 1)
	assert_true(JSONR.is_null(await state(), "softlock"), "before QACore.softlockBlockMs")
	await advance(1)
	var json: String = await state()
	assert_eq(JSONR.text(json, "softlock.kind"), "Block")
	assert_eq(JSONR.text(json, "softlock.reason"), "cutscene")
	assert_eq(JSONR.integer(json, "softlock.elapsed_ms"), SOFTLOCK_BLOCK_MS)
	TimeCoreDev.set_step_mode(true)
	assert_true(JSONR.is_null(await state(), "softlock"), "null in step mode")
	TimeCoreDev.set_step_mode(false)
	InputBlockCore.unblock(token)


func test_softlock_of_no_response() -> void:
	assert_true(await start())
	for i: int in SOFTLOCK_INPUTS - 1:
		await run_ok("key", PackedStringArray(["Space"]))
	await advance(SOFTLOCK_NO_RESPONSE_MS)
	assert_true(JSONR.is_null(await state(), "softlock"), "one input short")
	await run_ok("key", PackedStringArray(["Space"]))
	var json: String = await state()
	assert_eq(JSONR.text(json, "softlock.kind"), "NoResponse")
	assert_true(JSONR.integer(json, "softlock.elapsed_ms") >= SOFTLOCK_NO_RESPONSE_MS)
	await run_ok("set_step_mode", PackedStringArray(["on"]))
	assert_true(JSONR.is_null(await state(), "softlock"), "null in step mode")
	await run_ok("set_step_mode", PackedStringArray(["off"]))


func test_no_response_from_init_without_a_state_event() -> void:
	assert_true(await start())
	await advance(SOFTLOCK_NO_RESPONSE_MS - 500)
	await run_ok("clear_telemetry")
	for i: int in SOFTLOCK_INPUTS:
		await run_ok("key", PackedStringArray(["Space"]))
	await advance(499)
	assert_true(JSONR.is_null(await state(), "softlock"), "1 ms short of QACore.softlockNoResponseMs since init")
	await advance(1)
	var json: String = await state()
	assert_eq(JSONR.text(json, "softlock.kind"), "NoResponse", "clear_telemetry does not move the start")
	assert_eq(JSONR.integer(json, "softlock.elapsed_ms"), SOFTLOCK_NO_RESPONSE_MS, "the elapsed time since init")


func test_content_state() -> void:
	assert_true(await start())
	QACore.set_content_state(_content)
	var json: String = await state()
	assert_eq(JSONR.integer(json, "content.hp"), 3)
	assert_eq(JSONR.text(json, "content.stage"), "[stage_1]")
	QACore.set_content_state(_later_content)
	assert_eq(JSONR.integer(await state(), "content.hp"), 9, "a second set_content_state replaces the callback")
	assert_eq(errors(), 0)
	QACore.set_content_state(_not_json)
	assert_eq(JSONR.at(await state(), "content"), "{}", "a callback that gives no JSON object")
	assert_eq(JSONR.at(await state(), "content"), "{}")
	assert_eq(errors(), 1, "one error log for the callback")
	QACore.set_content_state(_array)
	assert_eq(JSONR.at(await state(), "content"), "{}", "a callback that gives a JSON array")
	assert_eq(errors(), 1, "one error log for the new callback")
	QACore.set_content_state(_number)
	assert_eq(JSONR.at(await state(), "content"), "{}", "a callback that gives no text")
	assert_eq(JSONR.at(await state(), "content"), "{}")
	assert_eq(errors(), 1, "one error log for the new callback")


func test_step() -> void:
	assert_true(await start())
	assert_false((await run("step", PackedStringArray(["100"]))).ok, "not in step mode")
	await run_ok("set_step_mode", PackedStringArray(["on"]))
	var game_time: int = TimeCore.get_game_time()
	var result: RunCommandResult = await finish(start_command("step", PackedStringArray(["100"])), 16)
	assert_true(result.ok)
	assert_eq(TimeCore.get_game_time() - game_time, 100, "the game time moved by ms")
	var json: String = await state()
	assert_true(JSONR.boolean(json, "step_mode"))
	assert_eq(JSONR.integer(json, "step_budget_ms"), 0)
	assert_false((await run("step", PackedStringArray(["0"]))).ok)
	assert_false((await run("step", PackedStringArray([str(STEP_MAX_MS + 1)]))).ok)
	assert_eq(warns(), 3)
	await run_ok("set_step_mode", PackedStringArray(["off"]))


func test_step_time_limit_follows_the_time_scale() -> void:
	assert_true(await start())
	await run_ok("set_step_mode", PackedStringArray(["on"]))
	await run_ok("set_time_scale", PackedStringArray(["500"]))
	var game_time: int = TimeCore.get_game_time()
	var step: Pending = start_command("step", PackedStringArray(["100"]))
	await UnitTestCore.wait_frames(2)
	assert_eq(QACore._running.limit_ms if QACore._running != null else -1, COMMAND_TIMEOUT_MS + 200,
		"QACore.commandTimeoutMs + ms × 1000 ÷ 500")
	var result: RunCommandResult = await finish(step, 16)
	assert_true(result.ok)
	assert_eq(TimeCore.get_game_time() - game_time, 100)
	await run_ok("set_time_scale", PackedStringArray(["1000"]))
	await run_ok("set_step_mode", PackedStringArray(["off"]))


func test_step_while_paused() -> void:
	assert_true(await start())
	await run_ok("set_step_mode", PackedStringArray(["on"]))
	TimeCore.set_paused(true)
	var result: RunCommandResult = await run("step", PackedStringArray(["50"]))
	assert_false(result.ok)
	assert_eq(JSONR.text(result.result, ""), "game time is paused")
	assert_eq(JSONR.integer(await state(), "step_budget_ms"), 0, "no budget added")
	TimeCore.set_paused(false)
	var game_time: int = TimeCore.get_game_time()
	for i: int in 5:
		await advance(16, 1)
	assert_eq(TimeCore.get_game_time(), game_time, "the game time stands still after the pause")
	assert_eq(warns(), 1)
	await run_ok("set_step_mode", PackedStringArray(["off"]))


func test_a_pause_during_a_step_fails_it_by_the_next_frame() -> void:
	assert_true(await start())
	await run_ok("set_step_mode", PackedStringArray(["on"]))
	var step: Pending = start_command("step", PackedStringArray(["1000"]))
	var ended_frames: Array[int] = []
	step.finished.connect(func() -> void: ended_frames.append(Engine.get_process_frames()))
	for i: int in 3:
		await advance(16, 1)
	assert_true(TimeCoreDev.get_step_budget() > 0, "the step runs")
	var game_time: int = TimeCore.get_game_time()
	TimeCore.set_paused(true)
	var paused_frame: int = Engine.get_process_frames()
	var result: RunCommandResult = await finish(step, 16, 3)
	assert_false(result.ok)
	assert_eq(JSONR.text(result.result, ""), "game time is paused", "fails before the command time limit")
	assert_eq(ended_frames.size(), 1)
	if ended_frames.size() == 1:
		assert_true(ended_frames[0] - paused_frame <= 1, "no later than the frame after the pause")
	assert_eq(TimeCore.get_game_time(), game_time, "the game time of the step did not pass")
	assert_eq(TimeCoreDev.get_step_budget(), 0, "the budget left is 0 when the step ends")
	assert_eq(JSONR.integer(await state(), "step_budget_ms"), 0)
	assert_true(TimeCoreDev.is_step_mode(), "step mode stays on")
	TimeCore.set_paused(false)
	for i: int in 5:
		await advance(16, 1)
	assert_eq(TimeCore.get_game_time(), game_time, "no budget runs after the pause")
	assert_eq(warns(), 1)
	await run_ok("set_step_mode", PackedStringArray(["off"]))


func test_a_step_whose_budget_ran_out_in_the_frame_of_a_pause_succeeds() -> void:
	assert_true(await start())
	await run_ok("set_step_mode", PackedStringArray(["on"]))
	var step: Pending = start_command("step", PackedStringArray(["100"]))
	for i: int in 5:
		if TimeCoreDev.get_step_budget() > 0:
			break
		await UnitTestCore.wait_frames(1)
	assert_eq(TimeCoreDev.get_step_budget(), 100, "the step added its budget")
	var game_time: int = TimeCore.get_game_time()
	UnitTestCore.advance_clock(100, false)
	TimeCore.set_paused(true)
	assert_eq(TimeCoreDev.get_step_budget(), 0, "the budget ran out in the frame of the pause")
	var result: RunCommandResult = await finish(step, 16, 3)
	assert_true(result.ok, result.result)
	assert_eq(TimeCore.get_game_time() - game_time, 100)
	assert_eq(JSONR.integer(await state(), "step_budget_ms"), 0)
	assert_eq(warns(), 0)
	TimeCore.set_paused(false)
	await run_ok("set_step_mode", PackedStringArray(["off"]))


func test_step_mode_holds_the_block_time() -> void:
	set_int("InputBlockCore.maxDurationMs", 2500)
	assert_true(await start())
	var token: int = InputBlockCore.block("ui")
	await run_ok("set_step_mode", PackedStringArray(["on"]))
	var blocks: Array[ActiveBlockInfo] = []
	blocks.resize(4)
	assert_eq(InputBlockCoreDev.list_active(blocks), 1)
	var elapsed: int = blocks[0].elapsed_ms
	await advance(3000)
	assert_true(InputBlockCore.is_active(token), "no forced release in step mode")
	assert_eq(InputBlockCoreDev.list_active(blocks), 1)
	assert_eq(blocks[0].elapsed_ms, elapsed, "the block elapsed time stands still")
	await run_ok("set_step_mode", PackedStringArray(["off"]))
	InputBlockCore.unblock(token)


## Module list of the boot: the modules QACore uses without `AuthCore` and `GameUpdateCore`, then QACore.
func boot_modules() -> Array[CoreModuleEntry]:
	var list: Array[CoreModuleEntry] = [
		_entry("LogCore", LogCore.init, LogCore.release, LogCore.is_initialized),
		_entry("EventCore", EventCore.init, EventCore.release, EventCore.is_initialized),
		_entry("TimeCore", TimeCore.init, TimeCore.release, TimeCore.is_initialized),
		_entry("LocalDataCore", LocalDataCore.init, LocalDataCore.release, LocalDataCore.is_initialized),
		_entry("ResourceCore", ResourceCore.init, ResourceCore.release, ResourceCore.is_initialized),
		_entry("PoolCore", PoolCore.init, PoolCore.release, PoolCore.is_initialized),
		_entry("DataCore", DataCore.init, DataCore.release, DataCore.is_initialized),
		_entry("UserStateCore", UserStateCore.init, UserStateCore.release, UserStateCore.is_initialized),
		_entry("ResolutionCore", ResolutionCore.init, ResolutionCore.release, ResolutionCore.is_initialized),
		_entry("SafeAreaCore", SafeAreaCore.init, SafeAreaCore.release, SafeAreaCore.is_initialized),
		_entry("InputBlockCore", InputBlockCore.init, InputBlockCore.release, InputBlockCore.is_initialized),
		_entry("InputCore", InputCore.init, InputCore.release, InputCore.is_initialized),
		_entry("LocalizationCore", LocalizationCore.init, LocalizationCore.release, LocalizationCore.is_initialized),
		_entry("SoundCore", SoundCore.init, SoundCore.release, SoundCore.is_initialized),
		_entry("TweenCore", TweenCore.init, TweenCore.release, TweenCore.is_initialized),
		_entry("UICore", UICore.init, UICore.release, UICore.is_initialized),
		_entry("ScreenEffectCore", ScreenEffectCore.init, ScreenEffectCore.release, ScreenEffectCore.is_initialized),
		_entry("MessageCore", MessageCore.init, MessageCore.release, MessageCore.is_initialized),
		_entry("NetworkCore", NetworkCore.init, NetworkCore.release, NetworkCore.is_initialized),
		_entry("SceneCore", SceneCore.init, SceneCore.release, SceneCore.is_initialized),
		_entry("QACore", QACore.init, QACore.release, QACore.is_initialized),
	]
	return list


func _entry(module_name: String, init: Callable, release: Callable, is_initialized: Callable) -> CoreModuleEntry:
	var item: CoreModuleEntry = CoreModuleEntry.new()
	item.name = module_name
	item.init = init
	item.release = release
	item.is_initialized = is_initialized
	return item


func _holds() -> bool:
	return true


func _broken() -> bool:
	return false


func _content() -> String:
	return "{\"hp\": 3, \"stage\": \"[stage_1]\"}"


func _not_json() -> String:
	return "[1, 2"


func _later_content() -> String:
	return "{\"hp\": 9}"


func _array() -> String:
	return "[1, 2]"


func _number() -> int:
	return 5
