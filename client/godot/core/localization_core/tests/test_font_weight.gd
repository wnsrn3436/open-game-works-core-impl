extends UnitTestCase
## `load_fonts`: the font weights of the default font and the heading font, the warn logs of a font without a `wght`
## axis or with a weight outside its range, the `heading` text style of UI text elements, and `release`.

const _SUPPORT := preload("res://core/localization_core/tests/support/localization_test_support.gd")
const _FONT: int = ResourceCore.BaseKind.FONT
const _BODY_WEIGHT: String = "LocalizationCore.bodyFontWeight"
const _HEADING_WEIGHT: String = "LocalizationCore.headingFontWeight"
## The font size the tests measure at: a width in units of the test fonts ÷ 10.
const _MEASURE_SIZE: int = 100
## The `wght` `_wght_of` gives a font drawn without a variation.
const _UNWEIGHTED: int = -1


func after_each() -> void:
	super()
	_SUPPORT.stop()


func _loaded_font(key: String) -> Font:
	return ResourceCore.get_loaded(key, _FONT, ResourceCore.get_global_scope()) as Font


## The test resources with `font/cjk` and `font/main` set to these fonts. The chain of zh-TW is font/cjk then
## font/main, and the chain of ca is font/main alone.
func _resources(cjk: String, main: String) -> Dictionary[String, String]:
	var resources: Dictionary[String, String] = _SUPPORT.all_resources()
	resources[_SUPPORT.FONT_CJK] = cjk
	resources[_SUPPORT.FONT_MAIN] = main
	return resources


func _label(variation: StringName) -> Label:
	var label: Label = Label.new()
	label.theme_type_variation = variation
	add_child_autofree(label)
	return label


## The width of `text` drawn with the font at `_MEASURE_SIZE`. `A` is drawn with the weight axis font and `B` with
## the font without an axis.
func _width(font: Font, text: String) -> float:
	return font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, _MEASURE_SIZE).x


## A `FontVariation` of `font` at `wght` `weight`.
func _at_weight(font: Font, weight: int) -> FontVariation:
	var variation: FontVariation = FontVariation.new()
	variation.base_font = font
	LocalizationCore._set_weight(variation, weight)
	return variation


## The `wght` of a `FontVariation`; `_UNWEIGHTED` when it has none.
# ogw:input_boundary
func _wght_of(variation: FontVariation) -> int:
	var opentype: Dictionary = variation.variation_opentype
	if opentype.size() != 1:
		return _UNWEIGHTED
	var value: Variant = opentype.get(LocalizationCore._wght_tag(), _UNWEIGHTED)
	return value if value is int else _UNWEIGHTED


## Asserts that `chain` is the font chain of `fonts` in order, the font at each index drawn with the weight at that
## index of `weights` (`_UNWEIGHTED` for the font itself): the chain carries the weight of the first font, and a
## weighted fallback is a `FontVariation` of its font.
func _assert_chain(chain: Font, fonts: Array[Font], weights: PackedInt32Array) -> void:
	var variation: FontVariation = chain as FontVariation
	assert_not_null(variation)
	if variation == null:
		return
	assert_eq(variation.base_font, fonts[0])
	assert_eq(_wght_of(variation), weights[0])
	var fallbacks: Array[Font] = variation.fallbacks
	assert_eq(fallbacks.size(), fonts.size() - 1)
	for i: int in range(1, mini(fonts.size(), fallbacks.size() + 1)):
		var fallback: Font = fallbacks[i - 1]
		if weights[i] == _UNWEIGHTED:
			assert_eq(fallback, fonts[i])
			continue
		var weighted: FontVariation = fallback as FontVariation
		assert_not_null(weighted)
		if weighted != null:
			assert_eq(weighted.base_font, fonts[i])
			assert_eq(_wght_of(weighted), weights[i])


func test_body_400_and_heading_800_draw_the_axis_font_at_each_and_the_font_without_an_axis_at_its_default() -> void:
	assert_true(UnitTestCore.set_test_settings(_BODY_WEIGHT, 400))
	assert_true(UnitTestCore.set_test_settings(_HEADING_WEIGHT, 800))
	var resources: Dictionary[String, String] = _resources(_SUPPORT.WEIGHT_AXIS_FONT, _SUPPORT.NO_WEIGHT_AXIS_FONT)
	assert_eq(await _SUPPORT.start_language("zh-TW", resources), _SUPPORT.language_id("[lang_zh_tw]"))
	assert_true(await LocalizationCore.load_fonts())
	# One warn per text style for the font without an axis.
	assert_eq(_SUPPORT.warns(), 2)
	var fonts: Array[Font] = [_loaded_font(_SUPPORT.FONT_CJK), _loaded_font(_SUPPORT.FONT_MAIN)]
	var body: Font = _label(&"").get_theme_font("font")
	var heading: Font = _label(&"HeadingLabel").get_theme_font("font")
	_assert_chain(body, fonts, PackedInt32Array([400, _UNWEIGHTED]))
	_assert_chain(heading, fonts, PackedInt32Array([800, _UNWEIGHTED]))
	assert_almost_eq(_width(body, "A"), 60.0, 1.0)
	assert_almost_eq(_width(heading, "A"), 92.0, 1.0)
	assert_almost_eq(_width(body, "B"), 60.0, 1.0)
	assert_almost_eq(_width(heading, "B"), 60.0, 1.0)


func test_a_fallback_font_with_the_axis_is_drawn_at_the_weight_of_the_text_style() -> void:
	assert_true(UnitTestCore.set_test_settings(_HEADING_WEIGHT, 800))
	var resources: Dictionary[String, String] = _resources(_SUPPORT.NO_WEIGHT_AXIS_FONT, _SUPPORT.WEIGHT_AXIS_FONT)
	assert_eq(await _SUPPORT.start_language("zh-TW", resources), _SUPPORT.language_id("[lang_zh_tw]"))
	assert_true(await LocalizationCore.load_fonts())
	assert_eq(_SUPPORT.warns(), 1)
	var fonts: Array[Font] = [_loaded_font(_SUPPORT.FONT_CJK), _loaded_font(_SUPPORT.FONT_MAIN)]
	var body: Font = _label(&"").get_theme_font("font")
	var heading: Font = _label(&"HeadingLabel").get_theme_font("font")
	_assert_chain(body, fonts, PackedInt32Array([_UNWEIGHTED, _UNWEIGHTED]))
	_assert_chain(heading, fonts, PackedInt32Array([_UNWEIGHTED, 800]))
	assert_almost_eq(_width(body, "A"), 60.0, 1.0)
	assert_almost_eq(_width(heading, "A"), 92.0, 1.0)


func test_heading_1000_draws_a_font_with_the_axis_to_900_at_900_with_one_warn() -> void:
	assert_true(UnitTestCore.set_test_settings(_HEADING_WEIGHT, 1000))
	var resources: Dictionary[String, String] = _resources(_SUPPORT.NO_WEIGHT_AXIS_FONT, _SUPPORT.WEIGHT_AXIS_FONT)
	assert_eq(await _SUPPORT.start_language("ca", resources), _SUPPORT.language_id("[lang_ca]"))
	assert_true(await LocalizationCore.load_fonts())
	assert_eq(_SUPPORT.warns(), 1)
	var axis_font: Font = _loaded_font(_SUPPORT.FONT_MAIN)
	var heading: Font = _label(&"HeadingLabel").get_theme_font("font")
	var at_900: float = _width(_at_weight(axis_font, 900), "A")
	assert_almost_eq(at_900, 100.0, 1.0)
	assert_almost_eq(_width(heading, "A"), at_900, 0.01)
	# The body weight is 0: the default font draws the font itself.
	var fonts: Array[Font] = [axis_font]
	_assert_chain(_label(&"").get_theme_font("font"), fonts, PackedInt32Array([_UNWEIGHTED]))


func test_weights_0_draw_every_font_at_its_default_weight_without_a_warn() -> void:
	var resources: Dictionary[String, String] = _resources(_SUPPORT.WEIGHT_AXIS_FONT, _SUPPORT.NO_WEIGHT_AXIS_FONT)
	assert_eq(await _SUPPORT.start_language("zh-TW", resources), _SUPPORT.language_id("[lang_zh_tw]"))
	assert_true(await LocalizationCore.load_fonts())
	assert_eq(_SUPPORT.warns(), 0)
	var fonts: Array[Font] = [_loaded_font(_SUPPORT.FONT_CJK), _loaded_font(_SUPPORT.FONT_MAIN)]
	var variations: Array[StringName] = [&"", &"HeadingLabel"]
	for variation: StringName in variations:
		var font: Font = _label(variation).get_theme_font("font")
		_assert_chain(font, fonts, PackedInt32Array([_UNWEIGHTED, _UNWEIGHTED]))
		assert_almost_eq(_width(font, "A"), 60.0, 1.0)


func test_heading_text_style_elements_draw_with_the_heading_font_and_release_puts_the_default_font_back() -> void:
	assert_true(UnitTestCore.set_test_settings(_HEADING_WEIGHT, 800))
	var resources: Dictionary[String, String] = _resources(_SUPPORT.WEIGHT_AXIS_FONT, _SUPPORT.NO_WEIGHT_AXIS_FONT)
	var heading_label: Label = _label(&"HeadingLabel")
	var heading_button: Button = Button.new()
	heading_button.theme_type_variation = &"HeadingButton"
	add_child_autofree(heading_button)
	var heading_rich: RichTextLabel = RichTextLabel.new()
	heading_rich.theme_type_variation = &"HeadingRichTextLabel"
	add_child_autofree(heading_rich)
	var body_label: Label = _label(&"")
	var body_button: Button = Button.new()
	add_child_autofree(body_button)
	var body_rich: RichTextLabel = RichTextLabel.new()
	add_child_autofree(body_rich)
	var before: Font = body_label.get_theme_font("font")
	assert_eq(heading_label.get_theme_font("font"), before)
	assert_eq(await _SUPPORT.start_language("zh-TW", resources), _SUPPORT.language_id("[lang_zh_tw]"))
	assert_true(await LocalizationCore.load_fonts())
	assert_eq(_SUPPORT.warns(), 1)
	var fonts: Array[Font] = [_loaded_font(_SUPPORT.FONT_CJK), _loaded_font(_SUPPORT.FONT_MAIN)]
	var heading_fonts: Array[Font] = [heading_label.get_theme_font("font"), heading_button.get_theme_font("font"),
		heading_rich.get_theme_font("normal_font")]
	for font: Font in heading_fonts:
		_assert_chain(font, fonts, PackedInt32Array([800, _UNWEIGHTED]))
		assert_almost_eq(_width(font, "A"), 92.0, 1.0)
	var body_fonts: Array[Font] = [body_label.get_theme_font("font"), body_button.get_theme_font("font"),
		body_rich.get_theme_font("normal_font")]
	for font: Font in body_fonts:
		_assert_chain(font, fonts, PackedInt32Array([_UNWEIGHTED, _UNWEIGHTED]))
		assert_almost_eq(_width(font, "A"), 60.0, 1.0)
	LocalizationCore.release()
	assert_eq(heading_label.get_theme_font("font"), before)
	assert_eq(heading_button.get_theme_font("font"), body_button.get_theme_font("font"))
	assert_eq(heading_rich.get_theme_font("normal_font"), body_rich.get_theme_font("normal_font"))
	assert_eq(body_label.get_theme_font("font"), before)
	var theme: Theme = ThemeDB.get_default_theme()
	var types: Array[StringName] = [&"HeadingLabel", &"HeadingButton", &"HeadingRichTextLabel"]
	for type: StringName in types:
		assert_false(theme.get_type_list().has(type))


func test_release_gives_a_heading_type_the_theme_had_its_base_and_font_back() -> void:
	var theme: Theme = ThemeDB.get_default_theme()
	var own_font: FontVariation = FontVariation.new()
	theme.set_type_variation(&"HeadingLabel", &"Label")
	theme.set_color(&"font_color", &"HeadingLabel", Color.RED)
	theme.set_font(&"font", &"HeadingLabel", own_font)
	var label: Label = _label(&"HeadingLabel")
	var resources: Dictionary[String, String] = _resources(_SUPPORT.WEIGHT_AXIS_FONT, _SUPPORT.NO_WEIGHT_AXIS_FONT)
	assert_eq(await _SUPPORT.start_language("zh-TW", resources), _SUPPORT.language_id("[lang_zh_tw]"))
	assert_true(await LocalizationCore.load_fonts())
	var fonts: Array[Font] = [_loaded_font(_SUPPORT.FONT_CJK), _loaded_font(_SUPPORT.FONT_MAIN)]
	_assert_chain(label.get_theme_font("font"), fonts, PackedInt32Array([_UNWEIGHTED, _UNWEIGHTED]))
	assert_eq(label.get_theme_color("font_color"), Color.RED)
	LocalizationCore.release()
	assert_eq(theme.get_type_variation_base(&"HeadingLabel"), &"Label")
	assert_eq(theme.get_font(&"font", &"HeadingLabel"), own_font)
	assert_eq(label.get_theme_font("font"), own_font)
	assert_eq(label.get_theme_color("font_color"), Color.RED)
	theme.remove_type(&"HeadingLabel")


func test_release_leaves_a_heading_type_the_theme_had_without_a_font_item_without_one() -> void:
	var theme: Theme = ThemeDB.get_default_theme()
	# The engine default theme has a `Label` font item that holds no font.
	assert_true(theme.get_font_list(&"Label").has("font"))
	assert_eq(theme.get_font(&"font", &"Label"), theme.default_font)
	var label_font: FontVariation = FontVariation.new()
	theme.set_font(&"font", &"Label", label_font)
	theme.set_type_variation(&"HeadingLabel", &"Label")
	theme.set_color(&"font_color", &"HeadingLabel", Color.RED)
	var label: Label = _label(&"HeadingLabel")
	assert_eq(label.get_theme_font("font"), label_font)
	var resources: Dictionary[String, String] = _resources(_SUPPORT.WEIGHT_AXIS_FONT, _SUPPORT.NO_WEIGHT_AXIS_FONT)
	assert_eq(await _SUPPORT.start_language("zh-TW", resources), _SUPPORT.language_id("[lang_zh_tw]"))
	assert_true(await LocalizationCore.load_fonts())
	var fonts: Array[Font] = [_loaded_font(_SUPPORT.FONT_CJK), _loaded_font(_SUPPORT.FONT_MAIN)]
	_assert_chain(label.get_theme_font("font"), fonts, PackedInt32Array([_UNWEIGHTED, _UNWEIGHTED]))
	LocalizationCore.release()
	assert_eq(theme.get_type_variation_base(&"HeadingLabel"), &"Label")
	assert_false(theme.get_font_list(&"HeadingLabel").has("font"))
	assert_eq(label.get_theme_font("font"), label_font)
	assert_eq(_label(&"HeadingLabel").get_theme_font("font"), label_font)
	assert_eq(label.get_theme_color("font_color"), Color.RED)
	theme.remove_type(&"HeadingLabel")
	theme.set_font(&"font", &"Label", null)


func test_release_gives_a_heading_type_the_theme_had_its_font_item_without_a_font_back() -> void:
	var theme: Theme = ThemeDB.get_default_theme()
	var before: Font = theme.default_font
	theme.set_type_variation(&"HeadingButton", &"Button")
	theme.set_font(&"font", &"HeadingButton", null)
	var button: Button = Button.new()
	button.theme_type_variation = &"HeadingButton"
	add_child_autofree(button)
	assert_eq(button.get_theme_font("font"), before)
	var resources: Dictionary[String, String] = _resources(_SUPPORT.WEIGHT_AXIS_FONT, _SUPPORT.NO_WEIGHT_AXIS_FONT)
	assert_eq(await _SUPPORT.start_language("zh-TW", resources), _SUPPORT.language_id("[lang_zh_tw]"))
	assert_true(await LocalizationCore.load_fonts())
	assert_ne(button.get_theme_font("font"), before)
	LocalizationCore.release()
	assert_eq(theme.get_type_variation_base(&"HeadingButton"), &"Button")
	assert_true(theme.get_font_list(&"HeadingButton").has("font"))
	assert_eq(theme.get_font(&"font", &"HeadingButton"), before)
	assert_eq(button.get_theme_font("font"), before)
	# An item that holds no font follows the theme's default font; one set to the old default font does not.
	var other: FontVariation = FontVariation.new()
	theme.default_font = other
	assert_eq(theme.get_font(&"font", &"HeadingButton"), other)
	assert_eq(button.get_theme_font("font"), other)
	theme.default_font = before
	theme.remove_type(&"HeadingButton")


func test_second_load_fonts_applies_the_weights_again() -> void:
	assert_true(UnitTestCore.set_test_settings(_BODY_WEIGHT, 600))
	var resources: Dictionary[String, String] = _resources(_SUPPORT.NO_WEIGHT_AXIS_FONT, _SUPPORT.WEIGHT_AXIS_FONT)
	assert_eq(await _SUPPORT.start_language("ca", resources), _SUPPORT.language_id("[lang_ca]"))
	assert_true(await LocalizationCore.load_fonts())
	assert_true(await LocalizationCore.load_fonts())
	assert_eq(_SUPPORT.warns(), 0)
	var body: Font = _label(&"").get_theme_font("font")
	var fonts: Array[Font] = [_loaded_font(_SUPPORT.FONT_MAIN)]
	_assert_chain(body, fonts, PackedInt32Array([600]))
	assert_almost_eq(_width(body, "A"), 76.0, 1.0)
	LocalizationCore.release()
	assert_false(ThemeDB.get_default_theme().get_type_list().has(&"HeadingLabel"))


func test_a_system_font_without_a_system_font_in_the_browser_runtime_has_no_axis_and_no_engine_error() -> void:
	UnitTestCore.require_platform(PackedStringArray(["web"]))
	if OS.get_name() != "Web":
		return
	assert_true(UnitTestCore.set_test_settings(_BODY_WEIGHT, 400))
	# font/main is a SystemFont, which finds no system font in the browser runtime.
	assert_eq(await _SUPPORT.start_language("ca"), _SUPPORT.language_id("[lang_ca]"))
	assert_true(await LocalizationCore.load_fonts())
	assert_eq(_SUPPORT.warns(), 1)
	var fonts: Array[Font] = [_loaded_font(_SUPPORT.FONT_MAIN)]
	_assert_chain(_label(&"").get_theme_font("font"), fonts, PackedInt32Array([_UNWEIGHTED]))
