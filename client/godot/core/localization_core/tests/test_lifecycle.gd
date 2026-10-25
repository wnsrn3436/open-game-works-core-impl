extends UnitTestCase
## Lifecycle of `LocalizationCore`: init check, the state `release` puts back, the core node, init errors.

const _SUPPORT := preload("res://core/localization_core/tests/support/localization_test_support.gd")


func after_each() -> void:
	super()
	_SUPPORT.stop()


func test_init_check_before_init_after_init_and_after_release() -> void:
	assert_false(LocalizationCore.is_initialized())
	assert_true(await _SUPPORT.start())
	assert_true(LocalizationCore.is_initialized())
	LocalizationCore.release()
	assert_false(LocalizationCore.is_initialized())


func test_release_puts_every_static_var_back_and_takes_the_core_node_out_of_the_tree() -> void:
	assert_true(UnitTestCore.set_test_settings("LocalizationCore.bodyFontWeight", 400))
	assert_true(UnitTestCore.set_test_settings("LocalizationCore.headingFontWeight", 800))
	var resources: Dictionary[String, String] = _SUPPORT.all_resources()
	resources[_SUPPORT.FONT_MAIN] = _SUPPORT.WEIGHT_AXIS_FONT
	assert_true(await _SUPPORT.start(resources))
	assert_eq(LocalizationCore._body_font_weight, 400)
	assert_eq(LocalizationCore._heading_font_weight, 800)
	var node: Node = LocalizationCore._node
	assert_true(node.is_inside_tree())
	LocalizationCoreDev.set_test_device_language("ca")
	assert_ne(LocalizationCore.resolve_language(), 0)
	var none: Array[DownloadedTranslation] = []
	assert_true(await LocalizationCore.load_translation(none))
	assert_true(await LocalizationCore.load_fonts())
	assert_true(await LocalizationCore.load_prompt_icons())
	LocalizationCore.set_text_scale(1200)
	var label: Label = Label.new()
	add_child_autofree(label)
	LocalizationCore.bind_text(label, _SUPPORT.language_name_key("[lang_en]"))
	assert_eq(LocalizationCore.get_text(_SUPPORT.language_name_key("[lang_ca]")), "Català")
	LocalizationCore.release()
	assert_false(node.is_inside_tree())
	assert_null(LocalizationCore._node)
	assert_null(LocalizationCore._session)
	assert_eq(LocalizationCore._source_language, "")
	assert_eq(LocalizationCore._downloaded_max_bytes, 0)
	assert_eq(LocalizationCore._max_formatted_length, 0)
	assert_eq(LocalizationCore._body_font_weight, 0)
	assert_eq(LocalizationCore._heading_font_weight, 0)
	assert_false(LocalizationCore._resolve_called)
	assert_eq(LocalizationCore._language, 0)
	assert_eq(LocalizationCore._language_code, "")
	assert_true(LocalizationCore._texts.is_empty())
	assert_true(LocalizationCore._parsed.is_empty())
	assert_true(LocalizationCore._missing_logged.is_empty())
	assert_true(LocalizationCore._prompt_logged.is_empty())
	assert_false(LocalizationCore._translation_loading)
	assert_false(LocalizationCore._fonts_loading)
	assert_false(LocalizationCore._icons_loading)
	assert_true(LocalizationCore._icon_paths.is_empty())
	assert_null(LocalizationCore._font_theme)
	assert_null(LocalizationCore._saved_default_font)
	assert_null(LocalizationCore._chain)
	assert_null(LocalizationCore._heading_chain)
	assert_true(LocalizationCore._saved_heading_bases.is_empty())
	assert_true(LocalizationCore._saved_heading_fonts.is_empty())
	assert_eq(LocalizationCore._text_scale, 1000)
	assert_true(LocalizationCore._first_font_sizes.is_empty())
	assert_true(LocalizationCore._bindings.is_empty())
	assert_eq(LocalizationCore._binding_sweep_size, LocalizationCore._MIN_BINDING_SWEEP_SIZE)
	assert_null(LocalizationCore._prompt)
	assert_false(LocalizationCore._prompt_was_icon)
	assert_eq(LocalizationCore._test_device_language, "")
	assert_false(LocalizationCore._test_timezone_offset_set)
	assert_eq(LocalizationCore._test_timezone_offset_ms, 0)


func test_init_again_after_release_works_as_the_first_init() -> void:
	assert_true(await _SUPPORT.start())
	LocalizationCoreDev.set_test_device_language("zh-TW")
	assert_eq(LocalizationCore.resolve_language(), _SUPPORT.language_id("[lang_zh_tw]"))
	LocalizationCore.release()
	assert_true(LocalizationCore.init())
	LocalizationCoreDev.set_test_device_language("ca")
	assert_eq(LocalizationCore.resolve_language(), _SUPPORT.language_id("[lang_ca]"))
	assert_eq(LocalizationCore.get_text_scale(), 1000)


func test_init_while_initialized_is_an_error() -> void:
	assert_true(await _SUPPORT.start())
	assert_false(LocalizationCore.init())
	assert_eq(_SUPPORT.errors(), 1)
	assert_true(LocalizationCore.is_initialized())


func test_operations_before_init_log_and_return_the_failure_value() -> void:
	assert_true(await _SUPPORT.start_dependencies())
	var none: Array[DownloadedTranslation] = []
	var buffer: Array[int] = [0, 0]
	var label: Label = Label.new()
	add_child_autofree(label)
	assert_eq(LocalizationCore.resolve_language(), 0)
	assert_false(await LocalizationCore.load_translation(none))
	assert_false(await LocalizationCore.load_fonts())
	assert_false(await LocalizationCore.load_prompt_icons())
	assert_eq(LocalizationCore.get_text("a"), "")
	assert_eq(LocalizationCore.format("a", FormatArgs.new()), "")
	LocalizationCore.bind_text(label, "a")
	assert_eq(LocalizationCore.get_language(), 0)
	assert_eq(LocalizationCore.get_language_code(), "")
	assert_eq(LocalizationCore.list_languages(buffer), 0)
	assert_false(LocalizationCore.select_language(1))
	LocalizationCore.set_text_scale(1500)
	assert_eq(LocalizationCore.get_text_scale(), 1000)
	assert_eq(_SUPPORT.errors(), 13)
	assert_eq(label.text, "")


func test_freed_core_node_cleans_up_like_release() -> void:
	assert_true(await _SUPPORT.start())
	var label: Label = Label.new()
	label.add_theme_font_size_override("font_size", 20)
	add_child_autofree(label)
	LocalizationCore.set_text_scale(2000)
	assert_eq(label.get_theme_font_size("font_size"), 40)
	var node: Node = LocalizationCore._node
	node.get_parent().remove_child(node)
	node.free()
	assert_false(LocalizationCore.is_initialized())
	assert_null(LocalizationCore._node)
	assert_eq(label.get_theme_font_size("font_size"), 20)
	assert_true(LocalizationCore.init())


func test_init_fails_when_supported_languages_is_not_a_string_list() -> void:
	assert_true(await _SUPPORT.start_dependencies())
	assert_true(CoreSettings.has_string_array("supportedLanguages"))
	assert_true(CoreSettings.get_string_array("supportedLanguages").has("en"))
	assert_true(UnitTestCore.set_invalid_test_settings("supportedLanguages", ["en", 1]))
	_assert_init_fails_on_supported_languages()
	assert_true(UnitTestCore.set_invalid_test_settings("supportedLanguages", [["en"]]))
	_assert_init_fails_on_supported_languages()
	assert_true(UnitTestCore.set_invalid_test_settings("supportedLanguages", "en"))
	_assert_init_fails_on_supported_languages()
	assert_true(UnitTestCore.set_test_settings("supportedLanguages", PackedStringArray(["en", "ca"])))
	assert_eq(CoreSettings.get_string_array("supportedLanguages"), PackedStringArray(["en", "ca"]))
	assert_true(LocalizationCore.init())


func _assert_init_fails_on_supported_languages() -> void:
	assert_false(CoreSettings.has_string_array("supportedLanguages"))
	assert_true(CoreSettings.get_string_array("supportedLanguages").is_empty())
	assert_false(LocalizationCore.init())
	assert_eq(_SUPPORT.errors(), 1)
	assert_false(LocalizationCore.is_initialized())


func test_init_fails_when_a_font_weight_is_not_an_integer() -> void:
	assert_true(await _SUPPORT.start_dependencies())
	for key: String in PackedStringArray(["LocalizationCore.bodyFontWeight", "LocalizationCore.headingFontWeight"]):
		assert_true(UnitTestCore.set_invalid_test_settings(key, "400"))
		assert_false(LocalizationCore.init())
		assert_eq(_SUPPORT.errors(), 1)
		assert_false(LocalizationCore.is_initialized())
		assert_true(UnitTestCore.set_test_settings(key, 400))
	assert_true(LocalizationCore.init())
