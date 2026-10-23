extends UnitTestCase
## `load_translation`: downloaded and built-in translation binaries; missing keys and empty keys.

const _SUPPORT := preload("res://core/localization_core/tests/support/localization_test_support.gd")
const _PATH: String = "localization_test/translation_en.bin"


func after_each() -> void:
	super()
	_SUPPORT.stop()


func _downloaded_english(text: String) -> DownloadedTranslation:
	var bytes: PackedByteArray = _SUPPORT.translation_binary(PackedStringArray([_SUPPORT.language_name_key("[lang_en]"), text]))
	return _SUPPORT.write_downloaded(_PATH, bytes, "en")


func test_builtin_translation_of_the_current_language() -> void:
	assert_ne(await _SUPPORT.start_language("en"), 0)
	assert_eq(LocalizationCore.get_text(_SUPPORT.language_name_key("[lang_en]")), "English")
	assert_eq(LocalizationCore.get_text(_SUPPORT.language_name_key("[lang_zh_tw]")), "繁體中文")


func test_downloaded_translation_of_the_current_language_is_used() -> void:
	assert_true(await _SUPPORT.start())
	LocalizationCoreDev.set_test_device_language("en")
	assert_ne(LocalizationCore.resolve_language(), 0)
	var other: DownloadedTranslation = _SUPPORT.write_downloaded("localization_test/translation_ca.bin", _SUPPORT.translation_binary(PackedStringArray([_SUPPORT.language_name_key("[lang_en]"), "Anglès"])), "ca")
	var list: Array[DownloadedTranslation] = [other, _downloaded_english("English (downloaded)")]
	assert_true(await LocalizationCore.load_translation(list))
	assert_eq(LocalizationCore.get_text(_SUPPORT.language_name_key("[lang_en]")), "English (downloaded)")
	assert_eq(LocalizationCore.get_text(_SUPPORT.language_name_key("[lang_ca]")), "‼ " + _SUPPORT.language_name_key("[lang_ca]") if CoreBuildInfo.has_dev_code else "")
	assert_eq(_SUPPORT.errors(), 1)


func test_downloaded_translation_with_another_hash_uses_the_builtin_translation() -> void:
	assert_true(await _SUPPORT.start())
	LocalizationCoreDev.set_test_device_language("en")
	assert_ne(LocalizationCore.resolve_language(), 0)
	var downloaded: DownloadedTranslation = _downloaded_english("English (downloaded)")
	downloaded.sha256 = "0".repeat(64)
	var list: Array[DownloadedTranslation] = [downloaded]
	assert_true(await LocalizationCore.load_translation(list))
	assert_eq(_SUPPORT.errors(), 1)
	assert_eq(LocalizationCore.get_text(_SUPPORT.language_name_key("[lang_en]")), "English")


func test_downloaded_translation_of_another_data_version_uses_the_builtin_translation() -> void:
	assert_true(await _SUPPORT.start())
	LocalizationCoreDev.set_test_device_language("en")
	assert_ne(LocalizationCore.resolve_language(), 0)
	var downloaded: DownloadedTranslation = _downloaded_english("English (downloaded)")
	downloaded.data_version = "x" + downloaded.data_version
	var list: Array[DownloadedTranslation] = [downloaded]
	assert_true(await LocalizationCore.load_translation(list))
	assert_eq(_SUPPORT.errors(), 1)
	assert_eq(LocalizationCore.get_text(_SUPPORT.language_name_key("[lang_en]")), "English")


func test_downloaded_translation_larger_than_the_limit_is_not_read_and_uses_the_builtin_translation() -> void:
	assert_true(UnitTestCore.set_test_settings("LocalizationCore.downloadedFileMaxBytes", 16))
	assert_true(await _SUPPORT.start())
	LocalizationCoreDev.set_test_device_language("en")
	assert_ne(LocalizationCore.resolve_language(), 0)
	var downloaded: DownloadedTranslation = _downloaded_english("English (downloaded)")
	assert_gt(LocalDataCore.get_file_size(downloaded.path), 16)
	var list: Array[DownloadedTranslation] = [downloaded]
	assert_true(await LocalizationCore.load_translation(list))
	assert_eq(_SUPPORT.errors(), 1)
	assert_eq(LocalizationCore.get_text(_SUPPORT.language_name_key("[lang_en]")), "English")


func test_downloaded_translation_that_does_not_decode_uses_the_builtin_translation() -> void:
	assert_true(await _SUPPORT.start())
	LocalizationCoreDev.set_test_device_language("en")
	assert_ne(LocalizationCore.resolve_language(), 0)
	var bytes: PackedByteArray = _SUPPORT.translation_binary(PackedStringArray(["key", "text"]))
	bytes.append(0x0A)
	var list: Array[DownloadedTranslation] = [_SUPPORT.write_downloaded(_PATH, bytes, "en")]
	assert_true(await LocalizationCore.load_translation(list))
	assert_eq(_SUPPORT.errors(), 1)
	assert_eq(LocalizationCore.get_text(_SUPPORT.language_name_key("[lang_en]")), "English")


func test_failed_load_translation_keeps_the_previous_text() -> void:
	var location: String = _SUPPORT.copy_data_without_translations("localization_test_data")
	assert_ne(location, "")
	assert_true(await _SUPPORT.start(_SUPPORT.all_resources(), location))
	LocalizationCoreDev.set_test_device_language("en")
	assert_ne(LocalizationCore.resolve_language(), 0)
	var good: Array[DownloadedTranslation] = [_downloaded_english("English (downloaded)")]
	assert_true(await LocalizationCore.load_translation(good))
	var key: String = _SUPPORT.language_name_key("[lang_en]")
	assert_eq(LocalizationCore.get_text(key), "English (downloaded)")
	var bad: DownloadedTranslation = _downloaded_english("English (bad)")
	bad.sha256 = "0".repeat(64)
	var list: Array[DownloadedTranslation] = [bad]
	assert_false(await LocalizationCore.load_translation(list))
	# The downloaded file, the missing built-in file and the load itself.
	assert_eq(_SUPPORT.errors(), 3)
	assert_eq(LocalizationCore.get_text(key), "English (downloaded)")
	var none: Array[DownloadedTranslation] = []
	assert_false(await LocalizationCore.load_translation(none))
	assert_eq(_SUPPORT.errors(), 2)
	assert_eq(LocalizationCore.get_text(key), "English (downloaded)")


func test_missing_key_is_empty_and_logged_once_a_load() -> void:
	assert_ne(await _SUPPORT.start_language("en"), 0)
	var expected: String = "‼ missing.key.1" if CoreBuildInfo.has_dev_code else ""
	assert_eq(LocalizationCore.get_text("missing.key.1"), expected)
	assert_eq(LocalizationCore.get_text("missing.key.1"), expected)
	assert_eq(LocalizationCore.format("missing.key.1", FormatArgs.new()), expected)
	assert_eq(_SUPPORT.errors(), 1)
	var none: Array[DownloadedTranslation] = []
	assert_true(await LocalizationCore.load_translation(none))
	assert_eq(LocalizationCore.get_text("missing.key.1"), expected)
	assert_eq(_SUPPORT.errors(), 1)


func test_missing_key_before_a_load_is_logged() -> void:
	assert_true(await _SUPPORT.start())
	var expected: String = "‼ missing.key.2" if CoreBuildInfo.has_dev_code else ""
	assert_eq(LocalizationCore.get_text("missing.key.2"), expected)
	assert_eq(_SUPPORT.errors(), 1)


func test_empty_key_is_empty_without_a_log() -> void:
	assert_ne(await _SUPPORT.start_language("en"), 0)
	assert_eq(LocalizationCore.get_text(""), "")
	assert_eq(LocalizationCore.format("", FormatArgs.new(), 12), "")


func test_load_translation_while_another_runs_is_an_error_and_the_running_one_continues() -> void:
	# `load_translation` reads the file without waiting, so no call can start inside another. The test sets the
	# state of a running `load_translation`.
	assert_ne(await _SUPPORT.start_language("en"), 0)
	var none: Array[DownloadedTranslation] = []
	LocalizationCore._translation_loading = true
	var list: Array[DownloadedTranslation] = [_downloaded_english("English (downloaded)")]
	assert_false(await LocalizationCore.load_translation(list))
	assert_eq(_SUPPORT.errors(), 1)
	assert_true(LocalizationCore._translation_loading)
	assert_eq(LocalizationCore.get_text(_SUPPORT.language_name_key("[lang_en]")), "English")
	LocalizationCore._translation_loading = false
	assert_true(await LocalizationCore.load_translation(none))
