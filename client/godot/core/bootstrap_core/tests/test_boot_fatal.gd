extends UnitTestCase
## BootstrapCore fatal error: fatal conditions, fatal popup, fatal screen, build info failure.

const _SUPPORT := preload("res://core/bootstrap_core/tests/support/boot_test_support.gd")
const _NETWORK := preload("res://core/bootstrap_core/tests/support/boot_test_network.gd")
const _ENTRY := preload("res://core/bootstrap_core/tests/support/boot_test_entry.gd")
## A built-in data location without data: `DataCore.load` fails.
const _MISSING_DATA: String = "res://core/bootstrap_core/tests/resources/missing_data/"
const _GATE := preload("res://core/bootstrap_core/tests/resources/boot_test_gate.gd")
const _HELD_SCENE := preload("res://core/bootstrap_core/tests/resources/boot_test_held_scene.gd")
const _DEV_WITHOUT_FAKE_ADS := preload("res://core/bootstrap_core/tests/support/boot_test_dev_without_fake_ads.gd")
const _DEV_FATAL := preload("res://core/bootstrap_core/tests/support/boot_test_dev_fatal.gd")
const _BUILD_INFO_FILE: String = "user://boot_test_build_info.json"
## A local data file without a schema version: `LocalDataCore` logs an error when it loads it.
const _BROKEN_LOCAL_DATA := [1, 2]
## A fill image key in neither the resource key list nor a bundle: `ResourceCore` logs an error when
## `ResolutionCore.load_fill_image` loads it.
const _MISSING_FILL_IMAGE: String = "image/boot_test_missing_fill"

## Log listener state of `_fatal_on_log`: the first log of `_fatal_tag` holding `_fatal_text` in boot stage
## `_fatal_stage` reports a fatal.
var _fatal_tag: String = ""
var _fatal_text: String = ""
var _fatal_stage: BootstrapCore.BootStage = BootstrapCore.BootStage.NONE
## The log listener of the test replacements, which `_fatal_on_log` passes every log on to.
var _replaced_listener: Callable = Callable()


static func _failing_init() -> bool:
	return false


static func _not_initialized() -> bool:
	return false


static func _no_release() -> void:
	pass


func _boot_until_halted(entry: _ENTRY, list: Array[CoreModuleEntry]) -> void:
	_SUPPORT.start(entry, list)
	assert_true(await _SUPPORT.wait_stage(BootstrapCore.BootStage.HALTED), "boot stage HALTED")


func test_title_scene_failure_is_fatal_without_next_stage() -> void:
	_SUPPORT.prepare({}, "scene/boot_test_missing")
	await _boot_until_halted(_ENTRY.new(), _SUPPORT.modules())
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.HALTED)
	assert_false("stage:Update" in BootstrapCore._trace)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 1)
	assert_eq(UnitTestCore.check_logs("error", "SceneCore"), 1, "the title scene key is missing")
	assert_eq(UnitTestCore.check_logs("error", "ResourceCore"), 1, "load of the missing title scene key")


func test_module_init_failure_is_fatal_without_next_module_and_stage() -> void:
	_SUPPORT.prepare()
	var list := _SUPPORT.modules()
	var failing := CoreModuleEntry.new()
	failing.name = "BootTestFailingCore"
	failing.init = _failing_init
	failing.release = _no_release
	failing.is_initialized = _not_initialized
	list.insert(2, failing)
	await _boot_until_halted(_ENTRY.new(), list)
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.HALTED)
	assert_false("%s.init" % list[3].name in BootstrapCore._trace)
	assert_false("stage:LoadData" in BootstrapCore._trace)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 1)
	assert_true(BootstrapCore._fatal_screen_shown)


func test_invalid_launch_value_is_fatal_in_init_modules() -> void:
	_SUPPORT.prepare({"OGW_PLATFORM": "IOS"})
	await _boot_until_halted(_ENTRY.new(), _SUPPORT.modules())
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.HALTED)
	assert_false("stage:LoadData" in BootstrapCore._trace)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 2)


func test_data_load_failure_is_fatal_without_next_stage() -> void:
	_SUPPORT.prepare()
	DataCoreDev.set_test_data_location(_MISSING_DATA)
	await _boot_until_halted(_ENTRY.new(), _SUPPORT.modules())
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.HALTED)
	assert_true("DataCore.load" in BootstrapCore._trace)
	assert_false("stage:Prepare" in BootstrapCore._trace)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 1)
	assert_eq(UnitTestCore.check_logs("error", "DataCore"), 1, "the built-in data version is not readable")


func test_load_data_fatal_before_ui_ready_shows_fatal_screen_once_without_popup_or_restart() -> void:
	_SUPPORT.prepare()
	DataCoreDev.set_test_data_location(_MISSING_DATA)
	await _boot_until_halted(_ENTRY.new(), _SUPPORT.modules())
	assert_eq(_SUPPORT.popups().size(), 0)
	assert_eq(UICore.get_open_popup_count(), 0)
	assert_true(is_instance_valid(BootstrapCore._fatal_screen))
	var fatal_layer := UICore.get_layer(UICore.UILayer.FATAL)
	assert_eq(_fatal_screens(fatal_layer), 1)
	BootstrapCore.report_fatal("again")
	await UnitTestCore.wait_frames(3)
	assert_eq(_fatal_screens(fatal_layer), 1)
	assert_eq(_fatal_screens(BootstrapCore._node), 0)
	assert_eq(_SUPPORT.count("stage:InitModules"), 1)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 2)
	assert_eq(UnitTestCore.check_logs("error", "DataCore"), 1, "the built-in data version is not readable")


## Fatal screens under `parent`.
func _fatal_screens(parent: Node) -> int:
	var count := 0
	for child: Node in parent.get_children():
		if child.name == BootstrapCore._FATAL_SCREEN_NAME:
			count += 1
	return count


## A fatal screen with `UICore` initialized is on the `Fatal` UI layer: above every other UI layer and under the
## `Debug` layer.
func test_fatal_screen_is_on_the_fatal_layer_under_the_debug_layer() -> void:
	_SUPPORT.prepare()
	DataCoreDev.set_test_data_location(_MISSING_DATA)
	await _boot_until_halted(_ENTRY.new(), _SUPPORT.modules())
	var fatal_layer := UICore.get_layer(UICore.UILayer.FATAL)
	var screen := BootstrapCore._fatal_screen as Control
	assert_not_null(screen)
	if screen != null:
		assert_eq(screen.get_parent(), fatal_layer)
	for layer: int in UICore.UILayer.values():
		if layer == UICore.UILayer.DEBUG:
			assert_gt(UICore.get_layer(layer).layer, fatal_layer.layer)
		elif layer != UICore.UILayer.FATAL:
			assert_gt(fatal_layer.layer, UICore.get_layer(layer).layer, str(layer))
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 1)
	assert_eq(UnitTestCore.check_logs("error", "DataCore"), 1, "the built-in data version is not readable")


## The automation channel reads the visible UI elements without the `Debug` layer: the fatal screen text is one.
func test_fatal_screen_text_is_a_visible_ui_element() -> void:
	_SUPPORT.prepare()
	DataCoreDev.set_test_data_location(_MISSING_DATA)
	await _boot_until_halted(_ENTRY.new(), _SUPPORT.modules())
	# The test boot list has no `QACore`: the test inits it over the halted boot.
	assert_true(QACore.init())
	var listed: RunCommandResult = await QACore.run_command("list_ui", PackedStringArray())
	QACore.release()
	assert_true(listed.ok)
	assert_true(BootstrapCore._FATAL_SCREEN_TEXT in _ui_texts(listed.result))
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 1)
	assert_eq(UnitTestCore.check_logs("error", "DataCore"), 1, "the built-in data version is not readable")


## The `text` of each element of a `list_ui` result.
# ogw:input_boundary
func _ui_texts(list_json: String) -> PackedStringArray:
	var texts := PackedStringArray()
	var parsed: Variant = JSON.parse_string(list_json)
	if not parsed is Array:
		return texts
	var elements: Array = parsed
	for element: Variant in elements:
		if element is Dictionary:
			var fields: Dictionary = element
			var text: Variant = fields.get("text", "")
			if text is String:
				texts.append(str(text))
	return texts


## A fatal screen before `UICore` is initialized is its own canvas layer over the world.
func test_fatal_screen_before_ui_core_is_a_canvas_layer() -> void:
	_SUPPORT.prepare({"OGW_PLATFORM": "IOS"})
	await _boot_until_halted(_ENTRY.new(), _SUPPORT.modules())
	var screen := BootstrapCore._fatal_screen as CanvasLayer
	assert_not_null(screen)
	if screen != null:
		assert_eq(screen.get_parent(), BootstrapCore._node)
		assert_eq(screen.layer, BootstrapCore._FATAL_SCREEN_LAYER)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 2)


func test_unpassed_adapter_error_is_in_log_file() -> void:
	_SUPPORT.prepare({"OGW_DEV_ACCOUNT": "tester"})
	UnitTestCore.set_test_settings("environments.DEV.adapters", {"ads": "fake"})
	_NETWORK.add_dev_login_success()
	_NETWORK.add_error_reports(3)
	var dev := BootstrapCore._dev
	BootstrapCore._dev = _DEV_WITHOUT_FAKE_ADS.new()
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	_SUPPORT.start(_ENTRY.new(), _SUPPORT.modules(PackedStringArray(["AuthCore", "AdCore"])))
	await UnitTestCore.wait_latch(latch)
	BootstrapCore._dev = dev
	assert_eq(_SUPPORT.count("AdCore.set_ads_adapter"), 0)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 1)
	assert_true(_log_files_contain("adapter ads=fake could not be passed"))


func test_stg_prod_build_without_build_info_logs_error_to_log_file_and_shows_fatal_screen() -> void:
	_SUPPORT.prepare()
	var dev := BootstrapCore._dev
	BootstrapCore._dev = null
	await _boot_until_halted(_ENTRY.new(), _SUPPORT.modules())
	BootstrapCore._dev = dev
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.HALTED)
	assert_true(is_instance_valid(BootstrapCore._fatal_screen))
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 3)
	assert_eq(CoreBuildInfo.storage_root, CoreBuildInfo.DEFAULT_STORAGE_ROOT)
	assert_true(_root_log_files_contain("build info file"))


## The build info file text of a DEV build: every `BuildInfo` field and `dev_access`. `strings` replaces string
## field values, the field `left_out` is not in it, and `extra` is one more JSON member when it is not empty.
static func _build_info_text(strings: Dictionary[String, String], left_out: String = "", extra: String = "") -> String:
	var values: Dictionary[String, String] = {
		"app_id": "boot.test", "app_version": "1.0.0", "environment": "DEV", "platform": CoreBuildInfo.os_platform(),
		"server_url": "http://127.0.0.1", "game_update_url": "", "instance_id": "", "dev_access": "",
	}
	values.merge(strings, true)
	var members := PackedStringArray()
	for key: String in values:
		if key != left_out:
			members.append("%s: %s" % [JSON.stringify(key), JSON.stringify(values[key])])
	var lists: Dictionary[String, String] = {"update_trust_keys": "[]", "adapters": "{}", "ad_units": "{}"}
	for key: String in lists:
		if key != left_out:
			members.append("%s: %s" % [JSON.stringify(key), lists[key]])
	if not extra.is_empty():
		members.append(extra)
	return "{%s}" % ", ".join(members)


## Starts a test boot of a build whose build info file is `text`.
func _start_with_build_info_file(text: String) -> void:
	var file := FileAccess.open(_BUILD_INFO_FILE, FileAccess.WRITE)
	file.store_string(text)
	file.close()
	BootstrapCore._test_build_info_path = _BUILD_INFO_FILE
	_SUPPORT.start(_ENTRY.new(), _SUPPORT.modules())


## A build info file of a wrong format halts `InitModules` 1 with the fatal screen. Its `instance_id` (`i9`) does
## not decide the app storage root: the error log is in the log file right under app storage.
func _check_wrong_build_info_format(text: String, label: String) -> void:
	_SUPPORT.prepare()
	_start_with_build_info_file(text)
	assert_true(await _SUPPORT.wait_stage(BootstrapCore.BootStage.HALTED), label)
	assert_true(is_instance_valid(BootstrapCore._fatal_screen), label)
	assert_false("stage:LoadData" in BootstrapCore._trace, label)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 2, label)
	assert_eq(CoreBuildInfo.storage_root, CoreBuildInfo.DEFAULT_STORAGE_ROOT, label)
	assert_true(_root_log_files_contain("wrong format"), label)
	assert_false(DirAccess.dir_exists_absolute(CoreBuildInfo.DEFAULT_STORAGE_ROOT + "instances/i9"), label)


func test_build_info_file_without_ad_units_shows_fatal_screen() -> void:
	await _check_wrong_build_info_format(_build_info_text({"instance_id": "i9"}, "ad_units"), "without ad_units")


func test_build_info_file_with_an_environment_outside_the_table_shows_fatal_screen() -> void:
	await _check_wrong_build_info_format(_build_info_text({"instance_id": "i9", "environment": "QA"}), "QA")


func test_build_info_file_with_an_unknown_key_reaches_done() -> void:
	_SUPPORT.prepare()
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	_start_with_build_info_file(_build_info_text({}, "", "\"unknown_key\": {\"any\": [1, 2]}"))
	await UnitTestCore.wait_latch(latch)
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.DONE)
	assert_eq(BootstrapCore.get_build_info().environment, "DEV")
	assert_false(BootstrapCore._fatal_screen_shown)


func test_first_scene_failure_from_title_scene_transition_opens_one_fatal_popup() -> void:
	_SUPPORT.prepare({"OGW_DEV_ACCOUNT": "tester"})
	UnitTestCore.add_pending(_NETWORK.DEV_LOGIN)
	_SUPPORT.start(_ENTRY.new(), _SUPPORT.modules(PackedStringArray(["AuthCore"])))
	assert_true(await _SUPPORT.wait_stage(BootstrapCore.BootStage.LOGIN), "boot stage LOGIN")
	# The title scene's content code starts a transition that still runs when `FirstScene` starts.
	var gate := _GATE.new()
	_HELD_SCENE.gate = gate
	SceneCore.change_scene(_SUPPORT.HELD_KEY, null)
	await UnitTestCore.wait_frames(1)
	_NETWORK.add_error_reports(3)
	assert_true(_NETWORK.release_pending_dev_login_success())
	assert_true(await _SUPPORT.wait_stage(BootstrapCore.BootStage.HALTED), "boot stage HALTED")
	await UnitTestCore.wait_frames(10)
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.HALTED)
	assert_true("SceneCore.change_scene" in _SUPPORT.trace_between("stage:FirstScene", ""))
	var fatal := _SUPPORT.popup(ReservedString.bootstrap_fatal_error(), PackedStringArray([ReservedString.bootstrap_restart()]))
	assert_eq(_SUPPORT.popups(), PackedStringArray([fatal]))
	assert_eq(UICore.get_open_popup_count(), 1)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 1)
	assert_eq(UnitTestCore.check_logs("warn", "SceneCore"), 1, "change_scene in the transition of the held scene")
	gate.open()
	_HELD_SCENE.gate = null
	await UnitTestCore.wait_frames(3)


static func _init_publishing_fatal() -> bool:
	var event := EventCore.acquire(FatalErrorRequestedEvent) as FatalErrorRequestedEvent
	event.module = "BootTestFatalCore"
	event.reason = "init failure"
	EventCore.publish(event)
	return true


static func _init_reporting_fatal() -> bool:
	BootstrapCore.report_fatal("init failure")
	return false


func test_fatal_reported_in_a_failing_module_init_is_one_fatal() -> void:
	_SUPPORT.prepare()
	var list := _SUPPORT.modules()
	var fatal_module := CoreModuleEntry.new()
	fatal_module.name = "BootTestFatalCore"
	fatal_module.init = _init_reporting_fatal
	fatal_module.release = _no_release
	fatal_module.is_initialized = _not_initialized
	list.insert(2, fatal_module)
	await _boot_until_halted(_ENTRY.new(), list)
	assert_eq(_SUPPORT.trace_between("BootTestFatalCore.init", ""), PackedStringArray())
	assert_true(BootstrapCore._fatal_screen_shown)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 1, "the reported fatal only, no init failure fatal")
	_assert_no_halted_stage_log()


func test_fatal_event_from_module_init_skips_later_inits_and_init_modules_4_to_8() -> void:
	_SUPPORT.prepare()
	var list := _SUPPORT.modules()
	var fatal_module := CoreModuleEntry.new()
	fatal_module.name = "BootTestFatalCore"
	fatal_module.init = _init_publishing_fatal
	fatal_module.release = _no_release
	fatal_module.is_initialized = _not_initialized
	list.insert(2, fatal_module)
	await _boot_until_halted(_ENTRY.new(), list)
	assert_eq(_SUPPORT.trace_between("BootTestFatalCore.init", ""), PackedStringArray())
	for i: int in range(3, list.size()):
		assert_false("%s.init" % list[i].name in BootstrapCore._trace, list[i].name)
	assert_true(BootstrapCore._fatal_screen_shown)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 1)


## Boots `list` with the DEV entry whose DEV call `call_name` reports a fatal, until the boot is halted.
func _boot_with_dev_fatal(call_name: String, list: Array[CoreModuleEntry]) -> void:
	var dev := BootstrapCore._dev
	var fatal_dev := _DEV_FATAL.new()
	fatal_dev.fatal_call = call_name
	BootstrapCore._dev = fatal_dev
	await _boot_until_halted(_ENTRY.new(), list)
	BootstrapCore._dev = dev


func test_fatal_in_a_dev_call_of_init_modules_skips_the_operations_after_it() -> void:
	_SUPPORT.prepare()
	var list := _SUPPORT.modules()
	await _boot_with_dev_fatal("after_init_modules", list)
	assert_eq(_SUPPORT.trace_between("%s.init" % list[list.size() - 1].name, ""), PackedStringArray())
	assert_true(BootstrapCore._fatal_screen_shown)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 1)
	_assert_no_halted_stage_log()
	BootstrapCoreDev.shutdown()

	_SUPPORT.prepare()
	await _boot_with_dev_fatal("after_server_info", _SUPPORT.modules())
	assert_eq(_SUPPORT.trace_between("NetworkCore.set_dev_access", ""), PackedStringArray())
	assert_true(BootstrapCore._fatal_screen_shown)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 1)
	_assert_no_halted_stage_log()


func test_fatal_in_the_dev_call_after_derived_containers_has_no_next_stage() -> void:
	_SUPPORT.prepare()
	await _boot_with_dev_fatal("after_derived_containers", _SUPPORT.modules())
	var fatal := _SUPPORT.popup(ReservedString.bootstrap_fatal_error(), PackedStringArray([ReservedString.bootstrap_restart()]))
	assert_eq(_SUPPORT.trace_between("DataCore.build_derived_containers", ""), PackedStringArray(["InputBlockCore.unblock", fatal]))
	assert_false("stage:Login" in BootstrapCore._trace)
	assert_eq(_SUPPORT.popups().size(), 1)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 1)
	_assert_no_halted_stage_log()


func test_fatal_reported_in_the_build_derived_hook_is_one_fatal() -> void:
	_SUPPORT.prepare()
	var entry := _ENTRY.new()
	entry.fatal_in_build_derived = true
	await _boot_until_halted(entry, _SUPPORT.modules())
	assert_eq(entry.register_results.size(), 1)
	assert_true(entry.register_results[0], "register_build_derived")
	var fatal := _SUPPORT.popup(ReservedString.bootstrap_fatal_error(), PackedStringArray([ReservedString.bootstrap_restart()]))
	assert_eq(_SUPPORT.trace_between("DataCore.build_derived_containers", ""), PackedStringArray(["InputBlockCore.unblock", fatal]))
	assert_false("stage:Login" in BootstrapCore._trace)
	assert_eq(_SUPPORT.popups().size(), 1)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 1, "the reported fatal only, no DataCore fatal")
	_assert_no_halted_stage_log()


func test_fatal_reported_in_resolve_language_is_one_fatal() -> void:
	_SUPPORT.prepare()
	# `fr` has no language row: with the device language `fr-FR`, `resolve_language` finds no language.
	assert_true(UnitTestCore.set_test_settings("sourceLanguage", "fr"))
	LocalizationCoreDev.set_test_device_language("fr-FR")
	var list := _with_fatal_on_log(_SUPPORT.modules(), BootstrapCore.BootStage.LOAD_DATA, "LocalizationCore", "found no language")
	await _boot_until_halted(_ENTRY.new(), list)
	assert_true("LocalizationCore.resolve_language" in BootstrapCore._trace)
	assert_eq(_SUPPORT.trace_between("LocalizationCore.resolve_language", ""), PackedStringArray())
	assert_true(BootstrapCore._fatal_screen_shown)
	assert_eq(UnitTestCore.check_logs("error", "LocalizationCore"), 1, "resolve_language found no language")
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 1, "the reported fatal only, no LocalizationCore fatal")
	_assert_no_halted_stage_log()


func test_fatal_reported_in_select_first_scene_is_one_fatal_without_scene_change() -> void:
	_SUPPORT.prepare()
	var entry := _ENTRY.new()
	entry.fatal_in_select = true
	await _boot_until_halted(entry, _SUPPORT.modules())
	assert_eq(entry.select_count, 1)
	var fatal := _SUPPORT.popup(ReservedString.bootstrap_fatal_error(), PackedStringArray([ReservedString.bootstrap_restart()]))
	assert_eq(_SUPPORT.trace_between("content.select_first_scene", ""), PackedStringArray([fatal]))
	assert_eq(_SUPPORT.popups().size(), 1)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 1, "the reported fatal only, no select_first_scene error")
	_assert_no_halted_stage_log()


## Asserts that the log file has no `BootstrapCore` stage end info log of a halted stage (`stage Halted <n> ms`).
## `LogCore` passes no info log to the log listener, so this reads the log file, which `LogCoreDev.list_log_files`
## flushes first. A marker info log written first shows that the info logs of this test reach the log file.
func _assert_no_halted_stage_log() -> void:
	var marker := "boot test marker %d" % Time.get_ticks_usec()
	LogCore.log_info("BootTest", marker)
	assert_true(_log_files_contain(marker), "info logs reach the log file")
	assert_false(_log_files_contain("stage Halted"), "no stage end info log after the halt")


## `list` whose `LogCore` entry sets `_fatal_on_log` as the log listener after `init`: the first log of `tag` holding
## `text` in boot stage `stage` reports a fatal.
func _with_fatal_on_log(
		list: Array[CoreModuleEntry],
		stage: BootstrapCore.BootStage,
		tag: String,
		text: String
) -> Array[CoreModuleEntry]:
	_fatal_stage = stage
	_fatal_tag = tag
	_fatal_text = text
	for item: CoreModuleEntry in list:
		if item.name == "LogCore":
			item.init = _init_log_core_with_fatal_listener
	return list


func _init_log_core_with_fatal_listener() -> bool:
	var inited := LogCore.init()
	var replacements := BootstrapCore._replacements as BootTestReplacements
	_replaced_listener = replacements.log_listener
	LogCoreDev.set_log_listener(_fatal_on_log)
	return inited


func _fatal_on_log(level: LogCore.Level, tag: String, message: String) -> void:
	_replaced_listener.call(level, tag, message)
	if _fatal_text.is_empty() or tag != _fatal_tag or not message.contains(_fatal_text):
		return
	if BootstrapCore.boot_stage() != _fatal_stage:
		return
	_fatal_text = ""
	BootstrapCore.report_fatal("fatal on a %s log" % tag)


static func _write_bytes(path: String, bytes: PackedByteArray) -> void:
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var file := FileAccess.open(path, FileAccess.WRITE)
	file.store_buffer(bytes)
	file.close()


func test_fatal_in_load_device_file_skips_the_init_modules_operations_after_it() -> void:
	_SUPPORT.prepare()
	var device_file := CoreBuildInfo.DEFAULT_STORAGE_ROOT + "local_data/device.dat"
	assert_false(FileAccess.file_exists(device_file))
	_write_bytes(device_file, PackedByteArray(_BROKEN_LOCAL_DATA))
	var list := _with_fatal_on_log(_SUPPORT.modules(), BootstrapCore.BootStage.INIT_MODULES, "LocalDataCore", "schema version")
	await _boot_until_halted(_ENTRY.new(), list)
	assert_eq(_SUPPORT.trace_between("LocalDataCore.load_device_file", ""), PackedStringArray())
	assert_true(BootstrapCore._fatal_screen_shown)
	assert_eq(UnitTestCore.check_logs("error", "LocalDataCore"), 1, "the device file has no schema version")
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 1)
	_assert_no_halted_stage_log()


## Boots to `Done`, stores device value `key` as a string and shuts the boot down. The next boot reads that value as
## another type in `InitModules`, and `LocalDataCore` logs a warning that names `key`.
func _store_string_device_value(key: String) -> void:
	_SUPPORT.prepare()
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	_SUPPORT.start(_ENTRY.new(), _SUPPORT.modules())
	await UnitTestCore.wait_latch(latch)
	LocalDataCore.set_value_string(LocalDataCore.FileKind.DEVICE, key, "boot test")
	BootstrapCoreDev.shutdown()


## A boot whose `InitModules` operation `operation` reads device value `key` of another type and reports a fatal on
## that warning does no operation after `operation`.
func _check_fatal_in_init_modules_operation(key: String, operation: String) -> void:
	await _store_string_device_value(key)
	_SUPPORT.prepare()
	var list := _with_fatal_on_log(_SUPPORT.modules(), BootstrapCore.BootStage.INIT_MODULES, "LocalDataCore", key)
	await _boot_until_halted(_ENTRY.new(), list)
	assert_true(operation in BootstrapCore._trace, operation)
	assert_eq(_SUPPORT.trace_between(operation, ""), PackedStringArray(), operation)
	assert_true(BootstrapCore._fatal_screen_shown)
	assert_eq(UnitTestCore.check_logs("warn", "LocalDataCore"), 1, "%s is stored as a string" % key)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 1)
	_assert_no_halted_stage_log()


func test_fatal_in_load_keys_skips_the_init_modules_operations_after_it() -> void:
	await _check_fatal_in_init_modules_operation("InputCore.key_bindings", "InputCore.load_keys")


func test_fatal_in_load_volume_settings_skips_the_init_modules_operations_after_it() -> void:
	await _check_fatal_in_init_modules_operation("SoundCore.master_volume", "SoundCore.load_volume_settings")


func test_fatal_in_load_fill_image_ends_init_modules_without_stage_end_log() -> void:
	_SUPPORT.prepare()
	assert_true(UnitTestCore.set_test_settings("ResolutionCore.fillImage", _MISSING_FILL_IMAGE))
	var list := _with_fatal_on_log(_SUPPORT.modules(), BootstrapCore.BootStage.INIT_MODULES, "ResourceCore", _MISSING_FILL_IMAGE)
	await _boot_until_halted(_ENTRY.new(), list)
	assert_true("ResolutionCore.load_fill_image" in BootstrapCore._trace)
	assert_eq(_SUPPORT.trace_between("ResolutionCore.load_fill_image", ""), PackedStringArray())
	assert_true(BootstrapCore._fatal_screen_shown)
	assert_eq(UnitTestCore.check_logs("error", "ResourceCore"), 1, "the fill image key is missing")
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 1)
	_assert_no_halted_stage_log()


func test_fatal_in_an_after_login_operation_skips_the_operations_after_it() -> void:
	_SUPPORT.prepare({"OGW_DEV_ACCOUNT": "tester"})
	UnitTestCore.set_test_settings("environments.DEV.adapters", {})
	_NETWORK.add_dev_login_success()
	_NETWORK.add_error_reports(2)
	var user_hash := UtilCore.sha256_hex(str(_NETWORK.USER_ID).to_ascii_buffer()).substr(0, 16)
	var user_file := CoreBuildInfo.DEFAULT_STORAGE_ROOT + "local_data/user_%s.dat" % user_hash
	assert_false(FileAccess.file_exists(user_file))
	_write_bytes(user_file, PackedByteArray(_BROKEN_LOCAL_DATA))
	var list := _with_fatal_on_log(
		_SUPPORT.modules(PackedStringArray(["AuthCore", "PaymentCore", "AdCore"])),
		BootstrapCore.BootStage.AFTER_LOGIN,
		"LocalDataCore",
		"schema version"
	)
	await _boot_until_halted(_ENTRY.new(), list)
	await UnitTestCore.wait_frames(3)
	var fatal := _SUPPORT.popup(ReservedString.bootstrap_fatal_error(), PackedStringArray([ReservedString.bootstrap_restart()]))
	assert_eq(
		_SUPPORT.trace_between("stage:AfterLogin", ""),
		PackedStringArray(["InputBlockCore.block", "LocalDataCore.load_user_file", "InputBlockCore.unblock", fatal])
	)
	assert_false("stage:FirstScene" in BootstrapCore._trace)
	assert_eq(_SUPPORT.popups().size(), 1)
	assert_eq(UnitTestCore.check_logs("error", "LocalDataCore"), 1, "the user file has no schema version")
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 1)
	_assert_no_halted_stage_log()


func test_fatal_reported_in_content_init_has_no_next_stage() -> void:
	_SUPPORT.prepare()
	var entry := _ENTRY.new()
	entry.fatal_in_init = true
	await _boot_until_halted(entry, _SUPPORT.modules())
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.HALTED)
	assert_false("DataCore.build_derived_containers" in BootstrapCore._trace)
	assert_false("stage:Login" in BootstrapCore._trace)
	assert_false(_SUPPORT.boot_block_active())
	assert_eq(_SUPPORT.popups().size(), 1)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 1)
	_assert_no_halted_stage_log()


func test_fatal_after_ui_ready_opens_one_popup_without_block_and_button_restarts() -> void:
	_SUPPORT.prepare()
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	_SUPPORT.start(_ENTRY.new(), _SUPPORT.modules())
	await UnitTestCore.wait_latch(latch)
	BootstrapCore.report_fatal("content failure")
	await UnitTestCore.wait_frames(3)
	assert_false(_SUPPORT.boot_block_active())
	assert_eq(UICore.get_open_popup_count(), 1)
	var fatal := _SUPPORT.popup(ReservedString.bootstrap_fatal_error(), PackedStringArray([ReservedString.bootstrap_restart()]))
	assert_eq(_SUPPORT.popups(), PackedStringArray([fatal]))
	BootstrapCore.report_fatal("content failure again")
	await UnitTestCore.wait_frames(3)
	assert_eq(UICore.get_open_popup_count(), 1)
	assert_eq(_SUPPORT.popups().size(), 1)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 2)
	var restarted := UnitTestCore.latch_event(BootCompletedEvent)
	await _SUPPORT.press_popup_button(0)
	await UnitTestCore.wait_latch(restarted)
	assert_eq(_SUPPORT.count("stage:InitModules"), 2)


## Whether a `LogCore` log file right under app storage holds `text`.
static func _root_log_files_contain(text: String) -> bool:
	for path: String in LogCoreDev.list_log_files():
		var full := CoreBuildInfo.DEFAULT_STORAGE_ROOT + path
		if FileAccess.file_exists(full) and FileAccess.get_file_as_string(full).contains(text):
			return true
	return false


static func _log_files_contain(text: String) -> bool:
	for path: String in LogCoreDev.list_log_files():
		if FileAccess.get_file_as_string(CoreBuildInfo.storage_root + path).contains(text):
			return true
	return false
