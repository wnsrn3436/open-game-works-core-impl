extends UnitTestCase
## BootstrapCore launch values: text only, the random base and the frame step passed to `TimeCore`, and the launch
## value file of the page in the browser runtime with the launch values the export holds.

const _SUPPORT := preload("res://core/bootstrap_core/tests/support/boot_test_support.gd")
const _ENTRY := preload("res://core/bootstrap_core/tests/support/boot_test_entry.gd")

const _FILE_DIR: String = "user://bootstrap_core_launch_values/"
const _PAGE_FILE: String = _FILE_DIR + "page.json"
const _EXPORT_FILE: String = _FILE_DIR + "export.json"


func after_each() -> void:
	await super()
	for path: String in [_PAGE_FILE, _EXPORT_FILE]:
		if FileAccess.file_exists(path):
			DirAccess.remove_absolute(path)


func _boot() -> void:
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	_SUPPORT.start(_ENTRY.new(), _SUPPORT.modules())
	await UnitTestCore.wait_latch(latch)


func _restart() -> void:
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	BootstrapCore.request_restart()
	await UnitTestCore.wait_latch(latch)


## Boots with `launch_values` and checks the boot is fatal in `InitModules` 1. The error logs reach the test only in
## the first boot of a test: `shutdown` releases `LogCore` with the log collector of the test, and a boot that is
## fatal in `InitModules` 1 passes no test replacements, so `with_logs` is false for a later boot.
func _check_fatal(launch_values: Dictionary[String, String], with_logs: bool = true) -> void:
	_SUPPORT.prepare(launch_values)
	await _boot_until_halted()
	assert_false("stage:LoadData" in BootstrapCore._trace, str(launch_values))
	assert_false("TimeCore.init" in BootstrapCore._trace, str(launch_values))
	if with_logs:
		assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 2, str(launch_values))
	BootstrapCoreDev.shutdown()


## Boots with the launch value file `text` and checks the boot is fatal in `InitModules` 1.
func _check_file_fatal(text: String) -> void:
	_SUPPORT.prepare()
	_write(_PAGE_FILE, text)
	_read_from(_PAGE_FILE, "")
	await _boot_until_halted()
	assert_false("stage:LoadData" in BootstrapCore._trace, text)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 2, text)
	assert_eq(CoreBuildInfo.storage_root, CoreBuildInfo.DEFAULT_STORAGE_ROOT, text)


func _boot_until_halted() -> void:
	_SUPPORT.start(_ENTRY.new(), _SUPPORT.modules())
	assert_true(await _SUPPORT.wait_stage(BootstrapCore.BootStage.HALTED), "boot stage HALTED")


## Writes `text` as the launch value file at `path`.
static func _write(path: String, text: String) -> void:
	DirAccess.make_dir_recursive_absolute(_FILE_DIR)
	var file := FileAccess.open(path, FileAccess.WRITE)
	file.store_string(text)
	file.close()


## The dev run reads the launch values from the launch value file `page` (instead of the command line) and, in an
## export, `export_file` (instead of the file of the export).
static func _read_from(page: String, export_file: String) -> void:
	BootstrapCore._launch_values.clear()
	BootstrapCore._launch_values_read = false
	BootstrapCore._test_launch_values_path = page
	BootstrapCore._test_export_launch_values_path = export_file


## The operations of `TimeCore` that the boot called from its `InitModules` stage to `TimeCore.init`, per boot.
static func _time_calls_before_init() -> Array[PackedStringArray]:
	var boots: Array[PackedStringArray] = []
	var calls := PackedStringArray()
	var in_boot := false
	for operation: String in BootstrapCore._trace:
		if operation == "stage:InitModules":
			in_boot = true
			calls = PackedStringArray()
		elif in_boot and operation == "TimeCore.init":
			boots.append(calls)
			in_boot = false
		elif in_boot and operation.begins_with("TimeCore."):
			calls.append(operation)
	return boots


func test_random_base_is_passed_before_time_core_init_in_every_boot() -> void:
	_SUPPORT.prepare({"OGW_RANDOM_BASE": "42"})
	await _boot()
	assert_eq(TimeCore.make_random_seed("a"), UtilCore.make_purpose_seed("a", 42))
	await _restart()
	assert_eq(TimeCore.make_random_seed("a"), UtilCore.make_purpose_seed("a", 42), "first seed of the boot after a restart")
	var boots := _time_calls_before_init()
	assert_eq(boots.size(), 2)
	for calls: PackedStringArray in boots:
		assert_true("TimeCore.set_random_base" in calls, str(calls))
		assert_false("TimeCore.set_frame_step" in calls, str(calls))

	BootstrapCoreDev.shutdown()
	_SUPPORT.prepare({"OGW_RANDOM_BASE": ""})
	await _boot()
	assert_eq(_SUPPORT.count("TimeCore.set_random_base"), 0)


func test_random_base_takes_the_whole_int64_range() -> void:
	var cases: Dictionary[String, int] = {
		"9223372036854775807": 9223372036854775807,
		"-9223372036854775808": -9223372036854775807 - 1,
		"-0": 0,
		"007": 7,
		"-42": -42,
	}
	for text: String in cases:
		_SUPPORT.prepare({"OGW_RANDOM_BASE": text})
		await _boot()
		assert_eq(BootstrapCore._random_base, cases[text], text)
		assert_eq(TimeCore.make_random_seed("a"), UtilCore.make_purpose_seed("a", cases[text]), text)
		BootstrapCoreDev.shutdown()
	assert_false(BootstrapCore._has_random_base, "shutdown clears the base")


func test_random_base_1_5_is_fatal() -> void:
	await _check_fatal({"OGW_RANDOM_BASE": "1.5"})


func test_random_base_plus_1_is_fatal() -> void:
	await _check_fatal({"OGW_RANDOM_BASE": "+1"})


func test_random_base_above_int64_is_fatal() -> void:
	await _check_fatal({"OGW_RANDOM_BASE": "9223372036854775808"})


func test_random_base_outside_its_syntax_is_fatal() -> void:
	var first := true
	for text: String in ["-9223372036854775809", "-", "1e3", " 1", "12345678901234567890", "0x10"]:
		await _check_fatal({"OGW_RANDOM_BASE": text}, first)
		first = false


func test_frame_step_is_passed_before_time_core_init_in_every_boot() -> void:
	_SUPPORT.prepare({"OGW_FRAME_STEP_FPS": "60"})
	await _boot()
	assert_eq(TimeCoreDev.get_frame_step_fps(), 60)
	await _restart()
	assert_eq(TimeCoreDev.get_frame_step_fps(), 60, "boot after a restart")
	var boots := _time_calls_before_init()
	assert_eq(boots.size(), 2)
	for calls: PackedStringArray in boots:
		assert_true("TimeCore.set_frame_step" in calls, str(calls))
		assert_false("TimeCore.set_random_base" in calls, str(calls))

	BootstrapCoreDev.shutdown()
	_SUPPORT.prepare({"OGW_FRAME_STEP_FPS": ""})
	await _boot()
	assert_eq(_SUPPORT.count("TimeCore.set_frame_step"), 0)
	assert_eq(TimeCoreDev.get_frame_step_fps(), 0)


func test_frame_step_bounds() -> void:
	for text: String in ["1", "9999"]:
		_SUPPORT.prepare({"OGW_FRAME_STEP_FPS": text})
		await _boot()
		assert_eq(TimeCoreDev.get_frame_step_fps(), text.to_int(), text)
		BootstrapCoreDev.shutdown()


func test_frame_step_0_is_fatal() -> void:
	await _check_fatal({"OGW_FRAME_STEP_FPS": "0"})


func test_frame_step_60_5_is_fatal() -> void:
	await _check_fatal({"OGW_FRAME_STEP_FPS": "60.5"})


func test_frame_step_plus_60_is_fatal() -> void:
	await _check_fatal({"OGW_FRAME_STEP_FPS": "+60"})


func test_frame_step_10000_is_fatal() -> void:
	await _check_fatal({"OGW_FRAME_STEP_FPS": "10000"})


func test_frame_step_outside_its_syntax_is_fatal() -> void:
	var first := true
	for text: String in ["060", "-60", "6 0", "1e2"]:
		await _check_fatal({"OGW_FRAME_STEP_FPS": text}, first)
		first = false


func test_random_base_json_number_in_the_launch_value_file_is_fatal() -> void:
	await _check_file_fatal('{"OGW_RANDOM_BASE": 1}')


func test_instance_id_json_number_in_the_launch_value_file_is_fatal() -> void:
	await _check_file_fatal('{"OGW_INSTANCE_ID": 1}')


func test_null_value_in_the_launch_value_file_is_fatal() -> void:
	await _check_file_fatal('{"OGW_INSTANCE_ID": "i1", "OGW_PLATFORM": null}')


func test_launch_value_file_that_is_not_json_is_fatal() -> void:
	await _check_file_fatal('{"OGW_INSTANCE_ID": "i1"')


func test_launch_value_file_that_is_a_json_array_is_fatal() -> void:
	await _check_file_fatal('["OGW_INSTANCE_ID", "i1"]')


func test_export_launch_value_file_that_is_not_a_json_object_is_fatal() -> void:
	_SUPPORT.prepare()
	_write(_PAGE_FILE, '{"OGW_INSTANCE_ID": "i1"}')
	_write(_EXPORT_FILE, '"OGW_INSTANCE_ID"')
	_read_from(_PAGE_FILE, _EXPORT_FILE)
	await _boot_until_halted()
	assert_false("stage:LoadData" in BootstrapCore._trace)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 2)


func test_launch_value_file_of_strings_reaches_the_build_info() -> void:
	_SUPPORT.prepare()
	_write(_PAGE_FILE, '{"OGW_INSTANCE_ID": "i2", "OGW_RANDOM_BASE": "42", "OGW_FRAME_STEP_FPS": "30"}')
	_read_from(_PAGE_FILE, "")
	await _boot()
	assert_eq(BootstrapCore.get_build_info().instance_id, "i2")
	assert_eq(TimeCore.make_random_seed("a"), UtilCore.make_purpose_seed("a", 42))
	assert_eq(TimeCoreDev.get_frame_step_fps(), 30)


## A launch value that the launch value file does not give and the export holds takes the value of the export, and
## a value both give takes the value of the file. In the browser runtime the file is the one the page passed
## (`OGW_INSTANCE_ID` `i1`, `tests/web_launch_values.json`); a native run gives it in place of the command line.
func test_launch_value_the_page_does_not_pass_takes_the_value_of_the_export() -> void:
	_SUPPORT.prepare()
	_write(_EXPORT_FILE, '{"OGW_INSTANCE_ID": "export_id", "OGW_PLATFORM": "android", "OGW_RANDOM_BASE": "7"}')
	var page := ""
	if OS.get_name() != "Web":
		page = _PAGE_FILE
		_write(_PAGE_FILE, '{"OGW_INSTANCE_ID": "i1"}')
	_read_from(page, _EXPORT_FILE)
	await _boot()
	var info := BootstrapCore.get_build_info()
	assert_eq(info.instance_id, "i1", "the value of the page is taken over the value of the export")
	assert_eq(info.platform, "android", "a value the page does not pass takes the value of the export")
	assert_eq(TimeCore.make_random_seed("a"), UtilCore.make_purpose_seed("a", 7))


func test_value_that_is_not_a_json_string_in_the_export_file_is_fatal() -> void:
	_SUPPORT.prepare()
	_write(_PAGE_FILE, '{"OGW_INSTANCE_ID": "i1"}')
	_write(_EXPORT_FILE, '{"OGW_RANDOM_BASE": 42}')
	_read_from(_PAGE_FILE, _EXPORT_FILE)
	await _boot_until_halted()
	assert_false("stage:LoadData" in BootstrapCore._trace)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 2)


func test_browser_page_launch_value_reaches_the_build_info() -> void:
	if OS.get_name() != "Web":
		assert_eq(BootstrapCoreDev.get_launch_value("OGW_INSTANCE_ID"), "", "a native run reads no page file")
		return
	_SUPPORT.prepare()
	_read_from("", "")
	await _boot()
	assert_eq(BootstrapCore.get_build_info().instance_id, "i1")
	assert_eq(CoreBuildInfo.storage_root, "user://instances/i1/")
