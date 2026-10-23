extends UnitTestCase
## Text scale: the font size of UI text elements in the tree, elements added later, `release`, and errors.

const _SUPPORT := preload("res://core/localization_core/tests/support/localization_test_support.gd")


func after_each() -> void:
	super()
	_SUPPORT.stop()


func _label(size: int) -> Label:
	var label: Label = Label.new()
	label.add_theme_font_size_override("font_size", size)
	add_child_autofree(label)
	return label


func test_text_scale_sets_the_font_size_of_elements_now_and_later_and_release_puts_it_back() -> void:
	assert_true(await _SUPPORT.start())
	assert_eq(LocalizationCore.get_text_scale(), 1000)
	var before: Label = _label(20)
	assert_eq(before.get_theme_font_size("font_size"), 20)
	LocalizationCore.set_text_scale(1500)
	assert_eq(LocalizationCore.get_text_scale(), 1500)
	assert_eq(before.get_theme_font_size("font_size"), 30)
	var after: Label = _label(20)
	assert_eq(after.get_theme_font_size("font_size"), 30)
	var rich: RichTextLabel = RichTextLabel.new()
	rich.add_theme_font_size_override("normal_font_size", 15)
	add_child_autofree(rich)
	assert_eq(rich.get_theme_font_size("normal_font_size"), 22)
	LocalizationCore.release()
	assert_eq(before.get_theme_font_size("font_size"), 20)
	assert_eq(after.get_theme_font_size("font_size"), 20)
	assert_eq(rich.get_theme_font_size("normal_font_size"), 15)


func test_element_existing_before_init_is_scaled() -> void:
	var label: Label = _label(10)
	assert_true(await _SUPPORT.start())
	LocalizationCore.set_text_scale(2500)
	assert_eq(label.get_theme_font_size("font_size"), 25)


func test_font_size_is_at_least_1() -> void:
	assert_true(await _SUPPORT.start())
	var label: Label = _label(3)
	LocalizationCore.set_text_scale(100)
	assert_eq(label.get_theme_font_size("font_size"), 1)


func test_element_out_of_the_tree_gets_its_first_size_back() -> void:
	assert_true(await _SUPPORT.start())
	LocalizationCore.set_text_scale(2000)
	var label: Label = _label(12)
	assert_eq(label.get_theme_font_size("font_size"), 24)
	remove_child(label)
	assert_eq(label.get_theme_font_size("font_size"), 12)
	add_child(label)
	assert_eq(label.get_theme_font_size("font_size"), 24)


func test_text_scale_less_than_1_is_an_error_and_the_same_value_does_nothing() -> void:
	assert_true(await _SUPPORT.start())
	var label: Label = _label(20)
	LocalizationCore.set_text_scale(1500)
	LocalizationCore.set_text_scale(0)
	assert_eq(_SUPPORT.errors(), 1)
	assert_eq(LocalizationCore.get_text_scale(), 1500)
	assert_eq(label.get_theme_font_size("font_size"), 30)
	LocalizationCore.set_text_scale(1500)
	assert_eq(label.get_theme_font_size("font_size"), 30)
