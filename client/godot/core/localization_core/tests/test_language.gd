extends UnitTestCase
## The current language: `resolve_language`, `select_language`, `list_languages` and the device language tag.

const _SUPPORT := preload("res://core/localization_core/tests/support/localization_test_support.gd")


func after_each() -> void:
	super()
	_SUPPORT.stop()


func test_saved_language_wins_over_the_device_language() -> void:
	assert_true(await _SUPPORT.start())
	assert_true(LocalizationCore.select_language(_SUPPORT.language_id("[lang_ca]")))
	LocalizationCoreDev.set_test_device_language("zh-Hant-TW")
	assert_eq(LocalizationCore.resolve_language(), _SUPPORT.language_id("[lang_ca]"))
	assert_eq(LocalizationCore.get_language(), _SUPPORT.language_id("[lang_ca]"))
	assert_eq(LocalizationCore.get_language_code(), "ca")


func test_device_language_tag_candidates_in_order() -> void:
	assert_eq(LocalizationCore._tag_candidates("zh-Hans-CN"), PackedStringArray(["zh-Hans-CN", "zh-CN", "zh-Hans", "zh"]))
	assert_eq(LocalizationCore._tag_candidates("zh-Hant-TW"), PackedStringArray(["zh-Hant-TW", "zh-TW", "zh-Hant", "zh"]))
	assert_eq(LocalizationCore._tag_candidates("ca-ES-valencia"), PackedStringArray(["ca-ES-valencia", "ca-ES", "ca"]))
	assert_eq(LocalizationCore._tag_candidates("en"), PackedStringArray(["en"]))


func test_device_language_tag_picks_the_first_candidate_with_a_language() -> void:
	var cases: Dictionary[String, String] = {"zh-Hans-CN": "[lang_zh_hans]", "zh-Hant-TW": "[lang_zh_tw]", "ca-ES-valencia": "[lang_ca]", "ZH-hant-tw": "[lang_zh_tw]"}
	assert_true(await _SUPPORT.start())
	for tag: String in cases:
		assert_true(await _SUPPORT.restart())
		LocalizationCoreDev.set_test_device_language(tag)
		assert_eq(LocalizationCore.resolve_language(), _SUPPORT.language_id(cases[tag]), tag)


func test_source_language_when_no_language_matches_and_0_when_that_has_no_row() -> void:
	assert_true(await _SUPPORT.start())
	LocalizationCoreDev.set_test_device_language("fr-FR")
	assert_eq(LocalizationCore.resolve_language(), _SUPPORT.language_id("[lang_en]"))
	assert_true(UnitTestCore.set_test_settings("sourceLanguage", "fr"))
	assert_true(await _SUPPORT.restart())
	LocalizationCoreDev.set_test_device_language("fr-FR")
	assert_eq(LocalizationCore.resolve_language(), 0)
	assert_eq(_SUPPORT.errors(), 1)
	assert_eq(LocalizationCore.get_language(), 0)
	assert_eq(LocalizationCore.get_language_code(), "")
	var none: Array[DownloadedTranslation] = []
	assert_false(await LocalizationCore.load_translation(none))
	assert_false(await LocalizationCore.load_fonts())
	assert_eq(_SUPPORT.errors(), 4)


func test_select_language_only_saves_and_restart_picks_it() -> void:
	assert_ne(await _SUPPORT.start_language("zh-Hans"), 0)
	var name_key: String = _SUPPORT.language_name_key("[lang_en]")
	var before: String = LocalizationCore.get_text(name_key)
	assert_true(LocalizationCore.select_language(_SUPPORT.language_id("[lang_ca]")))
	assert_eq(LocalizationCore.get_language(), _SUPPORT.language_id("[lang_zh_hans]"))
	assert_eq(LocalizationCore.get_language_code(), "zh-Hans")
	assert_eq(LocalizationCore.get_text(name_key), before)
	assert_true(await _SUPPORT.restart())
	LocalizationCoreDev.set_test_device_language("zh-Hans")
	assert_eq(LocalizationCore.resolve_language(), _SUPPORT.language_id("[lang_ca]"))


func test_select_language_of_no_row_is_an_error_and_saves_nothing() -> void:
	assert_true(await _SUPPORT.start())
	assert_false(LocalizationCore.select_language(987654))
	assert_eq(_SUPPORT.errors(), 1)
	LocalizationCoreDev.set_test_device_language("ca")
	assert_eq(LocalizationCore.resolve_language(), _SUPPORT.language_id("[lang_ca]"))


func test_second_resolve_language_is_an_error_and_keeps_the_language() -> void:
	assert_true(await _SUPPORT.start())
	LocalizationCoreDev.set_test_device_language("ca")
	assert_eq(LocalizationCore.resolve_language(), _SUPPORT.language_id("[lang_ca]"))
	LocalizationCoreDev.set_test_device_language("zh-TW")
	assert_eq(LocalizationCore.resolve_language(), _SUPPORT.language_id("[lang_ca]"))
	assert_eq(_SUPPORT.errors(), 1)
	assert_eq(LocalizationCore.get_language_code(), "ca")


func test_list_languages_fills_the_buffer_in_order_order() -> void:
	assert_true(await _SUPPORT.start())
	var buffer: Array[int] = [0, 0, 0, 0, 0]
	assert_eq(LocalizationCore.list_languages(buffer), 4)
	var expected: Array[int] = [
		_SUPPORT.language_id("[lang_en]"), _SUPPORT.language_id("[lang_zh_hans]"), _SUPPORT.language_id("[lang_zh_tw]"),
		_SUPPORT.language_id("[lang_ca]"), 0,
	]
	assert_eq(buffer, expected)
	var small: Array[int] = [0, 0]
	assert_eq(LocalizationCore.list_languages(small), 2)
	assert_eq(_SUPPORT.errors(), 1)
	var first_two: Array[int] = [_SUPPORT.language_id("[lang_en]"), _SUPPORT.language_id("[lang_zh_hans]")]
	assert_eq(small, first_two)
