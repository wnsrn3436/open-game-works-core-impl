extends UnitTestCase
## `load_fonts`: the font chain as the default font of UI text elements, a fallback font, a second `load_fonts`
## while one runs, and `release`.

const _SUPPORT := preload("res://core/localization_core/tests/support/localization_test_support.gd")
const Run := preload("res://core/localization_core/tests/support/async_run.gd")
const _FONT: int = ResourceCore.BaseKind.FONT


func after_each() -> void:
	super()
	_SUPPORT.stop()


func _loaded_font(key: String) -> Font:
	return ResourceCore.get_loaded(key, _FONT, ResourceCore.get_global_scope()) as Font


## A `Label` and a `RichTextLabel` without a font override, in the tree.
func _text_elements() -> Array[Control]:
	var label: Label = Label.new()
	var rich: RichTextLabel = RichTextLabel.new()
	add_child_autofree(label)
	add_child_autofree(rich)
	return [label, rich]


## The fonts the elements of `_text_elements` draw with.
func _fonts_of(elements: Array[Control]) -> Array[Font]:
	return [elements[0].get_theme_font("font"), elements[1].get_theme_font("normal_font")]


## Asserts that every font is the font chain: `base` first, then `fallbacks` in order.
func _assert_chain(fonts: Array[Font], base: Font, fallbacks: Array[Font]) -> void:
	for font: Font in fonts:
		var chain: FontVariation = font as FontVariation
		assert_not_null(chain)
		if chain == null:
			continue
		assert_eq(chain.base_font, base)
		var found: Array[Font] = chain.fallbacks
		assert_eq(found, fallbacks)


func test_default_font_finds_characters_in_font_chain_order_with_a_shared_font_once() -> void:
	var elements: Array[Control] = _text_elements()
	var before: Array[Font] = _fonts_of(elements)
	# zh-TW falls back to zh-Hans, which has the same font, then to en.
	assert_eq(await _SUPPORT.start_language("zh-TW"), _SUPPORT.language_id("[lang_zh_tw]"))
	assert_eq(LocalizationCore._font_chain_keys(), PackedStringArray([_SUPPORT.FONT_CJK, _SUPPORT.FONT_MAIN]))
	assert_true(await LocalizationCore.load_fonts())
	assert_true(ResourceCore.is_loaded(_SUPPORT.FONT_CJK, _FONT))
	assert_true(ResourceCore.is_loaded(_SUPPORT.FONT_MAIN, _FONT))
	var fallbacks: Array[Font] = [_loaded_font(_SUPPORT.FONT_MAIN)]
	_assert_chain(_fonts_of(elements), _loaded_font(_SUPPORT.FONT_CJK), fallbacks)
	# An element made after `load_fonts` takes the chain too.
	_assert_chain(_fonts_of(_text_elements()), _loaded_font(_SUPPORT.FONT_CJK), fallbacks)
	LocalizationCore.release()
	assert_eq(_fonts_of(elements), before)
	assert_eq(_fonts_of(_text_elements()), before)


func test_language_without_a_fallback_has_its_font_alone() -> void:
	var elements: Array[Control] = _text_elements()
	assert_eq(await _SUPPORT.start_language("ca"), _SUPPORT.language_id("[lang_ca]"))
	assert_true(await LocalizationCore.load_fonts())
	var none: Array[Font] = []
	_assert_chain(_fonts_of(elements), _loaded_font(_SUPPORT.FONT_MAIN), none)


func test_fallback_font_in_the_chain_is_an_error_and_the_chain_keeps_its_place() -> void:
	var elements: Array[Control] = _text_elements()
	var before: Array[Font] = _fonts_of(elements)
	var resources: Dictionary[String, String] = _SUPPORT.all_resources()
	resources.erase(_SUPPORT.FONT_CJK)
	assert_eq(await _SUPPORT.start_language("zh-TW", resources), _SUPPORT.language_id("[lang_zh_tw]"))
	assert_false(await LocalizationCore.load_fonts())
	assert_eq(_SUPPORT.errors(), 1)
	assert_gt(_SUPPORT.errors("ResourceCore"), 0)
	assert_false(ResourceCore.is_loaded(_SUPPORT.FONT_CJK, _FONT))
	# The fallback resource of the font kind; ResourceCore logs the failure of a key once.
	var fallback: Font = await ResourceCore.load(_SUPPORT.FONT_CJK, _FONT, ResourceCore.get_global_scope()) as Font
	var fallbacks: Array[Font] = [_loaded_font(_SUPPORT.FONT_MAIN)]
	_assert_chain(_fonts_of(elements), fallback, fallbacks)
	LocalizationCore.release()
	assert_eq(_fonts_of(elements), before)


func test_element_under_a_canvas_layer_and_a_theme_without_a_font_takes_the_chain() -> void:
	var layer: CanvasLayer = CanvasLayer.new()
	add_child_autofree(layer)
	var panel: Control = Control.new()
	var game_theme: Theme = Theme.new()
	game_theme.set_color("font_color", "Label", Color.RED)
	panel.theme = game_theme
	layer.add_child(panel)
	var label: Label = Label.new()
	panel.add_child(label)
	var before: Font = label.get_theme_font("font")
	assert_eq(await _SUPPORT.start_language("ca"), _SUPPORT.language_id("[lang_ca]"))
	assert_true(await LocalizationCore.load_fonts())
	var none: Array[Font] = []
	_assert_chain([label.get_theme_font("font")], _loaded_font(_SUPPORT.FONT_MAIN), none)
	assert_eq(label.get_theme_color("font_color"), Color.RED)
	assert_false(game_theme.has_default_font())
	LocalizationCore.release()
	assert_eq(label.get_theme_font("font"), before)


func test_load_fonts_while_another_runs_is_an_error_and_the_first_completes() -> void:
	var elements: Array[Control] = _text_elements()
	assert_eq(await _SUPPORT.start_language("zh-TW"), _SUPPORT.language_id("[lang_zh_tw]"))
	var first: Run = Run.new()
	first.start(func(run: Run) -> void: run.finish(await LocalizationCore.load_fonts()))
	assert_false(first.finished)
	assert_false(await LocalizationCore.load_fonts())
	assert_eq(_SUPPORT.errors(), 1)
	await first.wait()
	assert_true(first.ok)
	var fallbacks: Array[Font] = [_loaded_font(_SUPPORT.FONT_MAIN)]
	_assert_chain(_fonts_of(elements), _loaded_font(_SUPPORT.FONT_CJK), fallbacks)
	assert_true(await LocalizationCore.load_fonts())


func test_load_fonts_before_a_current_language_is_an_error() -> void:
	assert_true(await _SUPPORT.start())
	assert_false(await LocalizationCore.load_fonts())
	assert_eq(_SUPPORT.errors(), 1)
