class_name UnitTestCore
extends RefCounted
## Conventions and run of the core tests and the client regression tests: the test setup, the fake network and the
## test clock, real input, loopback HTTP servers, WebSocket relays, page input of the browser run, the fake realtime
## transport, and the result file. The module is DEV code. The GUT pre-run hook `gut_pre_run.gd` starts a run and the
## post-run hook `gut_post_run.gd` ends it. `UnitTestCase` does the test setup and the checks at the end of a test.

const _TAG: String = "UnitTestCore"
const _NODE_SCRIPT := preload("res://core/unit_test_core/dev/unit_test_core_node.gd")
const _RUN := preload("res://core/unit_test_core/dev/unit_test_run.gd")
const _STATE := preload("res://core/unit_test_core/dev/unit_test_state.gd")
const _CONFIG := preload("res://core/unit_test_core/dev/unit_test_config.gd")
const _LOG := preload("res://core/unit_test_core/dev/unit_test_log.gd")
const _RESULT := preload("res://core/unit_test_core/dev/unit_test_result.gd")
const _REPLY := preload("res://core/unit_test_core/dev/unit_test_http_reply.gd")
const _FAKE_NETWORK := preload("res://core/unit_test_core/dev/unit_test_fake_network.gd")
const _SCRIPT_LOGGER := preload("res://core/unit_test_core/dev/unit_test_script_logger.gd")

const _TEST_TIME_LIMIT_KEY: String = "UnitTestCore.testTimeLimitMs"
const _RUN_TIME_LIMIT_KEY: String = "UnitTestCore.runTimeLimitMs"
## Device time the test clock starts from (`client-core` Godot `## engine behavior`).
const _CLOCK_START_DEVICE_MS: int = 1700000000000
const _DEFAULT_SERVER_URL: String = "http://127.0.0.1"
## Name of the core node of `EventCore`, a child of the tree root. The node leaves the tree in `EventCore.release`.
const _EVENT_CORE_NODE_NAME: StringName = &"EventCore"
const _KIND_CORE: String = "core"
const _KIND_REGRESSION: String = "regression"
const _ENGINE: String = "godot"
const _STORAGE_ROOT: String = "user://"
const _RENDER_PREFIX: String = "test_render_"
const _RENDER_SKIP: String = "render test"
## GUT test function prefix.
const _TEST_PREFIX: String = "test_"
## Test run config keys.
const _CONFIG_RUN_ID: String = "ogw_run_id"
const _CONFIG_TEST_HOST: String = "ogw_test_host"
const _CONFIG_CORE_FIXTURES: String = "ogw_core_fixture_dir"
const _CONFIG_SHARED_FIXTURES: String = "ogw_shared_fixture_dir"
const _GCONFIG_ARG: String = "-gconfig="
## Name of the `CanvasLayer` of the GUT runner scene that holds the GUT runner GUI.
const _GUT_LAYER_NAME: StringName = &"GutLayer"
## Engine output line that ends the output of a run, after its release signal: `<prefix><run ID>`.
const _RELEASED_LINE_PREFIX: String = "UnitTestCore released run "
## GUT test name filter that no test function name contains: GUT runs no more test of a run that ended early.
const _NO_TEST_NAME: String = " no test after the run ended "
## Core settings type file (`client-core` Godot `## module`): the spec `## settings` type string by key.
const _SETTINGS_TYPES_PATH: String = "res://generated/core_settings_types.json"
## Spec settings types other than `array<T>`, without the `?` of a type whose value may be `null`.
const _SCALAR_SETTINGS_TYPES: PackedStringArray = ["integer", "number", "string", "boolean", "object"]
const _ARRAY_PREFIX: String = "array<"

static var _is_initialized: bool = false
static var _node: _NODE_SCRIPT = null
static var _test_time_limit_ms: int = 0
static var _run_time_limit_ms: int = 0
## Run of the GUT run, or a nested run of a UnitTestCore core test over it.
static var _run: _RUN = null
## Runs under the nested run, the GUT run first.
static var _outer_runs: Array[_RUN] = []
## Whether a test setup put its test replacements into the modules since `init`; `release` takes them back.
static var _replaced: bool = false
## Logger that counts the engine script runtime errors from `init` to `release`.
static var _script_logger: _SCRIPT_LOGGER = null
## The GUT run that ended before its last test, until the next `init`. Its post-run hook waits for its release signal.
static var _early_end: _RUN = null
## Quits the engine with an exit code when a GUT run ended early. Empty quits through the `SceneTree`. The
## UnitTestCore core tests put a recorder here, so a run they start can end early without ending the test run.
static var _quit: Callable = Callable()
## The core settings type file read at `init`: the spec `## settings` type string by key. A key not here does not exist
## for `set_test_settings` and `set_invalid_test_settings`.
static var _settings_types: Dictionary[String, String] = {}


# --- lifecycle ---


## Reads the settings, makes the core node, starts an empty run and records the app storage files. Only the test
## run calls it, from the pre-run hook.
static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init: already initialized")
		return false
	var failure: String = _init_failure()
	if not failure.is_empty():
		LogCore.log_error(_TAG, "init: " + failure)
		return false
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	_early_end = null
	_test_time_limit_ms = CoreSettings.get_int(_TEST_TIME_LIMIT_KEY)
	_run_time_limit_ms = CoreSettings.get_int(_RUN_TIME_LIMIT_KEY)
	_settings_types = _read_settings_types()
	_script_logger = _SCRIPT_LOGGER.new()
	OS.add_logger(_script_logger)
	var node: _NODE_SCRIPT = _NODE_SCRIPT.new()
	node.name = _TAG
	node.process_mode = Node.PROCESS_MODE_ALWAYS
	tree.root.add_child(node)
	_node = node
	_run = _new_run(_CONFIG.new())
	if tree.node_removed.connect(_on_node_removed) != OK:
		LogCore.log_error(_TAG, "init: could not follow the nodes removed from the tree")
	_is_initialized = true
	return true


## Ends the waits of the run, takes back the test replacements of the last test setup, deletes the app storage files
## that were not there at `init`, and removes the core node.
static func release() -> void:
	if not _is_initialized:
		return
	var node: _NODE_SCRIPT = _node
	_cleanup()
	if is_instance_valid(node):
		node.released = true
		if node.get_parent() != null:
			node.get_parent().remove_child(node)
		node.queue_free()


static func is_initialized() -> bool:
	return _is_initialized


## Why `init` fails now, other than being initialized: a time limit setting that is missing, not an integer or
## negative, or a main loop that is not a `SceneTree`. Empty when `init` can start.
static func _init_failure() -> String:
	if not CoreSettings.has_int(_TEST_TIME_LIMIT_KEY) or not CoreSettings.has_int(_RUN_TIME_LIMIT_KEY):
		return "core settings %s and %s must be integers" % [_TEST_TIME_LIMIT_KEY, _RUN_TIME_LIMIT_KEY]
	if CoreSettings.get_int(_TEST_TIME_LIMIT_KEY) < 0 or CoreSettings.get_int(_RUN_TIME_LIMIT_KEY) < 0:
		return "a time limit is negative"
	if not Engine.get_main_loop() is SceneTree:
		return "the main loop is not a SceneTree"
	return ""


## The core node left the tree outside `release`: the same cleanup without `remove_child`.
static func _on_node_exit(node: Node) -> void:
	if not _is_initialized or node != _node:
		return
	_cleanup()
	node.queue_free()


static func _cleanup() -> void:
	var node: _NODE_SCRIPT = _node
	var root: _RUN = _root_run()
	var runs: Array[_RUN] = _outer_runs.duplicate()
	runs.append(_run)
	_is_initialized = false
	_node = null
	_test_time_limit_ms = 0
	_run_time_limit_ms = 0
	_settings_types = {}
	_run = null
	_outer_runs = []
	if _script_logger != null:
		OS.remove_logger(_script_logger)
		_script_logger = null
	if _replaced:
		_replaced = false
		_unregister_replacements()
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree != null and tree.node_removed.is_connected(_on_node_removed):
		tree.node_removed.disconnect(_on_node_removed)
	for run: _RUN in runs:
		run.ended = true
		if run.test != null:
			_wake(run.test)
	if is_instance_valid(node):
		node.fail_all()
	if root != null:
		_delete_new_files(root.storage_files)


# --- run ---


## Reads the test run config: the `-gconfig=` file of a native run, the page URL query of a browser run.
# ogw:input_boundary
static func _read_run_config() -> _CONFIG:
	var values: Dictionary[String, String] = {}
	if OS.get_name() == "Web":
		var search: Variant = JavaScriptBridge.eval("window.location.search", true)
		if search is String:
			var query: String = search
			for pair: String in query.trim_prefix("?").split("&", false):
				var at: int = pair.find("=")
				if at > 0:
					values[pair.substr(0, at).uri_decode()] = pair.substr(at + 1).replace("+", " ").uri_decode()
	else:
		var path: String = ""
		for arg: String in OS.get_cmdline_args():
			if arg.begins_with(_GCONFIG_ARG):
				path = arg.substr(_GCONFIG_ARG.length())
		if not path.is_empty() and FileAccess.file_exists(path):
			var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
			if parsed is Dictionary:
				var object: Dictionary = parsed
				for key: Variant in object.keys():
					var value: Variant = object[key]
					if key is String and value is String:
						values[str(key)] = str(value)
	var config: _CONFIG = _CONFIG.new()
	config.run_id = values.get(_CONFIG_RUN_ID, "")
	config.test_host = values.get(_CONFIG_TEST_HOST, "")
	config.has_core_fixture_dir = values.has(_CONFIG_CORE_FIXTURES)
	config.core_fixture_dir = values.get(_CONFIG_CORE_FIXTURES, "")
	config.has_shared_fixture_dir = values.has(_CONFIG_SHARED_FIXTURES)
	config.shared_fixture_dir = values.get(_CONFIG_SHARED_FIXTURES, "")
	return config


## Starts the run of `gut` with `config`, after `init`. Called by the pre-run hook. Puts the test host URL, the run
## kind and the pass into the run, follows the GUT test start and end, hides the GUT runner GUI, starts the run time
## limit timer, and sends the start signal, whose response it waits for, so it ends before the first test setup. Async.
static func _begin_run(gut: GutMain, config: _CONFIG) -> void:
	if not _is_initialized:
		return
	var run: _RUN = _new_run(config)
	run.storage_files = _run.storage_files
	_run = run
	_attach(gut, run)
	_hide_runner_gui(gut)
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	var timer: SceneTreeTimer = tree.create_timer(_run_time_limit_ms / 1000.0, true, false, true)
	if timer.timeout.connect(_on_run_time_limit.bind(run)) != OK:
		LogCore.log_error(_TAG, "could not start the run time limit timer")
	await _send_started(config)


## Hides the GUT runner GUI for the whole run, so it takes no input over the test screen and is in no capture. GUT
## prints its output to stdout and the browser console without it.
static func _hide_runner_gui(gut: GutMain) -> void:
	var layer: CanvasLayer = _runner_gui_layer(gut)
	if layer == null:
		LogCore.log_error(_TAG, "could not find the GUT runner GUI layer %s to hide it" % _GUT_LAYER_NAME)
		return
	layer.visible = false


## The `CanvasLayer` of the GUT runner that holds the GUI of `gut`: an ancestor of `gut` (GUT on top) or a child of one
## of its ancestors. Null when `gut` is not in a GUT runner.
static func _runner_gui_layer(gut: GutMain) -> CanvasLayer:
	if gut == null:
		return null
	var node: Node = gut.get_parent()
	while node != null:
		if node is CanvasLayer and node.name == _GUT_LAYER_NAME:
			return node as CanvasLayer
		var child: Node = node.get_node_or_null(NodePath(String(_GUT_LAYER_NAME)))
		if child is CanvasLayer:
			return child as CanvasLayer
		node = node.get_parent()
	return null


## Ends the run of the GUT run: releases the modules of the last test, adds the run failures, sends the result to the
## test host, releases UnitTestCore, which takes back the test replacements, and sends the release signal. Returns the
## exit code. Called by the post-run hook.
static func _end_run() -> int:
	if _early_end != null:
		# The run ended early: GUT quits after this hook, so it waits for the release signal of that end.
		var early: _RUN = _early_end
		if not early.release_sent:
			await early.released
		return 1
	if not _is_initialized:
		return 1
	var run: _RUN = _root_run()
	if run.ended:
		return 1
	while _run != run:
		await _pop_run()
	_note_current_script(run)
	_close_run(run)
	_add_missing_scripts(run, _selected_test_files())
	var sent: bool = await _send_result(run)
	var code: int = _exit_code(run) if sent else 1
	var config: _CONFIG = run.config
	release()
	await _send_released(config)
	return code


## Sends the result of a run whose `init` failed in the pre-run hook, through a core node of its own: the start signal,
## then no test, and a run failure with the reason, then the release signal. Returns whether the test host took the result. Called by the
## pre-run hook, which then ends the GUT run with exit code 1.
static func _send_init_failure(config: _CONFIG) -> bool:
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree == null:
		return false
	var node: _NODE_SCRIPT = _NODE_SCRIPT.new()
	node.name = _TAG
	node.released = true
	tree.root.add_child(node)
	await _send_started(config)
	var sent: bool = await _send_result_through(node, _init_failure_run(config))
	tree.root.remove_child(node)
	node.queue_free()
	await _send_released(config)
	return sent


## The ended run of `config` whose `init` failed: no test and one run failure with the reason.
static func _init_failure_run(config: _CONFIG) -> _RUN:
	var run: _RUN = _RUN.new()
	run.config = config
	run.kind = _run_kind(config)
	run.started_at = _now_ms()
	var reason: String = "already initialized" if _is_initialized else _init_failure()
	run.run_failures.append("UnitTestCore init failed: %s; no test ran" % reason)
	run.finished_at = run.started_at
	run.ended = true
	return run


## The run time limit passed: records it, sends the result made so far, releases, sends the release signal and quits
## with exit code 1.
static func _on_run_time_limit(run: _RUN) -> void:
	if not _is_initialized or run != _root_run() or run.ended:
		return
	await _end_run_early(run, "run time limit %d ms passed; the remaining tests did not run" % _run_time_limit_ms)


## Ends the GUT run `run` before its last test: GUT runs no more test, the running tests fail with `message`, which is
## also a run failure, and the result made so far goes to the test host. Then the modules are released before the
## release of UnitTestCore, which takes back the test replacements and deletes the new app storage files, and the
## release signal and the quit with exit code 1 follow.
static func _end_run_early(run: _RUN, message: String) -> void:
	_early_end = run
	var runs: Array[_RUN] = _outer_runs.duplicate()
	runs.append(_run)
	var running: Dictionary[_RUN, _STATE] = {}
	for each: _RUN in runs:
		each.ended = true
		_stop_gut(each.gut)
		if each.test != null and not each.test.name.is_empty() and not each.test.judged:
			running[each] = each.test
		# The test ends here: its end checks and GUT's test end do not judge it again.
		each.test = null
	for index: int in range(runs.size() - 1, -1, -1):
		var each: _RUN = runs[index]
		if running.has(each):
			running[each].fail_reasons.append(message)
			_record(each, running[each])
		if each != run:
			for result: _RESULT in each.results:
				run.results.append(result)
	run.run_failures.append(message)
	run.finished_at = _now_ms()
	await _send_result(run)
	BootstrapCoreDev.shutdown()
	release()
	await _send_released(run.config)
	run.release_sent = true
	run.released.emit()
	if _quit.is_valid():
		_quit.call(1)
		return
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	tree.quit(1)


## GUT runs no more test of `gut`: its test name filter matches no test function. GUT cannot stop the test function
## that runs now.
static func _stop_gut(gut: GutMain) -> void:
	if gut != null:
		gut.unit_test_name = _NO_TEST_NAME


## Exit code of a run: 0 when it has a test, every test passed or skipped, and it has no run failure; 1 otherwise.
static func _exit_code(run: _RUN) -> int:
	if run.results.is_empty() or not run.run_failures.is_empty():
		return 1
	for result: _RESULT in run.results:
		if result.status == "fail":
			return 1
	return 0


## Ends a run after its last test: releases the modules, records the error logs after the last test, a run without
## tests, and the end time.
static func _close_run(run: _RUN) -> void:
	if run == _run and run.test != null and not run.test.name.is_empty():
		_record(run, run.test)
	run.test = null
	BootstrapCoreDev.shutdown()
	_report_logs_between_tests(run)
	_report_script_errors_between_tests(run)
	if run.results.is_empty():
		run.run_failures.append("no tests")
	run.finished_at = _now_ms()
	run.ended = true


static func _new_run(config: _CONFIG) -> _RUN:
	var run: _RUN = _RUN.new()
	run.config = config
	run.kind = _run_kind(config)
	run.render_pass = DisplayServer.get_name() != "headless"
	run.started_at = _now_ms()
	run.test_time_limit_ms = _test_time_limit_ms
	run.storage_files = _list_storage_files()
	run.script_errors_mark = _script_errors()
	run.clock = _new_clock()
	run.network = _new_network()
	return run


## Core test run unless the config has only the shared fixture folder.
static func _run_kind(config: _CONFIG) -> String:
	return _KIND_CORE if config.has_core_fixture_dir or not config.has_shared_fixture_dir else _KIND_REGRESSION


static func _root_run() -> _RUN:
	if not _outer_runs.is_empty():
		return _outer_runs[0]
	return _run


static func _attach(gut: GutMain, run: _RUN) -> void:
	run.gut = gut
	if gut == null:
		return
	if gut.start_script.connect(_on_start_script.bind(run)) != OK:
		LogCore.log_error(_TAG, "could not follow the GUT script start")
	if gut.start_test.connect(_on_start_test.bind(run)) != OK:
		LogCore.log_error(_TAG, "could not follow the GUT test start")
	if gut.end_test.connect(_on_end_test.bind(run)) != OK:
		LogCore.log_error(_TAG, "could not follow the GUT test end")


# ogw:input_boundary
static func _on_start_script(_collected: Variant, run: _RUN) -> void:
	if run == _run:
		_note_current_script(run)


# ogw:input_boundary
static func _on_start_test(test_name: Variant, run: _RUN) -> void:
	if run != _run or run.ended:
		return
	var path: String = _note_current_script(run)
	var state: _STATE = run.test
	if state == null or not state.name.is_empty():
		state = _start_state(run, false)
	state.name = "%s::%s" % [path, str(test_name)]


static func _on_end_test(run: _RUN) -> void:
	if run != _run or run.ended or run.test == null:
		return
	_record(run, run.test)
	run.previous_test = run.test.name
	run.test = null


## Adds the result of `state`, the test that ends now.
static func _record(run: _RUN, state: _STATE) -> void:
	var result: _RESULT = _RESULT.new()
	result.name = state.name
	result.duration_ms = maxi(0, Time.get_ticks_msec() - state.started_ms)
	result.checked_script_errors = state.checked_script_errors
	if not state.finished:
		run.script_errors_mark = _script_errors()
	var gut_failed: bool = run.gut != null and _gut_fail_count(run.gut) > state.gut_fail_baseline
	var failures: PackedStringArray = state.assert_failures.duplicate()
	failures.append_array(state.fail_reasons)
	if not state.skip_reason.is_empty():
		result.status = "skip"
		result.message = state.skip_reason
	elif gut_failed or not failures.is_empty():
		result.status = "fail"
		result.message = "; ".join(failures) if not failures.is_empty() else "an assert failed"
	else:
		result.status = "pass"
	run.results.append(result)
	state.judged = true
	_wake(state)


static func _start_state(run: _RUN, has_setup: bool) -> _STATE:
	var state: _STATE = _STATE.new()
	state.started_ms = Time.get_ticks_msec()
	state.has_setup = has_setup
	state.script_errors_base = _script_errors()
	if run.gut != null:
		state.gut_fail_baseline = _gut_fail_count(run.gut)
	run.test = state
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	var timer: SceneTreeTimer = tree.create_timer(run.test_time_limit_ms / 1000.0, true, false, true)
	if timer.timeout.connect(_on_test_time_limit.bind(run, state)) != OK:
		LogCore.log_error(_TAG, "could not start the test time limit timer")
	return state


## The test time limit passed: the test fails, its waits end, and the modules are released so that their async
## operations return, letting the test end and the next test run. A test that awaits something else, such as an
## engine signal that never comes, does not return: one more test time limit later `_on_test_not_returned` ends it.
static func _on_test_time_limit(run: _RUN, state: _STATE) -> void:
	if not _is_initialized or run.test != state or state.judged or run.ended:
		return
	state.timed_out = true
	state.fail_reasons.append("test time limit %d ms passed" % run.test_time_limit_ms)
	_wake(state)
	if run == _run:
		BootstrapCoreDev.shutdown()
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	var timer: SceneTreeTimer = tree.create_timer(run.test_time_limit_ms / 1000.0, true, false, true)
	if timer.timeout.connect(_on_test_not_returned.bind(run, state)) != OK:
		LogCore.log_error(_TAG, "could not start the timer of a test that does not return")


## The test did not return one test time limit after its time limit passed. GUT awaits the test function and has no
## way to stop it, so no later test can run: the test fails and the run ends with a run failure, as at the run time
## limit. A nested run stops instead and wakes the test that runs it.
static func _on_test_not_returned(run: _RUN, state: _STATE) -> void:
	if not _is_initialized or run.test != state or state.judged or run.ended:
		return
	var message: String = (
		"%s did not return within %d ms after its test time limit; the remaining tests did not run"
		% [state.name, run.test_time_limit_ms]
	)
	if run == _root_run():
		await _end_run_early(run, message)
		return
	state.fail_reasons.append(message)
	_record(run, state)
	run.test = null
	run.run_failures.append(message)
	run.stopped.emit()


static func _wake(state: _STATE) -> void:
	var latches: Array[UnitTestLatch] = state.latches
	state.latches = []
	for latch: UnitTestLatch in latches:
		latch.done.emit()


# ogw:input_boundary
static func _gut_fail_count(gut: GutMain) -> int:
	var count: Variant = gut.get_fail_count()
	if count is int:
		return count
	return 0


## Records the path of the test file GUT made the last instance of, and returns it.
# ogw:input_boundary
static func _note_current_script(run: _RUN) -> String:
	if run.gut == null:
		return ""
	var current: Variant = run.gut.get_current_script_object()
	if typeof(current) != TYPE_OBJECT or not is_instance_valid(current) or not current is GutTest:
		return ""
	var test: GutTest = current
	var path: String = _script_path(test)
	if not path.is_empty():
		run.seen_scripts[path] = true
	return path


# ogw:input_boundary
static func _script_path(test: GutTest) -> String:
	if not is_instance_valid(test):
		return ""
	var script: Variant = test.get_script()
	if script is Script:
		var found: Script = script
		return found.resource_path
	return ""


## Adds a run failure for each test file of `files` GUT made no instance of: a file that did not load.
static func _add_missing_scripts(run: _RUN, files: PackedStringArray) -> void:
	for path: String in files:
		if not run.seen_scripts.has(path):
			run.run_failures.append("test file %s did not load" % path)


## Test files the GUT command line selects: `-gtest` files, and the files of the `-gdir` folders with the `-gprefix`
## prefix and the `-gsuffix` suffix, in subfolders with `-ginclude_subdirs`. GUT's own folder is left out.
static func _selected_test_files() -> PackedStringArray:
	var dirs: PackedStringArray = PackedStringArray()
	var files: PackedStringArray = PackedStringArray()
	var prefix: String = _TEST_PREFIX
	var suffix: String = ".gd"
	var subdirs: bool = false
	for arg: String in OS.get_cmdline_args():
		if arg.begins_with("-gdir="):
			dirs.append_array(arg.substr(6).split(",", false))
		elif arg.begins_with("-gtest="):
			files.append_array(arg.substr(7).split(",", false))
		elif arg.begins_with("-gprefix="):
			prefix = arg.substr(9)
		elif arg.begins_with("-gsuffix="):
			suffix = arg.substr(9)
		elif arg == "-ginclude_subdirs":
			subdirs = true
	for dir: String in dirs:
		_find_test_files(dir.strip_edges(), prefix, suffix, subdirs, files)
	return files


static func _find_test_files(dir: String, prefix: String, suffix: String, subdirs: bool, out: PackedStringArray) -> void:
	if dir == "res://addons/gut":
		return
	var access: DirAccess = DirAccess.open(dir)
	if access == null:
		return
	for file: String in access.get_files():
		if file.begins_with(prefix) and file.ends_with(suffix):
			out.append(dir.path_join(file))
	if not subdirs:
		return
	for sub: String in access.get_directories():
		_find_test_files(dir.path_join(sub), prefix, suffix, subdirs, out)


# --- test setup and end (UnitTestCase) ---


## Test setup of a `UnitTestCase` test, before the test function.
static func _setup_test() -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "test setup before init")
		return
	var run: _RUN = _run
	if run.test != null and not run.test.judged and not run.test.name.is_empty():
		_record(run, run.test)
		run.previous_test = run.test.name
	run.test = null
	BootstrapCoreDev.shutdown()
	_delete_new_files(run.storage_files)
	GameDataDev.clear_settings()
	CoreSettings._clear_test_values()
	_report_logs_between_tests(run)
	_report_script_errors_between_tests(run)
	run.clock = _new_clock()
	run.network = _new_network()
	run.logs.clear()
	_register_replacements(run)
	_start_state(run, true)


## Checks at the end of a `UnitTestCase` test, before GUT ends it: fails it for unchecked error logs and unchecked
## engine script runtime errors. Returns the failures UnitTestCore found, for GUT; none for a skipped test. What
## comes after it comes between tests: `_delete_test_servers` follows it.
static func _finish_test() -> PackedStringArray:
	var reasons: PackedStringArray = PackedStringArray()
	if not _is_initialized:
		return reasons
	var run: _RUN = _run
	var state: _STATE = run.test
	if state == null:
		return reasons
	var unchecked: PackedStringArray = _take_unchecked_errors(run)
	if not unchecked.is_empty():
		state.fail_reasons.append("unchecked error logs: %s" % "; ".join(unchecked))
	var unchecked_script_errors: int = _unchecked_script_errors(state)
	if unchecked_script_errors > 0:
		state.fail_reasons.append("%d unchecked engine script runtime errors" % unchecked_script_errors)
	run.logs.clear()
	state.finished = true
	run.script_errors_mark = _script_errors()
	_wake(state)
	if state.skip_reason.is_empty():
		reasons = state.fail_reasons.duplicate()
	return reasons


## Deletes the loopback HTTP servers and the WebSocket relays of the test that ends now from the test host and waits
## for each answer, so the next test starts after them. After `_finish_test`: a failed request is an error log after
## the test, which the next test setup records as a run failure. Async.
static func _delete_test_servers() -> void:
	if not _is_initialized or _run.test == null:
		return
	var run: _RUN = _run
	var state: _STATE = run.test
	var servers: PackedStringArray = state.servers
	var relays: PackedStringArray = state.relays
	state.servers = PackedStringArray()
	state.relays = PackedStringArray()
	for base_url: String in servers:
		await _delete_server(run, base_url)
	for relay: String in relays:
		await _delete_relay(run, relay)


## The failure text of an assert of the test that runs now.
static func _note_assert_failure(text: String) -> void:
	if _is_initialized and _run.test != null:
		_run.test.assert_failures.append(text)


## Whether GUT skips the test file of `test`: a render test in the headless pass of a core test. The tests of a
## skipped file are recorded as skips.
static func _skip_script(test: GutTest) -> bool:
	if not _is_initialized:
		return false
	return _skip_test_file(_run, _script_path(test), _test_functions(test))


## Whether the run skips the test file at `path` with the test functions `functions`: a render test file in a run of
## core tests that does not draw. Records its tests as skips.
static func _skip_test_file(run: _RUN, path: String, functions: PackedStringArray) -> bool:
	if not path.is_empty():
		run.seen_scripts[path] = true
	if run.kind != _KIND_CORE or run.render_pass or not path.get_file().begins_with(_RENDER_PREFIX):
		return false
	for function_name: String in functions:
		var result: _RESULT = _RESULT.new()
		result.name = "%s::%s" % [path, function_name]
		result.status = "skip"
		result.message = _RENDER_SKIP
		run.results.append(result)
	return true


## Names of the test functions of `test`, in GUT's order.
# ogw:input_boundary
static func _test_functions(test: GutTest) -> PackedStringArray:
	var names: PackedStringArray = PackedStringArray()
	var script: Variant = test.get_script()
	if not script is Script:
		return names
	var found: Script = script
	for method: Dictionary in found.get_script_method_list():
		var method_name: Variant = method.get("name", "")
		if method_name is String or method_name is StringName:
			var text: String = str(method_name)
			if text.begins_with(_TEST_PREFIX) and not names.has(text):
				names.append(text)
	return names


static func _register_replacements(run: _RUN) -> void:
	TimeCoreDev.set_test_clock(run.clock)
	LogCoreDev.set_test_clock(run.clock)
	NetworkCoreDev.set_transport(run.network)
	LogCoreDev.set_log_listener(_collect)
	_replaced = true


## Takes back the test replacements of the last test setup through the DEV operations of the modules: no test clock,
## fake network or log collector of the run stays in a module after the run. A module that is still initialized
## refuses them; its own `release` clears them.
static func _unregister_replacements() -> void:
	if not TimeCore.is_initialized():
		TimeCoreDev.set_test_clock(null)
	if not LogCore.is_initialized():
		LogCoreDev.set_test_clock(null)
		LogCoreDev.set_log_listener(Callable())
	if not NetworkCore.is_initialized():
		NetworkCoreDev.set_transport(null)


static func _new_clock() -> DevTestClock:
	var clock: DevTestClock = DevTestClock.new()
	clock.monotonic_ms = 0
	clock.device_time_ms = _CLOCK_START_DEVICE_MS
	return clock


static func _new_network() -> _FAKE_NETWORK:
	var network: _FAKE_NETWORK = _FAKE_NETWORK.new()
	network.missing = _on_missing_result
	return network


## A request of the fake network `network` found no registered result: the test fails.
static func _on_missing_result(network: _FAKE_NETWORK, request_name: String) -> void:
	if _is_initialized and _run.network == network:
		_fail_test(_run, "request %s has no registered result" % request_name)


## Fails the test that runs now, or records a run failure between tests.
static func _fail_test(run: _RUN, message: String) -> void:
	if run.test != null and not run.test.judged:
		run.test.fail_reasons.append(message)
	else:
		run.run_failures.append("%s (after %s)" % [message, run.previous_test])


## Logs `message` as an error and fails the test that runs now.
static func _error_and_fail(message: String) -> void:
	LogCore.log_error(_TAG, message)
	if _is_initialized:
		_fail_test(_run, message)


# --- log collector ---


## Log listener of `LogCore`: keeps the `warn` and `error` logs and counts the `warn` logs by tag.
static func _collect(level: LogCore.Level, tag: String, message: String) -> void:
	if not _is_initialized:
		return
	var run: _RUN = _run
	var item: _LOG = _LOG.new()
	if level == LogCore.Level.WARN:
		item.level = "warn"
		if run.warn_counts.has(tag):
			run.warn_counts[tag] += 1
		else:
			run.warn_counts[tag] = 1
	elif level == LogCore.Level.ERROR:
		item.level = "error"
	else:
		return
	item.tag = tag
	item.message = message
	run.logs.append(item)


## Marks the unchecked error logs of the run checked and returns them as `<tag>: <message>` lines.
static func _take_unchecked_errors(run: _RUN) -> PackedStringArray:
	var lines: PackedStringArray = PackedStringArray()
	for item: _LOG in run.logs:
		if item.level == "error" and not item.checked:
			item.checked = true
			lines.append("%s: %s" % [item.tag, item.message])
	return lines


## A run failure for the unchecked error logs that came after the last test ended.
static func _report_logs_between_tests(run: _RUN) -> void:
	var lines: PackedStringArray = _take_unchecked_errors(run)
	if not lines.is_empty():
		run.run_failures.append("unchecked error logs after %s: %s" % [run.previous_test, "; ".join(lines)])
	run.logs.clear()


# --- script errors ---


## Engine script runtime errors since `init`.
static func _script_errors() -> int:
	return _script_logger.total() if _script_logger != null else 0


## Engine script runtime errors of `state`, the test that runs now, that `check_script_errors` did not check.
static func _unchecked_script_errors(state: _STATE) -> int:
	return maxi(0, _script_errors() - state.script_errors_base - state.checked_script_errors)


## A run failure for the engine script runtime errors that came after the last test ended.
static func _report_script_errors_between_tests(run: _RUN) -> void:
	var count: int = _script_errors() - run.script_errors_mark
	if count > 0:
		run.run_failures.append("%d engine script runtime errors after %s" % [count, run.previous_test])
	run.script_errors_mark = _script_errors()


## Marks the engine errors of type script that GUT tracked for the test that runs now handled, so GUT does not fail
## the test for the errors `check_script_errors` checked.
# ogw:input_boundary
static func _handle_gut_script_errors(gut: GutMain) -> void:
	if gut == null:
		return
	var tracker: Variant = gut.error_tracker
	if not tracker is GutErrorTracker:
		return
	var typed: GutErrorTracker = tracker
	var errors: Variant = typed.get_errors_for_test()
	if not errors is Array:
		return
	var list: Array = errors
	for item: Variant in list:
		if item is GutTrackedError:
			var error: GutTrackedError = item
			if not error.handled and error.is_engine_error() and error.error_type == Logger.ERROR_TYPE_SCRIPT:
				error.handled = true


# --- app storage ---


## App storage files and folders, a folder path ending with `/`.
static func _list_storage_files() -> Dictionary[String, bool]:
	var paths: Dictionary[String, bool] = {}
	_list_storage(_STORAGE_ROOT, paths)
	return paths


static func _list_storage(dir: String, out: Dictionary[String, bool]) -> void:
	var access: DirAccess = DirAccess.open(dir)
	if access == null:
		return
	access.include_hidden = true
	for file: String in access.get_files():
		out[dir.path_join(file)] = true
	for sub: String in access.get_directories():
		var path: String = dir.path_join(sub)
		out[path + "/"] = true
		_list_storage(path, out)


## Deletes the app storage files and folders that are not in `kept`.
static func _delete_new_files(kept: Dictionary[String, bool]) -> void:
	var now: Dictionary[String, bool] = _list_storage_files()
	var folders: PackedStringArray = PackedStringArray()
	for path: String in now.keys():
		if kept.has(path):
			continue
		if path.ends_with("/"):
			folders.append(path.trim_suffix("/"))
		elif DirAccess.remove_absolute(path) != OK:
			LogCore.log_error(_TAG, "could not delete app storage file %s" % path)
	folders.sort()
	folders.reverse()
	for folder: String in folders:
		if DirAccess.remove_absolute(folder) != OK:
			LogCore.log_error(_TAG, "could not delete app storage folder %s" % folder)


# --- result file ---


static func _send_result(run: _RUN) -> bool:
	if _node == null:
		return false
	return await _send_result_through(_node, run)


static func _send_result_through(node: _NODE_SCRIPT, run: _RUN) -> bool:
	await node.wait_idle()
	if run.config.test_host.is_empty():
		LogCore.log_error(_TAG, "the run has no test host; the result was not sent")
		return false
	var reply: _REPLY = await node.request(run.config.test_host + "/result", HTTPClient.METHOD_PUT, _result_json(run))
	if not reply.ok or reply.status != 204:
		_host_failure("PUT /result", reply)
		return false
	return true


## The start signal of the run of `config`, once, when the engine is up and before the first test setup: sends
## `PUT /started` with the run ID and waits for its response. The tool ends a run that does not send it within
## `UnitTestCore.startTimeLimitMs`. Through a core node of its own, so a run whose `init` failed sends it too. Returns
## whether the test host took it.
static func _send_started(config: _CONFIG) -> bool:
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree == null or config.test_host.is_empty():
		LogCore.log_error(_TAG, "the run has no test host; the start signal was not sent")
		return false
	var node: _NODE_SCRIPT = _NODE_SCRIPT.new()
	node.name = _TAG
	node.released = true
	tree.root.add_child(node)
	var body: String = '{"run_id": %s}' % JSON.stringify(config.run_id)
	var reply: _REPLY = await node.request(config.test_host + "/started", HTTPClient.METHOD_PUT, body)
	tree.root.remove_child(node)
	node.queue_free()
	var sent: bool = reply.ok and reply.status == 204
	if not sent:
		_host_failure("PUT /started", reply)
	return sent


## The release signal of the run of `config`, after its `release` (or after the result of a failed `init`): sends
## `PUT /released` with the run ID, then prints the line `UnitTestCore released run <run ID>`, the last line UnitTestCore
## prints in the run, so the engine output marks where the output of the run ends. Through a core node of its own, since
## `release` removed the one of the run. Returns whether the test host took it.
static func _send_released(config: _CONFIG) -> bool:
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree == null or config.test_host.is_empty():
		return false
	var node: _NODE_SCRIPT = _NODE_SCRIPT.new()
	node.name = _TAG
	node.released = true
	tree.root.add_child(node)
	var body: String = '{"run_id": %s}' % JSON.stringify(config.run_id)
	var reply: _REPLY = await node.request(config.test_host + "/released", HTTPClient.METHOD_PUT, body)
	tree.root.remove_child(node)
	node.queue_free()
	var sent: bool = reply.ok and reply.status == 204
	if not sent:
		_host_failure("PUT /released", reply)
	print(_RELEASED_LINE_PREFIX + config.run_id)
	return sent


## The result file of a run (`unit-test-core` `### run and result file`).
static func _result_json(run: _RUN) -> String:
	var results: PackedStringArray = PackedStringArray()
	for result: _RESULT in run.results:
		results.append('{"name": %s, "status": %s, "duration_ms": %d, "message": %s, "checked_script_errors": %d}' % [
			JSON.stringify(result.name), JSON.stringify(result.status), result.duration_ms, JSON.stringify(result.message),
			result.checked_script_errors,
		])
	var failures: PackedStringArray = PackedStringArray()
	for message: String in run.run_failures:
		failures.append('{"message": %s}' % JSON.stringify(message))
	var warns: PackedStringArray = PackedStringArray()
	for tag: String in run.warn_counts.keys():
		warns.append("%s: %d" % [JSON.stringify(tag), run.warn_counts[tag]])
	return '{"run_id": %s, "kind": %s, "engine": %s, "started_at": %d, "finished_at": %d, "results": [%s], "run_failures": [%s], "warn_counts": {%s}}' % [
		JSON.stringify(run.config.run_id), JSON.stringify(run.kind), JSON.stringify(_ENGINE), run.started_at,
		run.finished_at, ", ".join(results), ", ".join(failures), ", ".join(warns),
	]


static func _now_ms() -> int:
	return int(Time.get_unix_time_from_system() * 1000.0)


# --- test host ---


static func _host_failure(what: String, reply: _REPLY) -> void:
	LogCore.log_error(_TAG, "test host request %s failed: result %d, HTTP status %d" % [what, reply.result, reply.status])


## Test host URL of the loopback HTTP server of `base_url` (`<test host>/servers/<n>`), or empty.
static func _server_url(run: _RUN, base_url: String) -> String:
	var prefix: String = run.config.test_host + "/servers/"
	if run.config.test_host.is_empty() or not base_url.begins_with(prefix) or not base_url.ends_with("/files"):
		return ""
	var number: String = base_url.substr(prefix.length(), base_url.length() - prefix.length() - "/files".length())
	if not number.is_valid_int() or number.to_int() < 1:
		return ""
	return prefix + number


static func _delete_server(run: _RUN, base_url: String) -> void:
	var server: String = _server_url(run, base_url)
	if server.is_empty() or _node == null:
		return
	var reply: _REPLY = await _node.request(server, HTTPClient.METHOD_DELETE, "")
	if not reply.ok or reply.status != 204:
		_host_failure("DELETE " + server.substr(run.config.test_host.length()), reply)


static func _delete_relay(run: _RUN, relay: String) -> void:
	if _node == null:
		return
	var reply: _REPLY = await _node.request(relay, HTTPClient.METHOD_DELETE, "")
	if not reply.ok or reply.status != 204:
		_host_failure("DELETE " + relay.substr(run.config.test_host.length()), reply)


## Test host URL (`<test host>/ws-servers/<n>`) of the WebSocket relay of `relay`, or empty when its URLs are not the
## client and control URLs of one relay of the test host.
static func _relay_url(run: _RUN, relay: UnitTestWsRelay) -> String:
	var host: String = run.config.test_host
	if not host.begins_with("http://"):
		return ""
	var prefix: String = "ws://" + host.substr("http://".length()) + "/ws/"
	if not relay.url.begins_with(prefix) or not relay.url.ends_with("/client"):
		return ""
	var number: String = relay.url.substr(prefix.length(), relay.url.length() - prefix.length() - "/client".length())
	if not number.is_valid_int() or number.to_int() < 1 or relay.control_url != prefix + number + "/control":
		return ""
	return host + "/ws-servers/" + number


# ogw:input_boundary
static func _parse_relay(body: PackedByteArray) -> UnitTestWsRelay:
	var relay: UnitTestWsRelay = UnitTestWsRelay.new()
	var parsed: Variant = JSON.parse_string(body.get_string_from_utf8())
	if not parsed is Dictionary:
		return relay
	var object: Dictionary = parsed
	var url: Variant = object.get("url", "")
	var control_url: Variant = object.get("control_url", "")
	if url is String and control_url is String:
		relay.url = url
		relay.control_url = control_url
	return relay


static func _page_input(what: String, body: String) -> bool:
	if not _check(what):
		return false
	var run: _RUN = _run
	if run.config.test_host.is_empty():
		LogCore.log_error(_TAG, "%s: the run has no test host" % what)
		return false
	var reply: _REPLY = await _node.request(run.config.test_host + "/input", HTTPClient.METHOD_POST, body)
	if reply.ok and reply.status == 204:
		return true
	# The native run has no page: the test host answers 404 to every input.
	if not reply.ok or reply.status != 404:
		_host_failure("POST /input", reply)
	return false


# ogw:input_boundary
static func _parse_base_url(body: PackedByteArray) -> String:
	var parsed: Variant = JSON.parse_string(body.get_string_from_utf8())
	if not parsed is Dictionary:
		return ""
	var object: Dictionary = parsed
	var base_url: Variant = object.get("base_url", "")
	if base_url is String:
		return base_url
	return ""


# ogw:input_boundary
static func _parse_http_requests(body: PackedByteArray, out: Array[UnitTestHttpRequest]) -> bool:
	var parsed: Variant = JSON.parse_string(body.get_string_from_utf8())
	if not parsed is Array:
		return false
	var items: Array = parsed
	for item: Variant in items:
		if not item is Dictionary:
			return false
		var object: Dictionary = item
		var path: Variant = object.get("path", null)
		var headers: Variant = object.get("headers", null)
		var data: Variant = object.get("body", null)
		if not path is String or not headers is Array or not data is String:
			return false
		var request: UnitTestHttpRequest = UnitTestHttpRequest.new()
		request.path = path
		var pairs: Array = headers
		for pair: Variant in pairs:
			if not pair is Array:
				return false
			var values: Array = pair
			if values.size() != 2 or not values[0] is String or not values[1] is String:
				return false
			request.headers.append(PackedStringArray([str(values[0]), str(values[1])]))
		var text: String = data
		request.body = Marshalls.base64_to_raw(text) if not text.is_empty() else PackedByteArray()
		out.append(request)
	return true


static func _registration_json(path: String, status: int, headers: Array[PackedStringArray], body: PackedByteArray) -> String:
	var pairs: PackedStringArray = PackedStringArray()
	for pair: PackedStringArray in headers:
		if pair.size() == 2:
			pairs.append("[%s, %s]" % [JSON.stringify(pair[0]), JSON.stringify(pair[1])])
	var encoded: String = Marshalls.raw_to_base64(body) if not body.is_empty() else ""
	return '{"path": %s, "status": %d, "headers": [%s], "body": %s}' % [
		JSON.stringify(path), status, ", ".join(pairs), JSON.stringify(encoded),
	]


# --- nested runs (UnitTestCore core tests) ---


## Core test only. Starts a nested run of `gut` over the run of the test that runs now: a run of its own with
## `kind`, the fixture folders and the test time limit. `_pop_run` ends it.
static func _push_run(gut: GutMain, kind: String, core_fixture_dir: String, shared_fixture_dir: String, test_time_limit_ms: int) -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "_push_run before init")
		return
	var config: _CONFIG = _CONFIG.new()
	config.run_id = _run.config.run_id + ".nested"
	config.test_host = _run.config.test_host
	config.has_core_fixture_dir = kind == _KIND_CORE
	config.core_fixture_dir = core_fixture_dir
	config.has_shared_fixture_dir = kind == _KIND_REGRESSION
	config.shared_fixture_dir = shared_fixture_dir
	var run: _RUN = _new_run(config)
	run.test_time_limit_ms = test_time_limit_ms
	_outer_runs.append(_run)
	_run = run
	_attach(gut, run)


## Core test only. Ends the nested run like the end of a test run, without sending a result, deletes the app storage
## files it made, and gives the test that runs now its replacements again. Returns the nested run.
static func _pop_run() -> _RUN:
	var run: _RUN = _run
	if not _is_initialized or _outer_runs.is_empty():
		return run
	_close_run(run)
	if _node != null:
		await _node.wait_idle()
	_delete_new_files(run.storage_files)
	_run = _outer_runs.pop_back()
	_register_replacements(_run)
	return run


# --- DEV operations ---


static func _check(operation: String) -> bool:
	if _is_initialized:
		return true
	LogCore.log_error(_TAG, "%s before init" % operation)
	return false


## Registers the next result of request `request_name`.
static func add_result(request_name: String, transfer: NetworkCore.TransferResult, http_status: int, body: PackedByteArray) -> void:
	if not _check("add_result"):
		return
	_run.network.add(request_name, transfer, http_status, body)


## Registers a hold as the next result of request `request_name`.
static func add_pending(request_name: String) -> void:
	if not _check("add_pending"):
		return
	_run.network.add_pending(request_name)


## Gives the result to the request of `request_name` that was held first. False when none is held.
static func release_pending(request_name: String, transfer: NetworkCore.TransferResult, http_status: int, body: PackedByteArray) -> bool:
	if not _check("release_pending"):
		return false
	return _run.network.release(request_name, transfer, http_status, body)


## Response bytes of `envelope`.
static func make_response(envelope: CoreContract.ResponseEnvelope) -> PackedByteArray:
	if envelope == null:
		LogCore.log_error(_TAG, "make_response without an envelope")
		return PackedByteArray()
	return envelope.encode()


## Requests the fake network received, in the order it received them.
static func received_requests() -> Array[UnitTestRequest]:
	if not _check("received_requests"):
		var none: Array[UnitTestRequest] = []
		return none
	return _run.network.received()


## Cancels the fake network received.
static func cancel_count() -> int:
	if not _check("cancel_count"):
		return 0
	return _run.network.cancel_count()


## Moves the test clock `duration_ms` ahead. A device sleep moves only the device time and counts as background
## progress. Then `TimeCore` processes the step when it is initialized.
static func advance_clock(duration_ms: int, background: bool, device_sleep: bool = false) -> void:
	if not _check("advance_clock"):
		return
	if duration_ms < 0:
		LogCore.log_error(_TAG, "advance_clock: negative duration %d" % duration_ms)
		return
	var clock: DevTestClock = _run.clock
	clock.device_time_ms += duration_ms
	if not device_sleep:
		clock.monotonic_ms += duration_ms
	if TimeCore.is_initialized():
		TimeCoreDev.step_test_frame(duration_ms, background or device_sleep, device_sleep)


## Sets the device time of the test clock. The monotonic time stays.
static func set_device_time(unix_ms: int) -> void:
	if not _check("set_device_time"):
		return
	_run.clock.device_time_ms = unix_ms


## A press and a release at `position` in game coordinates through `InputCore.inject_device_input`.
static func tap(position: Vector2) -> void:
	if not _check("tap"):
		return
	for pressed: bool in [true, false]:
		var event: InputEventMouseButton = InputEventMouseButton.new()
		event.button_index = MOUSE_BUTTON_LEFT
		event.pressed = pressed
		event.button_mask = MOUSE_BUTTON_MASK_LEFT if pressed else 0
		event.position = position
		event.global_position = position
		InputCoreDev.inject_device_input(event)


## `tap` at the center of the visible rectangle of the anchor. False when `UICore.get_anchor_rect` finds no visible one.
static func tap_anchor(anchor_name: String, anchor_key: int = 0) -> bool:
	if not _check("tap_anchor"):
		return false
	var anchor: AnchorResult = UICore.get_anchor_rect(anchor_name, anchor_key)
	if anchor == null or not anchor.found or not anchor.visible:
		return false
	tap(anchor.rect.get_center())
	return true


## Number of the unchecked logs of `level` (`warn` or `error`) and `tag` in this test. They become checked.
static func check_logs(level: String, tag: String) -> int:
	if not _check("check_logs"):
		return 0
	if level != "warn" and level != "error":
		LogCore.log_error(_TAG, "check_logs: level %s is not warn or error" % level)
		return 0
	var count: int = 0
	for item: _LOG in _run.logs:
		if item.level == level and item.tag == tag and not item.checked:
			item.checked = true
			count += 1
	return count


## Number of the engine script runtime errors of this test that `check_script_errors` did not check. They become
## checked, and GUT does not fail the test for them.
static func check_script_errors() -> int:
	if not _check("check_script_errors"):
		return 0
	var run: _RUN = _run
	if run.test == null:
		return 0
	var count: int = _unchecked_script_errors(run.test)
	run.test.checked_script_errors += count
	_handle_gut_script_errors(run.gut)
	return count


## A latch of `event_type`. Make it before the action that publishes the event. Until the event comes, the latch
## subscribes whenever `EventCore` is initialized, through the init listener of `EventCoreDev`: it also catches an event
## of a boot that initializes `EventCore` after the latch is made, a restart included. `EventCore.release` clears the
## init listener, so UnitTestCore registers it again for every test boot and after every `release` of `EventCore` in a
## test, the reverse release of a restart before its `InitModules` included.
static func latch_event(event_type: Script) -> UnitTestLatch:
	var latch: UnitTestLatch = UnitTestLatch.new()
	latch.event_type = event_type
	if not _check("latch_event"):
		return latch
	if _run.test != null:
		_run.test.latches.append(latch)
	if EventCore.is_initialized():
		EventCore.subscribe(event_type, latch._on_event)
	else:
		_register_init_listener()
	return latch


## A node left the tree. The core node of `EventCore` leaves it in `EventCore.release`, which cleared the init
## listeners: in a test, register again for the next `init`, the `InitModules` of a restart or an update reboot included.
static func _on_node_removed(removed: Node) -> void:
	if not _is_initialized or _run.test == null or EventCore.is_initialized():
		return
	if removed.name != _EVENT_CORE_NODE_NAME or removed.get_parent() != removed.get_tree().root:
		return
	_register_init_listener()


## Registers `_on_event_core_init` with `EventCoreDev`. A second registration before the next `init` is harmless: the
## listener subscribes only the latches without a subscription.
static func _register_init_listener() -> void:
	EventCoreDev.register_init_listener(_on_event_core_init)


## Init listener of `EventCore`: its `init` ends, and subscriptions can be taken.
static func _on_event_core_init() -> void:
	_subscribe_latches()


static func _subscribe_latches() -> void:
	if not _is_initialized or _run.test == null or not EventCore.is_initialized():
		return
	for latch: UnitTestLatch in _run.test.latches:
		if not latch.happened and EventCore.count_subscriptions(latch) == 0:
			EventCore.subscribe(latch.event_type, latch._on_event)


## Waits for the event of `latch`. Returns whether the event came before the wait. The test time limit ends the wait.
static func wait_latch(latch: UnitTestLatch) -> bool:
	if latch == null:
		LogCore.log_error(_TAG, "wait_latch without a latch")
		return false
	if latch.happened:
		return true
	if not _check("wait_latch"):
		return false
	var state: _STATE = _run.test
	if state == null or not state.latches.has(latch):
		LogCore.log_error(_TAG, "wait_latch on a latch not made in this test")
		return false
	if state.timed_out:
		return false
	await latch.done
	return false


## Waits `frames` engine frames. Only for what engine frames move: tweens, layout, deferred calls.
static func wait_frames(frames: int) -> void:
	if not _check("wait_frames"):
		return
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	for i: int in frames:
		await tree.process_frame


## Makes a loopback HTTP server on the test host and returns its base URL. Empty on failure.
static func start_http_server() -> String:
	if not _check("start_http_server"):
		return ""
	var run: _RUN = _run
	if run.config.test_host.is_empty():
		LogCore.log_error(_TAG, "start_http_server: the run has no test host")
		return ""
	var reply: _REPLY = await _node.request(run.config.test_host + "/servers", HTTPClient.METHOD_POST, "")
	if not reply.ok or reply.status != 201:
		_host_failure("POST /servers", reply)
		return ""
	var base_url: String = _parse_base_url(reply.body)
	if _server_url(run, base_url).is_empty():
		LogCore.log_error(_TAG, "start_http_server: the test host gave no base URL")
		return ""
	if run.test != null:
		run.test.servers.append(base_url)
	return base_url


## Sets the response of `path` of the loopback HTTP server of `base_url`. `headers` are `[name, value]` pairs.
static func add_http_response(base_url: String, path: String, http_status: int, headers: Array[PackedStringArray], body: PackedByteArray) -> bool:
	if not _check("add_http_response"):
		return false
	var server: String = _server_url(_run, base_url)
	if server.is_empty():
		LogCore.log_error(_TAG, "add_http_response: %s is not a loopback HTTP server base URL" % base_url)
		return false
	var reply: _REPLY = await _node.request(server + "/responses", HTTPClient.METHOD_PUT, _registration_json(path, http_status, headers, body))
	if not reply.ok or reply.status != 204:
		_host_failure("PUT /responses", reply)
		return false
	return true


## Requests the loopback HTTP server of `base_url` received, in the order it received them.
static func http_requests(base_url: String) -> Array[UnitTestHttpRequest]:
	var requests: Array[UnitTestHttpRequest] = []
	if not _check("http_requests"):
		return requests
	var server: String = _server_url(_run, base_url)
	if server.is_empty():
		LogCore.log_error(_TAG, "http_requests: %s is not a loopback HTTP server base URL" % base_url)
		return requests
	var reply: _REPLY = await _node.request(server + "/requests", HTTPClient.METHOD_GET, "")
	if not reply.ok or reply.status != 200:
		_host_failure("GET /requests", reply)
		return requests
	if not _parse_http_requests(reply.body, requests):
		LogCore.log_error(_TAG, "http_requests: the test host gave a list of another form")
		requests.clear()
	return requests


## Opens a WebSocket relay on the test host. UnitTestCore deletes it when the test ends, which closes its connections.
## Empty URLs on failure.
static func open_ws_relay() -> UnitTestWsRelay:
	var failed: UnitTestWsRelay = UnitTestWsRelay.new()
	if not _check("open_ws_relay"):
		return failed
	var run: _RUN = _run
	if run.config.test_host.is_empty():
		LogCore.log_error(_TAG, "open_ws_relay: the run has no test host")
		return failed
	var reply: _REPLY = await _node.request(run.config.test_host + "/ws-servers", HTTPClient.METHOD_POST, "")
	if not reply.ok or reply.status != 201:
		_host_failure("POST /ws-servers", reply)
		return failed
	var relay: UnitTestWsRelay = _parse_relay(reply.body)
	var relay_url: String = _relay_url(run, relay)
	if relay_url.is_empty():
		LogCore.log_error(_TAG, "open_ws_relay: the test host gave no relay URLs")
		return failed
	if run.test != null:
		run.test.relays.append(relay_url)
	return relay


## Puts a left click at `css_position`, in CSS pixels of the page, into the page of the browser run through the test
## host, as a person's input: the page gets a user activation. `false` in the native run, which has no page.
static func put_page_click(css_position: Vector2) -> bool:
	return await _page_input("put_page_click", '{"type": "click", "x": %s, "y": %s}' % [
		JSON.stringify(css_position.x), JSON.stringify(css_position.y),
	])


## Puts a press of `key`, a DOM `key` value, into the page of the browser run through the test host, as a person's
## input. `false` in the native run, which has no page.
static func put_page_key(key: String) -> bool:
	if key.is_empty():
		LogCore.log_error(_TAG, "put_page_key: an empty key")
		return false
	return await _page_input("put_page_key", '{"type": "key", "key": %s}' % JSON.stringify(key))


static func create_fake_realtime() -> UnitTestRealtimeTransport:
	if not _check("create_fake_realtime"):
		return null
	return UnitTestRealtimeTransport.new()


## Puts in `notice`, a transport notification and its payload, for the next `poll` of `transport`.
static func add_realtime_notice(transport: UnitTestRealtimeTransport, notice: RealtimeNotice) -> void:
	if not _check("add_realtime_notice"):
		return
	if transport == null or notice == null:
		LogCore.log_error(_TAG, "add_realtime_notice without a transport or a notification")
		return
	transport.queue_notice(notice)


## Sets what `send_packet` of `transport` returns for participant `index`.
static func set_realtime_send_result(transport: UnitTestRealtimeTransport, index: int, ok: bool) -> void:
	if not _check("set_realtime_send_result"):
		return
	if transport == null:
		LogCore.log_error(_TAG, "set_realtime_send_result without a transport")
		return
	transport.set_send_result(index, ok)


## Transport operation calls `transport` received, in order.
static func realtime_calls(transport: UnitTestRealtimeTransport) -> Array[UnitTestRealtimeCall]:
	var none: Array[UnitTestRealtimeCall] = []
	if not _check("realtime_calls"):
		return none
	if transport == null:
		LogCore.log_error(_TAG, "realtime_calls without a transport")
		return none
	return transport.calls()


## Ends this core test as a skip when the platform of the run is not in `platforms`. A regression test fails instead.
static func require_platform(platforms: PackedStringArray) -> void:
	if not _check("require_platform"):
		return
	var run: _RUN = _run
	if run.kind != _KIND_CORE:
		_error_and_fail("require_platform called in a regression test")
		return
	if run.test == null:
		LogCore.log_error(_TAG, "require_platform outside a test")
		return
	var platform: String = CoreBuildInfo.platform
	if not platform in platforms:
		run.test.skip_reason = "platform %s is not in %s" % [platform, ", ".join(platforms)]


## Sets the test value of a core settings key or a game settings path core reads. Modules `init`ed after it read it;
## the next test setup clears it. The value must be of the key's type in the core settings type file.
# ogw:input_boundary
static func set_test_settings(key: String, value: Variant) -> bool:
	if not _can_set_test_settings("set_test_settings", key):
		return false
	var settings_type: String = _settings_types[key]
	if not _is_settings_type(settings_type):
		_error_and_fail("set_test_settings: %s has the type %s in %s, which is no settings type" % [
			key, settings_type, _SETTINGS_TYPES_PATH])
		return false
	if not _has_settings_type(value, settings_type):
		_error_and_fail("set_test_settings: the value of %s has another type than %s" % [key, settings_type])
		return false
	CoreSettings._set_test_value(key, value)
	return true


## `set_test_settings` without the type check: for the core tests of a module `init` failing on a settings value of
## another type.
# ogw:input_boundary
static func set_invalid_test_settings(key: String, value: Variant) -> bool:
	if not _can_set_test_settings("set_invalid_test_settings", key):
		return false
	CoreSettings._set_test_value(key, value)
	return true


## Whether `operation` may set a test value of `key`: called in a core test, for a key of the core settings type file
## (a core settings key or a game settings path core reads). Otherwise logs an error and fails the test.
static func _can_set_test_settings(operation: String, key: String) -> bool:
	if not _check(operation):
		return false
	if _run.kind != _KIND_CORE:
		_error_and_fail("%s called in a regression test" % operation)
		return false
	if not _settings_types.has(key):
		_error_and_fail("%s: %s is not a core settings key or a game settings item core reads (no key of %s)" % [
			operation, key, _SETTINGS_TYPES_PATH])
		return false
	return true


## The core settings type file: the spec `## settings` type string by key. Empty when the file is missing or is not a
## JSON object; a member whose value is not a string is left out.
# ogw:input_boundary
static func _read_settings_types() -> Dictionary[String, String]:
	var types: Dictionary[String, String] = {}
	if not FileAccess.file_exists(_SETTINGS_TYPES_PATH):
		return types
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(_SETTINGS_TYPES_PATH))
	if not parsed is Dictionary:
		return types
	var members: Dictionary = parsed
	for name: Variant in members.keys():
		var settings_type: Variant = members[name]
		if settings_type is String:
			types[str(name)] = settings_type
	return types


## Whether `settings_type` is a spec settings type: `integer`, `number`, `string`, `boolean`, `object` or `array<T>`
## with a settings type `T`, each with an optional `?` at the end.
static func _is_settings_type(settings_type: String) -> bool:
	var base: String = settings_type.trim_suffix("?")
	if base in _SCALAR_SETTINGS_TYPES:
		return true
	if base.begins_with(_ARRAY_PREFIX) and base.ends_with(">"):
		return _is_settings_type(_element_type(base))
	return false


## `T` of the settings type `array<T>`.
static func _element_type(settings_type: String) -> String:
	return settings_type.substr(_ARRAY_PREFIX.length(), settings_type.length() - _ARRAY_PREFIX.length() - 1)


## Whether `value` is a JSON value of the spec settings type `settings_type`: `integer` is a whole number of any
## GDScript number type, `number` any finite number, `object` any object, `array<T>` an array whose elements are of
## type `T`, and a type ending in `?` takes `null` too.
# ogw:input_boundary
static func _has_settings_type(value: Variant, settings_type: String) -> bool:
	var kind: String = _json_kind(value)
	if kind.is_empty():
		return false
	if settings_type.ends_with("?"):
		return kind == "null" or _has_settings_type(value, settings_type.trim_suffix("?"))
	match settings_type:
		"integer":
			return kind == "number" and _is_whole(value)
		"number":
			if value is float:
				var number: float = value
				return is_finite(number)
			return kind == "number"
		"string", "boolean", "object":
			return kind == settings_type
	if not settings_type.begins_with(_ARRAY_PREFIX) or kind != "array":
		return false
	var element: String = _element_type(settings_type)
	var items: Variant = value
	for item: Variant in items:
		if not _has_settings_type(item, element):
			return false
	return true


## Whether `value` is a whole finite number.
# ogw:input_boundary
static func _is_whole(value: Variant) -> bool:
	if value is int:
		return true
	if value is float:
		var number: float = value
		return is_finite(number) and number == floorf(number)
	return false


## JSON type of `value`: `null`, `boolean`, `number`, `string`, `array`, `object`; empty when it is no JSON value.
# ogw:input_boundary
static func _json_kind(value: Variant) -> String:
	match typeof(value):
		TYPE_NIL:
			return "null"
		TYPE_BOOL:
			return "boolean"
		TYPE_INT, TYPE_FLOAT:
			return "number"
		TYPE_STRING, TYPE_STRING_NAME:
			return "string"
		TYPE_DICTIONARY:
			return "object"
		TYPE_ARRAY, TYPE_PACKED_INT32_ARRAY, TYPE_PACKED_INT64_ARRAY, TYPE_PACKED_FLOAT32_ARRAY, \
				TYPE_PACKED_FLOAT64_ARRAY, TYPE_PACKED_STRING_ARRAY:
			return "array"
	return ""


## Starts a test boot: `BootstrapCore.start_boot` with the test clock, fake network and log collector of this test,
## `realtime`, `server_url` (`http://127.0.0.1` when empty) and `update_downloads`. The boots after a restart or an
## update reboot use the same replacements. Registers the init listener of `EventCoreDev` first: a `release` of
## `EventCore` before the boot may have cleared an earlier registration.
static func start_test_boot(
		content: ContentEntry,
		modules: Array[CoreModuleEntry],
		realtime: RealtimeTransport = null,
		server_url: String = "",
		update_downloads: BootTestReplacements.UpdateDownloads = null
) -> void:
	if not _check("start_test_boot"):
		return
	var replacements: BootTestReplacements = BootTestReplacements.new()
	replacements.test_clock = _run.clock
	replacements.network_transport = _run.network
	replacements.log_listener = _collect
	replacements.realtime_transport = realtime
	replacements.server_url = server_url if not server_url.is_empty() else _DEFAULT_SERVER_URL
	replacements.update_downloads = update_downloads
	if not EventCore.is_initialized():
		_register_init_listener()
	BootstrapCore.start_boot(content, modules, replacements)


## Content of `<name>.json` in the shared fixture folder of a regression test.
static func read_shared_fixture(fixture_name: String) -> String:
	if not _check("read_shared_fixture"):
		return ""
	var run: _RUN = _run
	if run.kind != _KIND_REGRESSION:
		_error_and_fail("read_shared_fixture called in a core test")
		return ""
	return _read_fixture(run.config.has_shared_fixture_dir, run.config.shared_fixture_dir, fixture_name, "shared")


## Content of `<name>.json` in the core fixture folder of a core test.
static func read_core_fixture(fixture_name: String) -> String:
	if not _check("read_core_fixture"):
		return ""
	var run: _RUN = _run
	if run.kind != _KIND_CORE:
		_error_and_fail("read_core_fixture called in a regression test")
		return ""
	return _read_fixture(run.config.has_core_fixture_dir, run.config.core_fixture_dir, fixture_name, "core")


static func _read_fixture(has_dir: bool, dir: String, fixture_name: String, what: String) -> String:
	if not has_dir or dir.is_empty():
		_error_and_fail("the run has no %s fixture folder" % what)
		return ""
	var path: String = dir.path_join(fixture_name + ".json")
	if fixture_name.is_empty() or not FileAccess.file_exists(path):
		_error_and_fail("%s fixture %s does not exist" % [what, fixture_name])
		return ""
	var text: String = FileAccess.get_file_as_string(path)
	if FileAccess.get_open_error() != OK:
		_error_and_fail("could not read %s fixture %s" % [what, fixture_name])
		return ""
	return text
