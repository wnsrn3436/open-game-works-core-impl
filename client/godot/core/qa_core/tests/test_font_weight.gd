extends "res://core/qa_core/tests/support/qa_test_case.gd"
## `font_weight` of `list_ui`: the `wght` of the body and heading text styles on a font with a `wght` axis, the axis
## default, the clamp to the axis, the outermost `FontVariation` that sets a weight, the weight class of a font without
## the axis, and 0 for an element without text.

const BODY_WEIGHT: String = "LocalizationCore.bodyFontWeight"
const HEADING_WEIGHT: String = "LocalizationCore.headingFontWeight"
## One glyph for U+0041 and a `wght` axis from 100 to 900, default 400.
const AXIS_FONT: String = RESOURCES + "qa_font_weight_axis.tres"
## One glyph for U+0042 and no variation axis.
const NO_AXIS_FONT: String = RESOURCES + "qa_font_no_weight_axis.tres"
const AXIS_MAX: int = 900
const AXIS_DEFAULT: int = 400

## The font file both font keys of the test resources point to.
var font_path: String = AXIS_FONT


func resource_keys() -> Dictionary[String, String]:
	var keys: Dictionary[String, String] = super()
	for font: String in ["font/main", "font/cjk"]:
		keys[font] = font_path
	return keys


## Starts the modules with the test fonts at `path` applied by `LocalizationCore.load_fonts`.
func start_with_fonts(path: String, body: int, heading: int) -> bool:
	font_path = path
	set_int(BODY_WEIGHT, body)
	set_int(HEADING_WEIGHT, heading)
	if not await start():
		return false
	var loaded: bool = await LocalizationCore.load_fonts()
	assert_true(loaded, "LocalizationCore.load_fonts")
	return loaded


## A text element of class `kind` in the scene UI layer, in the theme type variation `variation`.
func add_text(element_name: String, kind: String, variation: StringName, text: String, y: float) -> Control:
	var element: Control = null
	match kind:
		"Button":
			var button: Button = Button.new()
			button.text = text
			element = button
		"RichTextLabel":
			var rich: RichTextLabel = RichTextLabel.new()
			rich.text = text
			rich.fit_content = true
			rich.custom_minimum_size = Vector2(200, 0)
			element = rich
		_:
			var label: Label = Label.new()
			label.text = text
			element = label
	element.name = element_name
	element.theme_type_variation = variation
	element.position = Vector2(100, y)
	UICore.get_layer(UICore.UILayer.SCENE_UI).add_child(element)
	return element


## The font of `font/main` that `LocalizationCore.load_fonts` loaded.
func loaded_font() -> Font:
	return ResourceCore.get_loaded("font/main", ResourceCore.BaseKind.FONT, ResourceCore.get_global_scope()) as Font


func weight_of(list: String, suffix: String) -> int:
	var index: int = element_index(list, suffix)
	assert_true(index >= 0, "list_ui has " + suffix)
	return JSONR.integer(list, "%d.font_weight" % index) if index >= 0 else -1


func test_body_400_and_heading_800_on_a_font_with_the_axis() -> void:
	assert_true(await start_with_fonts(AXIS_FONT, 400, 800))
	add_text("BodyLabel", "Label", &"", "A", 100)
	add_text("HeadingLabel", "Label", &"HeadingLabel", "A", 150)
	add_text("HeadingButton", "Button", &"HeadingButton", "A", 200)
	add_text("HeadingRich", "RichTextLabel", &"HeadingRichTextLabel", "A", 250)
	add_text("BodyRich", "RichTextLabel", &"", "A", 300)
	add_text("Empty", "Label", &"HeadingLabel", "", 350)
	var no_text: Control = Control.new()
	no_text.name = "NoText"
	no_text.size = Vector2(10, 10)
	UICore.get_layer(UICore.UILayer.SCENE_UI).add_child(no_text)
	await UnitTestCore.wait_frames(1)
	var list: String = await run_ok("list_ui")
	assert_eq(weight_of(list, "BodyLabel"), 400, "body")
	assert_eq(weight_of(list, "HeadingLabel"), 800, "heading Label")
	assert_eq(weight_of(list, "HeadingButton"), 800, "heading Button")
	assert_eq(weight_of(list, "HeadingRich"), 800, "heading RichTextLabel reads normal_font")
	assert_eq(weight_of(list, "BodyRich"), 400, "body RichTextLabel")
	assert_eq(weight_of(list, "Empty"), 0, "an element whose text is empty")
	assert_eq(weight_of(list, "NoText"), 0, "an element that is not a text element")


func test_weights_0_give_the_axis_default() -> void:
	assert_true(await start_with_fonts(AXIS_FONT, 0, 0))
	add_text("BodyLabel", "Label", &"", "A", 100)
	add_text("HeadingLabel", "Label", &"HeadingLabel", "A", 150)
	await UnitTestCore.wait_frames(1)
	var list: String = await run_ok("list_ui")
	assert_eq(weight_of(list, "BodyLabel"), AXIS_DEFAULT)
	assert_eq(weight_of(list, "HeadingLabel"), AXIS_DEFAULT)


func test_a_weight_outside_the_axis_is_clamped_to_it() -> void:
	assert_true(await start_with_fonts(AXIS_FONT, 400, 1000))
	add_text("HeadingLabel", "Label", &"HeadingLabel", "A", 150)
	await UnitTestCore.wait_frames(1)
	assert_eq(weight_of(await run_ok("list_ui"), "HeadingLabel"), AXIS_MAX, "the engine draws it at the end of the axis")


func test_the_outermost_font_variation_that_sets_a_weight_gives_it() -> void:
	assert_true(await start_with_fonts(AXIS_FONT, 0, 0))
	var font: Font = loaded_font()
	var inner: FontVariation = FontVariation.new()
	inner.base_font = font
	set_weight(inner, 300)
	var middle: FontVariation = FontVariation.new()
	middle.base_font = inner
	set_weight(middle, 700)
	var outer: FontVariation = FontVariation.new()
	outer.base_font = middle
	var nested: Control = add_text("Nested", "Label", &"", "A", 100)
	nested.add_theme_font_override(&"font", outer)
	var unset: FontVariation = FontVariation.new()
	unset.base_font = font
	var plain: Control = add_text("Unset", "Label", &"", "A", 150)
	plain.add_theme_font_override(&"font", unset)
	await UnitTestCore.wait_frames(1)
	var list: String = await run_ok("list_ui")
	assert_eq(weight_of(list, "Nested"), 700, "the outermost FontVariation that sets wght")
	assert_eq(weight_of(list, "Unset"), AXIS_DEFAULT, "no FontVariation sets wght")


func test_a_font_without_the_axis_gives_its_weight_class() -> void:
	assert_true(await start_with_fonts(NO_AXIS_FONT, 400, 800))
	add_text("BodyLabel", "Label", &"", "B", 100)
	add_text("HeadingLabel", "Label", &"HeadingLabel", "B", 150)
	await UnitTestCore.wait_frames(1)
	var declared: int = loaded_font().get_font_weight()
	assert_gt(declared, 0, "the test font declares a weight class")
	var list: String = await run_ok("list_ui")
	assert_eq(weight_of(list, "BodyLabel"), declared)
	assert_eq(weight_of(list, "HeadingLabel"), declared)


## Sets `variation_opentype` of `variation` to `wght` at `weight`, keyed by the axis tag. The property takes an
## untyped Dictionary.
# ogw:input_boundary
func set_weight(variation: FontVariation, weight: int) -> void:
	var coordinates: Dictionary = {}
	coordinates[TextServerManager.get_primary_interface().name_to_tag("wght")] = weight
	variation.variation_opentype = coordinates
