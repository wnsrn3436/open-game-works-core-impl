extends UnitTestCase
## BootstrapCore boot order: stages, operations, module order, boot block, content entry hooks.

const _SUPPORT := preload("res://core/bootstrap_core/tests/support/boot_test_support.gd")
const _NETWORK := preload("res://core/bootstrap_core/tests/support/boot_test_network.gd")
const _ENTRY := preload("res://core/bootstrap_core/tests/support/boot_test_entry.gd")
const _SCENE := preload("res://core/bootstrap_core/tests/resources/boot_test_scene.gd")


func after_each() -> void:
	_SCENE.start_hook = Callable()
	super()


func _boot(entry: ContentEntry, extra: PackedStringArray = PackedStringArray()) -> void:
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	_SUPPORT.start(entry, _SUPPORT.modules(extra))
	await UnitTestCore.wait_latch(latch)


func test_boot_of_test_module_list_reaches_done_on_first_scene() -> void:
	_SUPPORT.prepare()
	await _boot(_ENTRY.new())
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.DONE)
	assert_eq(SceneCore.current_scene_key(), _SUPPORT.FIRST_KEY)
	assert_false(InputBlockCore.is_blocked())


func test_boot_calls_table_operations_once_in_order_and_skips_modules_not_in_list() -> void:
	_SUPPORT.prepare()
	await _boot(_ENTRY.new())
	var expected := PackedStringArray([
		"stage:InitModules",
		"TimeCore.set_test_clock", "LogCore.set_test_clock", "NetworkCore.set_transport", "LogCore.set_log_listener",
	])
	for module_name: String in _SUPPORT.BASE:
		expected.append("%s.init" % module_name)
	expected.append_array([
		"LocalDataCore.load_device_file", "NetworkCore.set_server_info", "NetworkCore.set_dev_access",
		"ResolutionCore.apply_saved_screen_mode", "InputCore.load_keys", "SoundCore.load_volume_settings",
		"ResolutionCore.load_fill_image",
		"stage:LoadData", "DataCore.load", "LocalizationCore.resolve_language", "LocalizationCore.load_translation",
		"LocalizationCore.load_fonts", "LocalizationCore.load_prompt_icons",
		"stage:Prepare", "InputBlockCore.block", "UICore.prepare", "MessageCore.prepare", "InputBlockCore.unblock",
		"stage:TitleScene", "SceneCore.boot_change_scene",
		"stage:Update", "GameUpdateCore.check_update",
		"stage:ApplyUpdate", "InputBlockCore.block", "GameUpdateCore.downloaded_data",
		"GameUpdateCore.downloaded_translations", "GameUpdateCore.downloaded_bundles", "InputBlockCore.unblock",
		"stage:ContentInit", "InputBlockCore.block", "content.content_init", "DataCore.build_derived_containers",
		"InputBlockCore.unblock",
		"stage:Login",
		"stage:AfterLogin", "InputBlockCore.block", "InputBlockCore.unblock",
		"stage:FirstScene", "content.select_first_scene", "SceneCore.change_scene",
	])
	assert_eq(BootstrapCore._trace, expected)


func test_adapters_before_init_init_in_order_release_in_reverse_after_content_release() -> void:
	_SUPPORT.prepare({"OGW_DEV_ACCOUNT": "tester"})
	_NETWORK.add_dev_login_success()
	var entry := _ENTRY.new()
	await _boot(entry, PackedStringArray(["AuthCore"]))
	var trace := BootstrapCore._trace
	assert_true(trace.find("AuthCore.set_storage_scope") < trace.find("LogCore.init"))
	assert_true(trace.find("TimeCore.set_test_clock") < trace.find("LogCore.init"))
	var list := _SUPPORT.modules(PackedStringArray(["AuthCore"]))
	var inits := PackedStringArray()
	var expected_inits := PackedStringArray()
	for item: CoreModuleEntry in list:
		expected_inits.append("%s.init" % item.name)
	for operation: String in trace:
		if operation.ends_with(".init"):
			inits.append(operation)
	assert_eq(inits, expected_inits)

	_NETWORK.add_dev_login_success()
	BootstrapCore._trace.clear()
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	BootstrapCore.request_restart()
	await UnitTestCore.wait_latch(latch)
	var releases := PackedStringArray()
	for operation: String in BootstrapCore._trace:
		if operation.ends_with(".release"):
			releases.append(operation)
	var expected_releases := PackedStringArray()
	for i: int in range(list.size() - 1, -1, -1):
		expected_releases.append("%s.release" % list[i].name)
	assert_eq(releases, expected_releases)
	assert_true(BootstrapCore._trace.find("content.content_release") < BootstrapCore._trace.find(expected_releases[0]))


func test_boot_block_exists_only_in_prepare_apply_update_content_init_after_login() -> void:
	_SUPPORT.prepare()
	var entry := _ENTRY.new()
	var start_blocked: Dictionary[String, bool] = {}
	_SCENE.start_hook = func(key: String) -> void: start_blocked[key] = _SUPPORT.boot_block_active()
	await _boot(entry)
	for stage: String in ["Prepare", "ApplyUpdate", "ContentInit", "AfterLogin"]:
		var ops := _SUPPORT.trace_between("stage:%s" % stage, "stage:%s" % _next_stage(stage))
		assert_eq(ops[0], "InputBlockCore.block", stage)
		assert_eq(ops[ops.size() - 1], "InputBlockCore.unblock", stage)
	for stage: String in ["TitleScene", "Update", "Login"]:
		var ops := _SUPPORT.trace_between("stage:%s" % stage, "stage:%s" % _next_stage(stage))
		assert_false("InputBlockCore.block" in ops, stage)
	assert_false("InputBlockCore.block" in _SUPPORT.trace_between("stage:FirstScene", ""))
	assert_true(entry.blocked_at_init)
	var expected: Dictionary[String, bool] = {_SUPPORT.TITLE_KEY: false, _SUPPORT.FIRST_KEY: false}
	assert_eq(start_blocked, expected)


func test_content_init_after_data_and_translation_before_login() -> void:
	_SUPPORT.prepare({"OGW_DEV_ACCOUNT": "tester"})
	_NETWORK.add_no_notices()
	_NETWORK.add_dev_login_success()
	var entry := _ENTRY.new()
	entry.register_judge = true
	await _boot(entry, PackedStringArray(["AuthCore", "RequirementCore", "BadgeCore", "NoticeCore"]))
	assert_true(entry.data_loaded_at_init)
	assert_true("LocalizationCore.load_translation" in entry.trace_at_init)
	assert_false("AuthCore.dev_login" in entry.trace_at_init)
	assert_false("AuthCore.boot_login" in entry.trace_at_init)
	var trace := BootstrapCore._trace
	assert_true(trace.find("NoticeCore.wait_maintenance_clear") >= 0)
	assert_true(trace.find("NoticeCore.wait_maintenance_clear") < trace.find("AuthCore.dev_login"))
	assert_true(trace.find("content.content_init") < trace.find("DataCore.build_derived_containers"))


func test_prepare_waits_each_operation_and_logs_failure_before_next() -> void:
	_SUPPORT.prepare()
	UnitTestCore.set_test_settings("UICore.systemPopupResource", "missing/boot_test_popup")
	await _boot(_ENTRY.new())
	assert_eq(
		_SUPPORT.trace_between("stage:Prepare", "stage:TitleScene"),
		PackedStringArray(["InputBlockCore.block", "UICore.prepare", "MessageCore.prepare", "InputBlockCore.unblock"])
	)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 1)
	assert_eq(UnitTestCore.check_logs("error", "UICore"), 1, "prepare: the popup key is missing")
	assert_eq(UnitTestCore.check_logs("error", "ResourceCore"), 1, "load of the missing popup key")


func test_first_scene_starts_after_after_login_without_waiting() -> void:
	_SUPPORT.prepare({"OGW_DEV_ACCOUNT": "tester"})
	UnitTestCore.set_test_settings("environments.DEV.adapters", {})
	_NETWORK.add_dev_login_success()
	await _boot(_ENTRY.new(), PackedStringArray(["AuthCore", "PaymentCore", "AdCore"]))
	var after_login := _SUPPORT.trace_between("stage:AfterLogin", "stage:FirstScene")
	assert_true("PaymentCore.recover_purchases" in after_login)
	assert_true("AdCore.start" in after_login)
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.DONE)


## `check_update` takes one call in an `init`: the title scene calls it first, so the boot's call is the second one
## and is `false`.
func test_failed_check_update_goes_to_content_init_without_apply_update() -> void:
	_SUPPORT.prepare()
	_SCENE.start_hook = func(key: String) -> void:
		if key == _SUPPORT.TITLE_KEY:
			GameUpdateCore.check_update(UpdateSource.new())
	await _boot(_ENTRY.new())
	assert_true("GameUpdateCore.check_update" in BootstrapCore._trace)
	assert_false("stage:ApplyUpdate" in BootstrapCore._trace)
	assert_true("stage:ContentInit" in BootstrapCore._trace)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 1)
	assert_eq(UnitTestCore.check_logs("error", "GameUpdateCore"), 1)


func test_without_select_first_scene_goes_to_game_settings_first_scene() -> void:
	_SUPPORT.prepare()
	await _boot(ContentEntry.new())
	assert_eq(SceneCore.current_scene_key(), _SUPPORT.FIRST_KEY)


func test_empty_select_first_scene_logs_error_and_goes_to_first_scene() -> void:
	_SUPPORT.prepare()
	var entry := _ENTRY.new()
	entry.first_scene_empty = true
	await _boot(entry)
	assert_eq(SceneCore.current_scene_key(), _SUPPORT.FIRST_KEY)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 1)


func test_selected_first_scene_is_used() -> void:
	_SUPPORT.prepare()
	var entry := _ENTRY.new()
	entry.first_scene = _SUPPORT.OTHER_KEY
	await _boot(entry)
	assert_eq(entry.select_count, 1)
	assert_eq(SceneCore.current_scene_key(), _SUPPORT.OTHER_KEY)


func test_false_content_init_logs_error_and_goes_on() -> void:
	_SUPPORT.prepare()
	var entry := _ENTRY.new()
	entry.init_result = false
	await _boot(entry)
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.DONE)
	assert_true("DataCore.build_derived_containers" in BootstrapCore._trace)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 1)


func test_throwing_content_init_logs_error_and_goes_on() -> void:
	_SUPPORT.prepare()
	var entry := _ENTRY.new()
	entry.throw_in_init = true
	await _boot(entry)
	assert_eq(UnitTestCore.check_script_errors(), 1, "content_init threw")
	assert_eq(entry.init_count, 1)
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.DONE)
	assert_true("DataCore.build_derived_containers" in BootstrapCore._trace)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 1)


func test_throwing_select_first_scene_logs_error_and_goes_to_first_scene() -> void:
	_SUPPORT.prepare()
	var entry := _ENTRY.new()
	entry.throw_in_select = true
	await _boot(entry)
	assert_eq(UnitTestCore.check_script_errors(), 1, "select_first_scene threw")
	assert_eq(entry.select_count, 1)
	assert_eq(SceneCore.current_scene_key(), _SUPPORT.FIRST_KEY)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 1)


func test_throwing_content_release_logs_error_and_the_release_goes_on() -> void:
	_SUPPORT.prepare()
	var entry := _ENTRY.new()
	entry.throw_in_release = true
	await _boot(entry)
	BootstrapCoreDev.shutdown()
	assert_eq(UnitTestCore.check_script_errors(), 1, "content_release threw")
	assert_eq(entry.release_count, 1)
	assert_false(SceneCore.is_initialized(), "the modules are released")
	assert_false(LogCore.is_initialized(), "the modules are released")
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 1)


func test_get_first_scene_returns_game_settings_first_scene() -> void:
	UnitTestCore.set_test_settings("firstScene", _SUPPORT.OTHER_KEY)
	assert_eq(BootstrapCore.get_first_scene(), _SUPPORT.OTHER_KEY)


func test_start_boot_again_without_shutdown_is_ignored() -> void:
	_SUPPORT.prepare()
	var entry := _ENTRY.new()
	await _boot(entry)
	var inits := _SUPPORT.count("LogCore.init")
	BootstrapCore.start_boot(_ENTRY.new(), _SUPPORT.modules())
	assert_eq(_SUPPORT.count("LogCore.init"), inits)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 1)


static func _next_stage(stage: String) -> String:
	var index := BootstrapCore._STAGE_NAMES.find(stage)
	if index < 0 or index + 1 >= BootstrapCore._STAGE_NAMES.size():
		return ""
	return BootstrapCore._STAGE_NAMES[index + 1]
