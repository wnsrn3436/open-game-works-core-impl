extends "res://core/unit_test_core/tests/support/unit_test_core_test_case.gd"
## Test runs: test setup between tests, results, run failures, exit code, result file and time limit. The sample test
## files run in nested runs, so their failures do not fail this run.

const STUCK := preload("res://core/unit_test_core/tests/resources/sample_stuck_signal.gd")
const EARLY := preload("res://core/unit_test_core/tests/resources/sample_run_time_limit.gd")


func test_module_a_test_left_initialized_inits_in_the_next_test() -> void:
	var run: RunState = await run_nested(PackedStringArray(["sample_lifecycle.gd"]))
	assert_eq(status_of(run, "test_a_leaves_modules_initialized"), "pass")
	assert_eq(status_of(run, "test_b_initializes_them_again"), "pass")


func test_files_one_by_one_and_all_at_once_give_the_same_results() -> void:
	var files: PackedStringArray = PackedStringArray(["sample_lifecycle.gd", "sample_storage.gd", "sample_state.gd", "sample_results.gd"])
	var one_by_one: Dictionary[String, String] = {}
	for file: String in files:
		var single: RunState = await run_nested(PackedStringArray([file]))
		one_by_one.merge(statuses(single))
	var all: RunState = await run_nested(files)
	var together: Dictionary[String, String] = statuses(all)
	assert_eq(together.size(), 8, "every test of the files")
	assert_eq(together, one_by_one)
	for test_name: String in together.keys():
		var expected: String = "fail" if test_name.ends_with("::test_fails") else "pass"
		assert_eq(together[test_name], expected, test_name)


func test_app_storage_file_of_a_test_is_gone_in_the_next_and_after_the_run() -> void:
	var kept: String = "user://unit_test_core_kept.txt"
	var file: FileAccess = FileAccess.open(kept, FileAccess.WRITE)
	assert_not_null(file, "a file from before the run")
	if file == null:
		return
	file.close()
	var run: RunState = await run_nested(PackedStringArray(["sample_storage.gd"]))
	assert_eq(status_of(run, "test_a_writes_a_file"), "pass")
	assert_eq(status_of(run, "test_b_does_not_find_it"), "pass")
	assert_true(FileAccess.file_exists(kept), "a file from before the run stays")
	assert_false(FileAccess.file_exists("user://unit_test_core_sample/written.txt"), "a file of the run is gone")
	assert_false(DirAccess.dir_exists_absolute("user://unit_test_core_sample"), "a folder of the run is gone")
	assert_eq(DirAccess.remove_absolute(kept), OK)


func test_unchecked_error_log_fails_the_test_and_checked_logs_do_not() -> void:
	var run: RunState = await run_nested(PackedStringArray(["sample_logs.gd"]))
	assert_eq(status_of(run, "test_unchecked_error_log"), "fail")
	assert_string_contains(result_of(run, "test_unchecked_error_log").message, "Sample: not checked")
	assert_eq(status_of(run, "test_checked_error_log"), "pass")
	assert_eq(status_of(run, "test_warn_log"), "pass")
	var warns: Dictionary[String, int] = {"Sample": 1}
	assert_eq(run.warn_counts, warns)
	assert_true(run.run_failures.is_empty(), "no run failure")


# ogw:input_boundary
func test_unchecked_script_error_fails_the_test_and_the_result_has_the_checked_ones() -> void:
	var run: RunState = await run_nested(PackedStringArray(["sample_script_errors.gd"]))
	assert_eq(UnitTestCore.check_script_errors(), 3, "the script errors of the nested run happened in this test too")
	assert_eq(status_of(run, "test_unchecked_script_error"), "fail")
	assert_string_contains(result_of(run, "test_unchecked_script_error").message, "1 unchecked engine script runtime errors")
	assert_eq(result_of(run, "test_unchecked_script_error").checked_script_errors, 0)
	assert_eq(status_of(run, "test_checked_script_errors"), "pass")
	assert_eq(result_of(run, "test_checked_script_errors").checked_script_errors, 2)
	assert_eq(status_of(run, "test_no_script_error"), "pass")
	assert_eq(result_of(run, "test_no_script_error").checked_script_errors, 0)
	assert_true(run.run_failures.is_empty(), "no run failure")
	var parsed: Variant = JSON.parse_string(UnitTestCore._result_json(run))
	var counts: Dictionary[String, int] = {}
	if parsed is Dictionary:
		var result: Dictionary = parsed
		var items: Variant = result.get("results")
		if items is Array:
			var list: Array = items
			for item: Variant in list:
				var object: Dictionary = item if item is Dictionary else {}
				var count: Variant = object.get("checked_script_errors")
				var number: float = count if count is float else -1.0
				counts[str(object.get("name")).get_slice("::", 1)] = roundi(number)
	var expected: Dictionary[String, int] = {"test_unchecked_script_error": 0, "test_checked_script_errors": 2, "test_no_script_error": 0}
	assert_eq(counts, expected, "checked_script_errors of each test in the result file")


func test_error_log_of_a_release_in_the_next_test_setup_is_a_run_failure_and_keeps_the_results() -> void:
	var run: RunState = await run_nested(PackedStringArray(["sample_after_logs.gd"]))
	var first: String = RESOURCES + "sample_after_logs.gd::test_a_leaves_a_module_that_logs_in_its_release"
	assert_eq(status_of(run, "test_a_leaves_a_module_that_logs_in_its_release"), "pass")
	assert_eq(status_of(run, "test_b_runs_after_it"), "pass")
	assert_eq(run.run_failures, PackedStringArray([
		"unchecked error logs after %s: ReleaseLogProbe: release failed" % first,
	]))


func test_script_error_between_tests_is_a_run_failure_and_keeps_the_results() -> void:
	var run: RunState = await run_nested(PackedStringArray(["sample_script_error_between_tests.gd"]))
	assert_eq(UnitTestCore.check_script_errors(), 1, "the script error of the nested run happened in this test too")
	var first: String = RESOURCES + "sample_script_error_between_tests.gd::test_a_passes"
	assert_eq(status_of(run, "test_a_passes"), "pass")
	assert_eq(result_of(run, "test_a_passes").checked_script_errors if result_of(run, "test_a_passes") != null else -1, 0)
	assert_eq(status_of(run, "test_b_runs_after_it"), "pass")
	assert_eq(run.run_failures, PackedStringArray(["1 engine script runtime errors after %s" % first]))


func test_next_test_starts_after_the_deletes_of_the_servers_of_the_test_before() -> void:
	var run: RunState = await run_nested(PackedStringArray(["sample_server_delete.gd"]))
	var first: String = RESOURCES + "sample_server_delete.gd::test_a_leaves_servers"
	assert_eq(status_of(run, "test_a_leaves_servers"), "pass")
	assert_eq(status_of(run, "test_b_starts_after_the_deletes"), "pass")
	assert_eq(run.run_failures.size(), 1, "the delete the test host refused")
	if run.run_failures.size() == 1:
		assert_string_contains(run.run_failures[0], "unchecked error logs after %s: " % first)
		assert_string_contains(run.run_failures[0], "DELETE /servers/999999 failed")


func test_exit_code_is_one_for_a_failed_test_no_tests_or_a_file_that_did_not_load() -> void:
	var passing: RunState = await run_nested(PackedStringArray(["sample_lifecycle.gd"]))
	assert_eq(UnitTestCore._exit_code(passing), 0, "every test passed")
	var failing: RunState = await run_nested(PackedStringArray(["sample_results.gd"]))
	assert_eq(UnitTestCore._exit_code(failing), 1, "a failed test")
	var empty: RunState = await run_nested(PackedStringArray(["sample_empty.gd"]))
	assert_eq(empty.run_failures, PackedStringArray(["no tests"]))
	assert_eq(UnitTestCore._exit_code(empty), 1, "no tests")
	var missing: String = RESOURCES + "no_such_test_file.gd"
	UnitTestCore._add_missing_scripts(passing, PackedStringArray([RESOURCES + "sample_lifecycle.gd", missing]))
	assert_eq(passing.run_failures, PackedStringArray(["test file %s did not load" % missing]))
	assert_eq(UnitTestCore._exit_code(passing), 1, "a test file that did not load")


# ogw:input_boundary
func test_init_failure_gives_an_ended_run_with_the_reason_and_exit_code_one() -> void:
	assert_true(UnitTestCore.set_invalid_test_settings("UnitTestCore.runTimeLimitMs", "slow"))
	var saved: Saved = suspend()
	assert_false(UnitTestCore.init(), "init without an integer run time limit")
	var config: RunConfig = RunConfig.new()
	config.run_id = "init-failure"
	config.has_core_fixture_dir = true
	var run: RunState = UnitTestCore._init_failure_run(config)
	resume(saved)
	CoreSettings._clear_test_values()
	assert_true(run.ended, "the run ended")
	assert_true(run.results.is_empty(), "no test ran")
	assert_eq(run.run_failures, PackedStringArray([
		"UnitTestCore init failed: core settings UnitTestCore.testTimeLimitMs and UnitTestCore.runTimeLimitMs must be integers; no test ran",
	]))
	assert_eq(UnitTestCore._exit_code(run), 1)
	var parsed: Variant = JSON.parse_string(UnitTestCore._result_json(run))
	assert_true(parsed is Dictionary, "a result file")
	if not parsed is Dictionary:
		return
	var result: Dictionary = parsed
	assert_eq(str(result.get("run_id")), "init-failure")
	assert_eq(str(result.get("kind")), "core")
	assert_eq(JSON.stringify(result.get("results")), "[]")
	assert_eq(JSON.stringify(result.get("run_failures")), JSON.stringify([{"message": run.run_failures[0]}]))


func test_selected_test_files_follow_the_prefix_and_the_folders() -> void:
	var found: PackedStringArray = PackedStringArray()
	UnitTestCore._find_test_files("res://core/unit_test_core/tests", "sample_", ".gd", true, found)
	assert_true(found.has(RESOURCES + "sample_results.gd"), "a file of a subfolder")
	found.clear()
	UnitTestCore._find_test_files("res://core/unit_test_core/tests", "sample_", ".gd", false, found)
	assert_true(found.is_empty(), "no file without the subfolders")


# ogw:input_boundary
func test_result_file_has_its_form_and_every_test() -> void:
	var run: RunState = await run_nested(PackedStringArray(["sample_results.gd", "sample_logs.gd"]))
	var parsed: Variant = JSON.parse_string(UnitTestCore._result_json(run))
	assert_true(parsed is Dictionary, "a JSON object")
	if not parsed is Dictionary:
		return
	var result: Dictionary = parsed
	var keys: PackedStringArray = PackedStringArray()
	for key: Variant in result.keys():
		keys.append(str(key))
	assert_eq(keys, PackedStringArray(["run_id", "kind", "engine", "started_at", "finished_at", "results", "run_failures", "warn_counts"]))
	var run_id: Variant = result.get("run_id")
	var started_at: Variant = result.get("started_at")
	var finished_at: Variant = result.get("finished_at")
	var kind: String = str(result.get("kind"))
	var engine: String = str(result.get("engine"))
	assert_eq(kind, "core")
	assert_eq(engine, "godot")
	assert_true(run_id is String, "run_id")
	assert_true(started_at is float and finished_at is float, "Unix ms numbers")
	var warn_text: String = JSON.stringify(result.get("warn_counts"))
	var failure_text: String = JSON.stringify(result.get("run_failures"))
	assert_eq(warn_text, '{"Sample":1.0}')
	assert_eq(failure_text, "[]")
	var results: Variant = result.get("results")
	assert_true(results is Array, "results")
	if not results is Array:
		return
	var items: Array = results
	assert_eq(items.size(), 5, "every test")
	var names: PackedStringArray = PackedStringArray()
	for item: Variant in items:
		var object: Dictionary = item if item is Dictionary else {}
		var item_keys: PackedStringArray = PackedStringArray()
		for key: Variant in object.keys():
			item_keys.append(str(key))
		assert_eq(item_keys, PackedStringArray(["name", "status", "duration_ms", "message", "checked_script_errors"]))
		names.append(str(object.get("name")))
		var status: String = str(object.get("status"))
		var message: String = str(object.get("message"))
		var duration: Variant = object.get("duration_ms")
		assert_true(status == "pass" or status == "fail", status)
		assert_eq(message.is_empty(), status == "pass", "message only for a failure")
		assert_true(duration is float, "duration_ms")
	assert_true(names.has(RESOURCES + "sample_results.gd::test_fails"), "test name form")


func test_test_past_the_time_limit_fails_and_the_next_test_runs() -> void:
	var run: RunState = await run_nested(PackedStringArray(["sample_time_limit.gd"]), KIND_CORE, "", "", 300)
	assert_eq(status_of(run, "test_a_waits_past_the_time_limit"), "fail")
	assert_string_contains(result_of(run, "test_a_waits_past_the_time_limit").message, "time limit 300 ms")
	assert_eq(status_of(run, "test_b_runs_after_it"), "pass")


func test_test_that_does_not_return_after_its_time_limit_fails_and_ends_the_run() -> void:
	var run: RunState = await run_nested(PackedStringArray(["sample_stuck_signal.gd"]), KIND_CORE, "", "", 300)
	STUCK.never = null
	var stuck: String = "test_a_awaits_a_signal_that_never_comes"
	assert_eq(status_of(run, stuck), "fail")
	var message: String = result_of(run, stuck).message if result_of(run, stuck) != null else ""
	assert_string_contains(message, "test time limit 300 ms passed")
	assert_string_contains(message, "did not return within 300 ms after its test time limit")
	assert_eq(status_of(run, "test_b_runs_after_it"), "", "no later test runs")
	assert_eq(run.run_failures.size(), 1, "one run failure")
	if run.run_failures.size() == 1:
		assert_string_contains(run.run_failures[0], RESOURCES + "sample_stuck_signal.gd::" + stuck + " did not return")
	assert_eq(UnitTestCore._exit_code(run), 1)


func test_run_past_its_run_time_limit_runs_no_more_test_and_quits_after_its_release() -> void:
	EARLY.started.clear()
	var files_before: Dictionary[String, bool] = UnitTestCore._list_storage_files()
	var root: RootRun = await run_root(PackedStringArray(["sample_run_time_limit.gd"]), NESTED_TIME_LIMIT_MS, 600, true)
	var waiting: String = "test_a_waits_past_the_run_time_limit"
	var message: String = "run time limit 600 ms passed; the remaining tests did not run"
	assert_eq(EARLY.started, PackedStringArray([waiting]), "no later test started")
	var expected: Dictionary[String, String] = {RESOURCES + "sample_run_time_limit.gd::" + waiting: "fail"}
	assert_eq(statuses(root.run), expected)
	assert_string_contains(result_of(root.run, waiting).message if result_of(root.run, waiting) != null else "", message)
	_assert_ended_early(root, message)
	assert_false(LogCore.is_initialized(), "the run released LogCore")
	assert_false(EventCore.is_initialized(), "the run released EventCore")
	assert_eq(UnitTestCore._list_storage_files(), files_before, "no app storage file of the run is left")


func test_run_whose_test_does_not_return_quits_after_its_release() -> void:
	var root: RootRun = await run_root(PackedStringArray(["sample_stuck_signal.gd"]), 300, NESTED_TIME_LIMIT_MS, false)
	STUCK.never = null
	var stuck: String = "test_a_awaits_a_signal_that_never_comes"
	var message: String = (
		"%s did not return within 300 ms after its test time limit; the remaining tests did not run"
		% (RESOURCES + "sample_stuck_signal.gd::" + stuck)
	)
	assert_eq(status_of(root.run, stuck), "fail")
	assert_string_contains(result_of(root.run, stuck).message if result_of(root.run, stuck) != null else "", "test time limit 300 ms passed")
	assert_eq(status_of(root.run, "test_b_runs_after_it"), "", "no later test runs")
	_assert_ended_early(root, message)


## A run that ended early with the run failure `message`: its result went to the test host with that one run failure
## and its results, then the release signal, then the quit with exit code 1.
# ogw:input_boundary
func _assert_ended_early(root: RootRun, message: String) -> void:
	assert_eq(root.run.run_failures, PackedStringArray([message]), "one run failure")
	var codes: Array[int] = [1]
	assert_eq(root.quit_codes, codes, "a quit with exit code 1")
	var paths: PackedStringArray = PackedStringArray()
	for request: UnitTestHttpRequest in root.requests:
		paths.append(request.path)
	assert_eq(paths, PackedStringArray(["/result", "/released"]), "the result, then the release signal")
	if root.requests.size() == 2:
		assert_eq(root.requests[1].body.get_string_from_utf8(), '{"run_id": "root"}')
	var parsed: Variant = JSON.parse_string(root.result_text)
	assert_true(parsed is Dictionary, "a result file")
	if not parsed is Dictionary:
		return
	var result_file: Dictionary = parsed
	assert_eq(JSON.stringify(result_file.get("run_failures")), JSON.stringify([{"message": message}]))
	var names: PackedStringArray = PackedStringArray()
	var items: Variant = result_file.get("results")
	if items is Array:
		var list: Array = items
		for item: Variant in list:
			var object: Dictionary = item if item is Dictionary else {}
			names.append(str(object.get("name")))
	var recorded: PackedStringArray = PackedStringArray()
	for result: ResultItem in root.run.results:
		recorded.append(result.name)
	assert_eq(names, recorded, "the result file has every recorded test")


func test_render_test_file_is_skipped_only_in_the_headless_pass_of_core_tests() -> void:
	var path: String = "res://core/some_core/tests/test_render_draw.gd"
	var functions: PackedStringArray = PackedStringArray(["test_one", "test_two"])
	var headless: RunState = _run_of(KIND_CORE, false)
	assert_true(UnitTestCore._skip_test_file(headless, path, functions))
	var skipped: Dictionary[String, String] = {path + "::test_one": "skip", path + "::test_two": "skip"}
	assert_eq(statuses(headless), skipped)
	assert_eq(headless.results[0].message, "render test")
	assert_false(UnitTestCore._skip_test_file(headless, "res://core/some_core/tests/test_draw.gd", functions), "not a render test")
	assert_false(UnitTestCore._skip_test_file(_run_of(KIND_CORE, true), path, functions), "render pass")
	assert_false(UnitTestCore._skip_test_file(_run_of(KIND_REGRESSION, false), path, functions), "regression test")
	var own: PackedStringArray = UnitTestCore._test_functions(self)
	assert_true(own.has("test_render_test_file_is_skipped_only_in_the_headless_pass_of_core_tests"), "test functions of a file")


func test_require_platform_skips_a_core_test_and_fails_a_regression_test() -> void:
	var core: RunState = await run_nested(PackedStringArray(["sample_platform.gd"]))
	assert_eq(status_of(core, "test_requires_another_platform"), "skip")
	assert_eq(status_of(core, "test_requires_this_platform"), "pass")
	var regression: RunState = await run_nested(PackedStringArray(["sample_platform.gd"]), KIND_REGRESSION)
	assert_eq(status_of(regression, "test_requires_another_platform"), "fail")
	assert_eq(status_of(regression, "test_requires_this_platform"), "fail")
	assert_string_contains(result_of(regression, "test_requires_this_platform").message, "require_platform called in a regression test")


func test_set_test_settings_value_is_read_by_a_later_init() -> void:
	assert_true(UnitTestCore.set_test_settings("UnitTestCore.testTimeLimitMs", 4321))
	var saved: Saved = suspend()
	assert_true(UnitTestCore.init(), "init after set_test_settings")
	assert_eq(UnitTestCore._test_time_limit_ms, 4321)
	UnitTestCore.release()
	resume(saved)


func test_set_test_settings_and_set_invalid_test_settings_next_test_unknown_key_other_type_and_regression() -> void:
	var core: RunState = await run_nested(PackedStringArray(["sample_settings.gd"]))
	assert_eq(status_of(core, "test_a_sets_a_value"), "pass")
	assert_eq(status_of(core, "test_b_reads_the_value_without_it"), "pass")
	assert_eq(status_of(core, "test_c_unknown_key"), "fail")
	assert_eq(status_of(core, "test_d_value_of_another_type"), "fail")
	assert_string_contains(result_of(core, "test_d_value_of_another_type").message, "has another type than integer")
	assert_eq(status_of(core, "test_e_fraction_for_an_integer_key"), "fail")
	assert_string_contains(
		result_of(core, "test_e_fraction_for_an_integer_key").message,
		"the value of UnitTestCore.testTimeLimitMs has another type than integer",
	)
	assert_eq(status_of(core, "test_f_array_element_of_another_type"), "fail")
	assert_string_contains(
		result_of(core, "test_f_array_element_of_another_type").message,
		"the value of ResolutionCore.fillColor has another type than array<integer>",
	)
	assert_eq(status_of(core, "test_g_values_of_the_type_of_the_key"), "pass")
	assert_eq(status_of(core, "test_h_invalid_values_of_another_type"), "pass")
	assert_eq(status_of(core, "test_i_reads_the_values_without_the_invalid_ones"), "pass")
	assert_eq(status_of(core, "test_j_invalid_unknown_key"), "fail")
	assert_string_contains(
		result_of(core, "test_j_invalid_unknown_key").message,
		"set_invalid_test_settings: UnitTestCore.noSuchKey is not a core settings key or a game settings item core reads",
	)
	assert_eq(status_of(core, "test_k_string_for_an_object_key"), "fail")
	assert_string_contains(
		result_of(core, "test_k_string_for_an_object_key").message,
		"the value of environments.DEV.adapters has another type than object",
	)
	assert_eq(status_of(core, "test_l_array_element_that_is_no_object"), "fail")
	assert_string_contains(
		result_of(core, "test_l_array_element_that_is_no_object").message,
		"the value of QualityCore.deviceClasses has another type than array<object>",
	)
	assert_eq(status_of(core, "test_m_objects_of_the_type_of_the_key"), "pass")
	assert_eq(status_of(core, "test_n_null_for_a_key_whose_type_has_no_question_mark"), "fail")
	assert_string_contains(
		result_of(core, "test_n_null_for_a_key_whose_type_has_no_question_mark").message,
		"the value of UICore.dimOpacity has another type than number",
	)
	assert_eq(status_of(core, "test_o_string_for_a_nullable_integer_key"), "fail")
	assert_string_contains(
		result_of(core, "test_o_string_for_a_nullable_integer_key").message,
		"the value of consent.minimumAge has another type than integer?",
	)
	assert_eq(status_of(core, "test_p_key_of_the_settings_file_only"), "fail")
	var settings_file_only: String = result_of(core, "test_p_key_of_the_settings_file_only").message
	assert_string_contains(settings_file_only, "set_test_settings: UICore.dimOpacity is not a core settings key")
	assert_string_contains(settings_file_only, "set_invalid_test_settings: UICore.dimOpacity is not a core settings key")
	assert_eq(status_of(core, "test_q_type_file_type_that_is_no_settings_type"), "fail")
	assert_string_contains(
		result_of(core, "test_q_type_file_type_that_is_no_settings_type").message,
		"set_test_settings: UnitTestCore.testTimeLimitMs has the type int in res://generated/core_settings_types.json, which is no settings type",
	)
	var regression: RunState = await run_nested(PackedStringArray(["sample_settings.gd"]), KIND_REGRESSION)
	assert_eq(status_of(regression, "test_a_sets_a_value"), "fail")
	assert_string_contains(result_of(regression, "test_a_sets_a_value").message, "set_test_settings called in a regression test")
	assert_eq(status_of(regression, "test_h_invalid_values_of_another_type"), "fail")
	assert_string_contains(
		result_of(regression, "test_h_invalid_values_of_another_type").message,
		"set_invalid_test_settings called in a regression test",
	)


func test_core_fixture_is_read_from_the_core_fixture_folder() -> void:
	var path: String = first_core_fixture()
	assert_false(path.is_empty(), "a core fixture file")
	if path.is_empty():
		return
	assert_eq(UnitTestCore.read_core_fixture(path.get_file().get_basename()), FileAccess.get_file_as_string(path))


func test_fixture_reads_of_core_and_regression_runs() -> void:
	var dir: String = UnitTestCore._run.config.core_fixture_dir
	var core: RunState = await run_nested(PackedStringArray(["sample_fixtures.gd"]), KIND_CORE, dir)
	assert_eq(status_of(core, "test_core_fixture"), "pass")
	assert_eq(status_of(core, "test_missing_core_fixture"), "fail")
	assert_eq(status_of(core, "test_shared_fixture"), "fail")
	assert_eq(status_of(core, "test_missing_shared_fixture"), "fail")
	var regression: RunState = await run_nested(PackedStringArray(["sample_fixtures.gd"]), KIND_REGRESSION, "", dir)
	assert_eq(status_of(regression, "test_core_fixture"), "fail")
	assert_eq(status_of(regression, "test_missing_core_fixture"), "fail")
	assert_eq(status_of(regression, "test_shared_fixture"), "pass")
	assert_eq(status_of(regression, "test_missing_shared_fixture"), "fail")


static func _run_of(kind: String, render_pass: bool) -> RunState:
	var run: RunState = RunState.new()
	run.kind = kind
	run.render_pass = render_pass
	return run


## The release signal goes to the test host of the run as `PUT /released` with the run ID. A loopback HTTP server
## stands in for the test host, so the request is recorded.
func test_release_signal_sends_the_run_id_to_the_test_host() -> void:
	var base_url: String = await UnitTestCore.start_http_server()
	assert_false(base_url.is_empty(), "a base URL")
	var none: Array[PackedStringArray] = []
	assert_true(await UnitTestCore.add_http_response(base_url, "/released", 204, none, PackedByteArray()))
	var config: RunConfig = RunConfig.new()
	config.run_id = "release-signal"
	config.test_host = base_url
	assert_true(await UnitTestCore._send_released(config), "the test host took the release signal")
	var requests: Array[UnitTestHttpRequest] = await UnitTestCore.http_requests(base_url)
	assert_eq(requests.size(), 1, "one request")
	if requests.size() != 1:
		return
	assert_eq(requests[0].path, "/released")
	assert_eq(requests[0].body.get_string_from_utf8(), '{"run_id": "release-signal"}')
