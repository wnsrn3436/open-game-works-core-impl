extends UnitTestCase
## BootstrapCore update set: update reboot and the boots after it. The downloaded files come from the core test
## state `BootstrapCore._test_downloads` or the update downloads of the test replacements.

const _SUPPORT := preload("res://core/bootstrap_core/tests/support/boot_test_support.gd")
const _ENTRY := preload("res://core/bootstrap_core/tests/support/boot_test_entry.gd")
const _UPDATE_SET := preload("res://core/bootstrap_core/update_set.gd")
## A translation key only the downloaded translation holds.
const _MARKER_KEY: String = "boot_test_marker"
const _MARKER_TEXT: String = "downloaded translation text"


func _boot() -> void:
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	_SUPPORT.start(_ENTRY.new(), _SUPPORT.modules())
	await UnitTestCore.wait_latch(latch)


func test_no_downloaded_file_means_no_update_reboot() -> void:
	_SUPPORT.prepare()
	await _boot()
	assert_eq(_SUPPORT.count("stage:InitModules"), 1)
	assert_eq(_SUPPORT.count("ResourceCore.apply_bundles"), 0)
	assert_false(BootstrapCoreDev.is_update_reboot())


func test_downloaded_bundle_makes_one_update_reboot_that_applies_the_update_set() -> void:
	_SUPPORT.prepare()
	BootstrapCore._test_downloads = _SUPPORT.bundle_downloads()
	await _boot()
	assert_eq(_SUPPORT.count("stage:InitModules"), 2)
	assert_eq(_SUPPORT.count("GameUpdateCore.check_update"), 1)
	var second_boot := _SUPPORT.trace_between("GameUpdateCore.downloaded_bundles", "")
	assert_true("ResourceCore.apply_bundles" in second_boot)
	assert_true("DataCore.load" in second_boot)
	assert_true("LocalizationCore.load_translation" in second_boot)
	assert_false("GameUpdateCore.check_update" in second_boot)
	assert_false("stage:ApplyUpdate" in second_boot)
	assert_eq(BootstrapCore._update_set.bundles.size(), 1)


func test_update_downloads_of_the_test_replacements_make_one_update_reboot() -> void:
	_SUPPORT.prepare()
	assert_false(BootstrapCoreDev.is_update_reboot(), "no boot")
	var downloads := BootTestReplacements.UpdateDownloads.new()
	downloads.bundles = _SUPPORT.bundle_downloads().bundles
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	_SUPPORT.start(_ENTRY.new(), _SUPPORT.modules(), null, downloads)
	assert_false(BootstrapCoreDev.is_update_reboot(), "the first boot is not an update reboot")
	await UnitTestCore.wait_latch(latch)
	assert_true(BootstrapCoreDev.is_update_reboot(), "the boot that ended is the update reboot")
	assert_eq(_SUPPORT.count("stage:InitModules"), 2)
	assert_eq(_SUPPORT.count("GameUpdateCore.check_update"), 1)
	var second_boot := _SUPPORT.trace_between("GameUpdateCore.downloaded_bundles", "")
	assert_true("ResourceCore.apply_bundles" in second_boot, "the update reboot applies the downloaded bundle")
	assert_false("GameUpdateCore.check_update" in second_boot)
	BootstrapCore._trace.clear()
	latch = UnitTestCore.latch_event(BootCompletedEvent)
	BootstrapCore.request_restart()
	await UnitTestCore.wait_latch(latch)
	assert_false(BootstrapCoreDev.is_update_reboot(), "the restart gets the same downloads: no update reboot")
	assert_eq(_SUPPORT.count("stage:InitModules"), 1)
	assert_eq(_SUPPORT.count("ResourceCore.apply_bundles"), 1)
	BootstrapCoreDev.shutdown()
	assert_false(BootstrapCoreDev.is_update_reboot(), "after shutdown")


func test_restart_after_update_reboot_applies_the_same_set_and_checks_update() -> void:
	_SUPPORT.prepare()
	BootstrapCore._test_downloads = _SUPPORT.bundle_downloads()
	await _boot()
	BootstrapCore._trace.clear()
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	BootstrapCore.request_restart()
	await UnitTestCore.wait_latch(latch)
	assert_eq(_SUPPORT.count("stage:InitModules"), 1)
	assert_eq(_SUPPORT.count("ResourceCore.apply_bundles"), 1)
	assert_eq(_SUPPORT.count("GameUpdateCore.check_update"), 1)
	assert_eq(_SUPPORT.count("stage:ApplyUpdate"), 1)


func test_shutdown_after_update_reboot_empties_the_update_set_and_reads_build_info_again() -> void:
	_SUPPORT.prepare({"OGW_INSTANCE_ID": "i1"})
	BootstrapCore._test_downloads = _SUPPORT.bundle_downloads("i1")
	await _boot()
	assert_eq(BootstrapCore.get_build_info().instance_id, "i1")
	BootstrapCoreDev.shutdown()
	assert_true(BootstrapCore._update_set.is_empty())
	assert_null(BootstrapCore._build_info)
	_SUPPORT.prepare({"OGW_INSTANCE_ID": "i2"})
	await _boot()
	assert_eq(_SUPPORT.count("ResourceCore.apply_bundles"), 0)
	assert_eq(_SUPPORT.count("stage:InitModules"), 1)
	assert_eq(BootstrapCore.get_build_info().instance_id, "i2")


## Restarts with `downloads` as the files `GameUpdateCore` downloaded, after clearing the trace.
func _restart_with(downloads: _UPDATE_SET) -> void:
	BootstrapCore._test_downloads = downloads
	BootstrapCore._trace.clear()
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	BootstrapCore.request_restart()
	await UnitTestCore.wait_latch(latch)
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.DONE)


## The restart boot and one update reboot that applies the update set without `check_update`.
func _assert_one_update_reboot() -> void:
	assert_eq(_SUPPORT.count("stage:InitModules"), 2)
	assert_eq(_SUPPORT.count("GameUpdateCore.check_update"), 1)
	var second_boot := _SUPPORT.trace_between("GameUpdateCore.downloaded_bundles", "")
	assert_false("GameUpdateCore.check_update" in second_boot)
	assert_false("stage:ApplyUpdate" in second_boot)


func test_downloaded_data_only_makes_one_update_reboot_that_loads_it() -> void:
	_SUPPORT.prepare()
	await _boot()
	var downloads := _SUPPORT.data_downloads("boot_test_data", _SUPPORT.data_version("boot-data-only"), true)
	assert_ne(downloads.data.data_version, DataCore.get_data_version())
	await _restart_with(downloads)
	_assert_one_update_reboot()
	assert_eq(_SUPPORT.count("ResourceCore.apply_bundles"), 0)
	assert_eq(DataCore.get_data_version(), downloads.data.data_version)
	assert_eq(BootstrapCore._update_set.data, downloads.data)


func test_downloaded_translation_only_makes_one_update_reboot_that_loads_it() -> void:
	_SUPPORT.prepare()
	await _boot()
	var downloads := _SUPPORT.translation_downloads("boot_test_translation/translation.bin", _MARKER_KEY, _MARKER_TEXT)
	await _restart_with(downloads)
	_assert_one_update_reboot()
	assert_eq(_SUPPORT.count("ResourceCore.apply_bundles"), 0)
	assert_eq(LocalizationCore.get_text(_MARKER_KEY), _MARKER_TEXT)
	assert_eq(BootstrapCore._update_set.translations.size(), 1)


func test_same_data_version_with_another_file_sha256_makes_an_update_reboot() -> void:
	_SUPPORT.prepare()
	await _boot()
	var version := _SUPPORT.data_version("boot-same-version")
	var first := _SUPPORT.data_downloads("boot_test_data_a", version, true)
	await _restart_with(first)
	_assert_one_update_reboot()
	assert_eq(DataCore.get_data_version(), version)

	# The same data version; `experiment.bin` has other bytes. The restart boot still loads the first files.
	var second := _SUPPORT.data_downloads("boot_test_data_b", version, false)
	await _restart_with(second)
	_assert_one_update_reboot()
	assert_eq(BootstrapCore._update_set.data, second.data)

	# The same files again: no update reboot.
	var same := _SUPPORT.data_downloads("boot_test_data_b", version, false)
	await _restart_with(same)
	assert_eq(_SUPPORT.count("stage:InitModules"), 1)
	assert_eq(BootstrapCore._update_set.data, second.data)
