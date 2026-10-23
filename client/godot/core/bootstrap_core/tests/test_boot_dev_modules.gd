extends UnitTestCase
## BootstrapCore DEV modules and DEV registration list: `QACore` at the end of the module list of a boot without
## test replacements, and `register_all()` of the DEV registration list after `build_derived_containers` in a boot
## whose `QACore` is initialized.

const _SUPPORT := preload("res://core/bootstrap_core/tests/support/boot_test_support.gd")
const _ENTRY := preload("res://core/bootstrap_core/tests/support/boot_test_entry.gd")
const _MISSING_DATA: String = "res://core/bootstrap_core/tests/resources/missing_data/"
const _REGISTER_ALL: String = "DevRegistrationList.register_all"


## The test module list, its `ResourceCore` setting the test key list before each `init`: a boot without test
## replacements after a restart or an update reboot finds the test resources too.
static func _modules_keeping_test_resources() -> Array[CoreModuleEntry]:
	var list := _SUPPORT.modules()
	for entry: CoreModuleEntry in list:
		if entry.name == "ResourceCore":
			entry.init = func() -> bool:
				ResourceCoreDev.set_test_key_list(_SUPPORT.resource_keys())
				return ResourceCore.init()
	return list


## Module `init` and `release` trace entries of each boot: the entries from one `stage:InitModules` to the next.
static func _lifecycle_by_boot() -> Array[PackedStringArray]:
	var boots: Array[PackedStringArray] = []
	for operation: String in BootstrapCore._trace:
		if operation == "stage:InitModules":
			boots.append(PackedStringArray())
		elif not boots.is_empty() and (operation.ends_with(".init") or operation.ends_with(".release")):
			boots[boots.size() - 1].append(operation)
	return boots


static func _with_suffix(operations: PackedStringArray, suffix: String) -> PackedStringArray:
	var result := PackedStringArray()
	for operation: String in operations:
		if operation.ends_with(suffix):
			result.append(operation)
	return result


func test_dev_run_boot_inits_qa_core_last_and_releases_it_first_in_every_boot() -> void:
	_SUPPORT.prepare({"OGW_SERVER_URL": "http://127.0.0.1"})
	BootstrapCore._test_downloads = _SUPPORT.bundle_downloads()
	var list := _modules_keeping_test_resources()
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	BootstrapCore.start_boot(_ENTRY.new(), list)
	await UnitTestCore.wait_latch(latch)
	assert_eq(_SUPPORT.count("stage:InitModules"), 2, "the first boot made an update reboot")
	assert_true(QACore.is_initialized())
	var restarted := UnitTestCore.latch_event(BootCompletedEvent)
	BootstrapCore.request_restart()
	await UnitTestCore.wait_latch(restarted)
	assert_true(QACore.is_initialized())
	var expected_inits := PackedStringArray()
	for entry: CoreModuleEntry in list:
		expected_inits.append("%s.init" % entry.name)
	expected_inits.append("QACore.init")
	var expected_releases := PackedStringArray()
	for i: int in range(expected_inits.size() - 1, -1, -1):
		expected_releases.append(expected_inits[i].replace(".init", ".release"))
	var boots := _lifecycle_by_boot()
	assert_eq(boots.size(), 3, "first boot, update reboot, restart")
	for i: int in boots.size():
		assert_eq(_with_suffix(boots[i], ".init"), expected_inits, "boot %d" % i)
		var releases := _with_suffix(boots[i], ".release")
		if i < boots.size() - 1:
			assert_eq(releases, expected_releases, "reverse release after boot %d" % i)
		else:
			assert_eq(releases.size(), 0, "boot %d" % i)
	BootstrapCoreDev.shutdown()
	assert_false(QACore.is_initialized())
	assert_false(UICore.is_initialized())


func test_dev_run_boot_whose_module_list_holds_qa_core_inits_it_once() -> void:
	_SUPPORT.prepare({"OGW_SERVER_URL": "http://127.0.0.1"})
	var list := _modules_keeping_test_resources()
	list.append(_qa_core_entry())
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	BootstrapCore.start_boot(_ENTRY.new(), list)
	await UnitTestCore.wait_latch(latch)
	assert_true(QACore.is_initialized())
	assert_eq(_SUPPORT.count("QACore.init"), 1)
	assert_eq(BootstrapCore._modules.size(), list.size())
	BootstrapCoreDev.shutdown()


func test_boot_with_test_replacements_has_no_qa_core() -> void:
	_SUPPORT.prepare()
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	_SUPPORT.start(_ENTRY.new(), _SUPPORT.modules())
	await UnitTestCore.wait_latch(latch)
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.DONE)
	assert_false(QACore.is_initialized())
	assert_eq(_SUPPORT.count("QACore.init"), 0)


func test_qa_core_initialized_without_start_boot_is_released_by_shutdown() -> void:
	_SUPPORT.prepare()
	for entry: CoreModuleEntry in _SUPPORT.modules():
		assert_true(BootstrapCore._to_bool(entry.init.call()), entry.name)
	assert_true(QACore.init())
	BootstrapCoreDev.shutdown()
	assert_false(QACore.is_initialized())
	assert_false(UICore.is_initialized())
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.NONE)


## The test module list with `QACore` at the end, as a test that needs `QACore` puts it.
static func _modules_with_qa_core() -> Array[CoreModuleEntry]:
	var list := _SUPPORT.modules()
	list.append(_qa_core_entry())
	return list


static func _qa_core_entry() -> CoreModuleEntry:
	var entry := CoreModuleEntry.new()
	entry.name = "QACore"
	entry.init = QACore.init
	entry.release = QACore.release
	entry.is_initialized = QACore.is_initialized
	return entry


func test_fatal_or_restart_in_content_init_skips_derived_containers_and_dev_registration_list() -> void:
	_SUPPORT.prepare()
	var fatal_entry := _ENTRY.new()
	fatal_entry.fatal_in_init = true
	_SUPPORT.start(fatal_entry, _modules_with_qa_core())
	assert_true(await _SUPPORT.wait_stage(BootstrapCore.BootStage.HALTED), "boot stage HALTED")
	assert_true(QACore.is_initialized())
	assert_eq(_SUPPORT.count("content.content_init"), 1)
	assert_eq(_SUPPORT.count("DataCore.build_derived_containers"), 0)
	assert_eq(_SUPPORT.count(_REGISTER_ALL), 0)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 1)
	BootstrapCoreDev.shutdown()

	_SUPPORT.prepare()
	var restart_entry := _ENTRY.new()
	restart_entry.restart_in_init = true
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	_SUPPORT.start(restart_entry, _modules_with_qa_core())
	await UnitTestCore.wait_latch(latch)
	assert_eq(_SUPPORT.count("stage:InitModules"), 2)
	var halted_boot := _SUPPORT.trace_between("content.content_init", "stage:InitModules")
	assert_false("DataCore.build_derived_containers" in halted_boot)
	assert_false(_REGISTER_ALL in halted_boot)
	assert_eq(_SUPPORT.count("DataCore.build_derived_containers"), 1)
	assert_eq(_SUPPORT.count(_REGISTER_ALL), 1)


func test_dev_registration_list_is_called_once_after_derived_containers_in_every_boot() -> void:
	_SUPPORT.prepare()
	BootstrapCore._test_downloads = _SUPPORT.bundle_downloads()
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	_SUPPORT.start(_ENTRY.new(), _modules_with_qa_core())
	await UnitTestCore.wait_latch(latch)
	assert_true(QACore.is_initialized())
	var restarted := UnitTestCore.latch_event(BootCompletedEvent)
	BootstrapCore.request_restart()
	await UnitTestCore.wait_latch(restarted)
	assert_eq(_SUPPORT.count("stage:InitModules"), 3, "first boot, update reboot, restart")
	assert_eq(_SUPPORT.count("stage:ContentInit"), 2, "the boot with the update reboot has no ContentInit")
	assert_eq(_SUPPORT.count(_REGISTER_ALL), 2)
	var trace := BootstrapCore._trace
	for i: int in trace.size():
		if trace[i] == _REGISTER_ALL:
			assert_eq(trace[i - 1], "DataCore.build_derived_containers")


func test_dev_registration_list_is_called_once_after_derived_containers_in_a_dev_run_boot() -> void:
	_SUPPORT.prepare({"OGW_SERVER_URL": "http://127.0.0.1"})
	BootstrapCore._test_downloads = _SUPPORT.bundle_downloads()
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	BootstrapCore.start_boot(_ENTRY.new(), _modules_keeping_test_resources())
	await UnitTestCore.wait_latch(latch)
	assert_true(QACore.is_initialized())
	assert_eq(_SUPPORT.count("stage:ContentInit"), 1, "the boot with the update reboot has one ContentInit")
	assert_eq(_SUPPORT.count(_REGISTER_ALL), 1)
	var trace := BootstrapCore._trace
	var index := trace.find(_REGISTER_ALL)
	assert_true(index > 0)
	assert_eq(trace[index - 1], "DataCore.build_derived_containers")
	BootstrapCoreDev.shutdown()


func test_dev_registration_list_is_not_called_in_a_test_boot_without_qa_core() -> void:
	_SUPPORT.prepare()
	BootstrapCore._test_downloads = _SUPPORT.bundle_downloads()
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	_SUPPORT.start(_ENTRY.new(), _SUPPORT.modules())
	await UnitTestCore.wait_latch(latch)
	var restarted := UnitTestCore.latch_event(BootCompletedEvent)
	BootstrapCore.request_restart()
	await UnitTestCore.wait_latch(restarted)
	assert_false(QACore.is_initialized())
	assert_eq(_SUPPORT.count("stage:ContentInit"), 2, "the boot with the update reboot has no ContentInit")
	assert_eq(_SUPPORT.count("DataCore.build_derived_containers"), 2)
	assert_eq(_SUPPORT.count(_REGISTER_ALL), 0)
	assert_eq(UnitTestCore.check_logs("error", "QACore"), 0)


func test_dev_registration_list_is_not_called_when_the_boot_halts_before_content_init() -> void:
	_SUPPORT.prepare()
	DataCoreDev.set_test_data_location(_MISSING_DATA)
	_SUPPORT.start(_ENTRY.new(), _SUPPORT.modules())
	assert_true(await _SUPPORT.wait_stage(BootstrapCore.BootStage.HALTED), "boot stage HALTED")
	assert_eq(_SUPPORT.count(_REGISTER_ALL), 0)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 1)
	assert_eq(UnitTestCore.check_logs("error", "DataCore"), 1, "the built-in data version is not readable")
