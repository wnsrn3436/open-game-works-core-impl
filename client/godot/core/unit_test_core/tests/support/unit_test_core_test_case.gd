extends UnitTestCase
## Base of the UnitTestCore core tests: nested runs of the sample test files in `tests/resources/`, GUT runs of their
## own that end early, and the suspension of the run of the test while a test `init`s and `release`s UnitTestCore
## itself.

const RESOURCES: String = "res://core/unit_test_core/tests/resources/"
const KIND_CORE: String = "core"
const KIND_REGRESSION: String = "regression"
const NESTED_TIME_LIMIT_MS: int = 30000
const RunState := preload("res://core/unit_test_core/dev/unit_test_run.gd")
const ResultItem := preload("res://core/unit_test_core/dev/unit_test_result.gd")
const RunConfig := preload("res://core/unit_test_core/dev/unit_test_config.gd")
const ScriptLogger := preload("res://core/unit_test_core/dev/unit_test_script_logger.gd")


## Wakes a wait when any signal connected to `wake` comes.
class Waker extends RefCounted:
	signal woke

	var woken: bool = false

	func wake() -> void:
		woken = true
		woke.emit()


## Records the quit of a GUT run that ended early, in place of the quit of the engine.
class QuitRecorder extends RefCounted:
	signal quitted

	var codes: Array[int] = []

	func quit(code: int) -> void:
		codes.append(code)
		quitted.emit()


## A GUT run of its own that ended early: its run, the requests its test host got, and its quit.
class RootRun extends RefCounted:
	var run: RunState = null
	var requests: Array[UnitTestHttpRequest] = []
	var quit_codes: Array[int] = []
	## The result file the test host got, or an empty string.
	var result_text: String = ""


## The UnitTestCore state a test puts aside while it `init`s and `release`s UnitTestCore itself.
class Saved extends RefCounted:
	var is_initialized: bool = false
	var node: Node = null
	var test_time_limit_ms: int = 0
	var run_time_limit_ms: int = 0
	var run: RunState = null
	var outer_runs: Array[RunState] = []
	var replaced: bool = false
	var script_logger: ScriptLogger = null
	var early_end: RunState = null
	var quit: Callable = Callable()
	var settings_types: Dictionary[String, String] = {}


## Runs the sample test files `files` of `RESOURCES` in a nested GUT run and returns that run when GUT ends it, or
## when UnitTestCore stops it because a test did not return after its time limit. Async.
func run_nested(files: PackedStringArray, kind: String = KIND_CORE, core_dir: String = "", shared_dir: String = "", time_limit_ms: int = NESTED_TIME_LIMIT_MS) -> RunState:
	var nested: GutMain = GutMain.new()
	add_child(nested)
	for file: String in files:
		nested.add_script(RESOURCES + file)
	UnitTestCore._push_run(nested, kind, core_dir, shared_dir, time_limit_ms)
	var waker: Waker = Waker.new()
	assert_eq(nested.end_run.connect(waker.wake), OK, "follow the end of the nested run")
	assert_eq(UnitTestCore._run.stopped.connect(waker.wake), OK, "follow the stop of the nested run")
	nested.test_scripts()
	if not waker.woken:
		await waker.woke
	var run: RunState = await UnitTestCore._pop_run()
	remove_child(nested)
	nested.queue_free()
	return run


## Runs the sample test files `files` of `RESOURCES` as a test run of their own: UnitTestCore of its own with the test
## time limit `test_time_limit_ms` and the run time limit `run_time_limit_ms`, its GUT run in a GUT runner GUI layer,
## and a loopback HTTP server of this test as its test host. Returns when the run quits, which a `QuitRecorder` takes
## in place of the engine, and, when `wait_gut_end` is true, after its GUT run ended too. Async.
func run_root(files: PackedStringArray, test_time_limit_ms: int, run_time_limit_ms: int, wait_gut_end: bool) -> RootRun:
	var root: RootRun = RootRun.new()
	var host: String = await UnitTestCore.start_http_server()
	assert_false(host.is_empty(), "a test host")
	var none: Array[PackedStringArray] = []
	assert_true(await UnitTestCore.add_http_response(host, "/result", 204, none, PackedByteArray()), "PUT /result")
	assert_true(await UnitTestCore.add_http_response(host, "/released", 204, none, PackedByteArray()), "PUT /released")
	assert_true(UnitTestCore.set_test_settings("UnitTestCore.testTimeLimitMs", test_time_limit_ms))
	assert_true(UnitTestCore.set_test_settings("UnitTestCore.runTimeLimitMs", run_time_limit_ms))
	var layer: CanvasLayer = CanvasLayer.new()
	layer.name = "GutLayer"
	add_child(layer)
	var gut: GutMain = GutMain.new()
	layer.add_child(gut)
	for file: String in files:
		gut.add_script(RESOURCES + file)
	var gut_end: Waker = Waker.new()
	assert_eq(gut.end_run.connect(gut_end.wake), OK, "follow the end of the GUT run")
	var quit: QuitRecorder = QuitRecorder.new()
	var saved: Saved = suspend()
	UnitTestCore._quit = quit.quit
	var config: RunConfig = RunConfig.new()
	config.run_id = "root"
	config.test_host = host
	config.has_core_fixture_dir = true
	assert_true(UnitTestCore.init(), "init of the run")
	UnitTestCore._begin_run(gut, config)
	root.run = UnitTestCore._run
	assert_false(layer.visible, "the run hides the GUT runner GUI")
	gut.test_scripts()
	if quit.codes.is_empty():
		await quit.quitted
	if wait_gut_end and not gut_end.woken:
		await gut_end.woke
	resume(saved)
	CoreSettings._clear_test_values()
	root.quit_codes = quit.codes
	root.requests = await UnitTestCore.http_requests(host)
	for request: UnitTestHttpRequest in root.requests:
		if request.path == "/result":
			root.result_text = request.body.get_string_from_utf8()
	remove_child(layer)
	layer.queue_free()
	return root


## Result of test function `function_name` of a run, or null.
static func result_of(run: RunState, function_name: String) -> ResultItem:
	for result: ResultItem in run.results:
		if result.name.ends_with("::" + function_name):
			return result
	return null


## Status of test function `function_name` of a run, or an empty string.
static func status_of(run: RunState, function_name: String) -> String:
	var result: ResultItem = result_of(run, function_name)
	return result.status if result != null else ""


## Status of every result of a run by test name.
static func statuses(run: RunState) -> Dictionary[String, String]:
	var by_name: Dictionary[String, String] = {}
	for result: ResultItem in run.results:
		by_name[result.name] = result.status
	return by_name


## Puts the UnitTestCore state of this run aside and leaves UnitTestCore as before its first `init`.
func suspend() -> Saved:
	var saved: Saved = Saved.new()
	saved.is_initialized = UnitTestCore._is_initialized
	saved.node = UnitTestCore._node
	saved.test_time_limit_ms = UnitTestCore._test_time_limit_ms
	saved.run_time_limit_ms = UnitTestCore._run_time_limit_ms
	saved.run = UnitTestCore._run
	saved.outer_runs = UnitTestCore._outer_runs
	saved.replaced = UnitTestCore._replaced
	saved.script_logger = UnitTestCore._script_logger
	saved.early_end = UnitTestCore._early_end
	saved.quit = UnitTestCore._quit
	saved.settings_types = UnitTestCore._settings_types
	if get_tree().node_removed.is_connected(UnitTestCore._on_node_removed):
		get_tree().node_removed.disconnect(UnitTestCore._on_node_removed)
	UnitTestCore._is_initialized = false
	UnitTestCore._node = null
	UnitTestCore._test_time_limit_ms = 0
	UnitTestCore._run_time_limit_ms = 0
	UnitTestCore._run = null
	UnitTestCore._outer_runs = []
	UnitTestCore._replaced = false
	UnitTestCore._script_logger = null
	UnitTestCore._early_end = null
	UnitTestCore._quit = Callable()
	UnitTestCore._settings_types = {}
	return saved


## Puts back the state `suspend` put aside.
func resume(saved: Saved) -> void:
	if UnitTestCore._is_initialized:
		UnitTestCore.release()
	UnitTestCore._is_initialized = saved.is_initialized
	UnitTestCore._node = saved.node
	UnitTestCore._test_time_limit_ms = saved.test_time_limit_ms
	UnitTestCore._run_time_limit_ms = saved.run_time_limit_ms
	UnitTestCore._run = saved.run
	UnitTestCore._outer_runs = saved.outer_runs
	UnitTestCore._replaced = saved.replaced
	UnitTestCore._script_logger = saved.script_logger
	UnitTestCore._early_end = saved.early_end
	UnitTestCore._quit = saved.quit
	UnitTestCore._settings_types = saved.settings_types
	if saved.is_initialized and not get_tree().node_removed.is_connected(UnitTestCore._on_node_removed):
		assert_eq(get_tree().node_removed.connect(UnitTestCore._on_node_removed), OK, "follow the removed nodes again")


## Whether every static variable of UnitTestCore has its initial value.
func assert_initial_state() -> void:
	assert_false(UnitTestCore._is_initialized, "_is_initialized")
	assert_null(UnitTestCore._node, "_node")
	assert_eq(UnitTestCore._test_time_limit_ms, 0, "_test_time_limit_ms")
	assert_eq(UnitTestCore._run_time_limit_ms, 0, "_run_time_limit_ms")
	assert_null(UnitTestCore._run, "_run")
	assert_true(UnitTestCore._outer_runs.is_empty(), "_outer_runs")
	assert_false(UnitTestCore._replaced, "_replaced")
	assert_null(UnitTestCore._script_logger, "_script_logger")
	assert_null(UnitTestCore._early_end, "_early_end")
	assert_false(UnitTestCore._quit.is_valid(), "_quit")
	assert_true(UnitTestCore._settings_types.is_empty(), "_settings_types")


## Path of the first `.json` file in the core fixture folder of this run, or an empty string.
static func first_core_fixture() -> String:
	var dir: String = UnitTestCore._run.config.core_fixture_dir
	var access: DirAccess = DirAccess.open(dir)
	if access == null:
		return ""
	for file: String in access.get_files():
		if file.ends_with(".json"):
			return dir.path_join(file)
	return ""
