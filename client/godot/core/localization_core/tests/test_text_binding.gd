extends UnitTestCase
## `bind_text`: the bound text at binding and after `load_translation`, unbinding, and the UI text element kinds.

const _SUPPORT := preload("res://core/localization_core/tests/support/localization_test_support.gd")
const _PATH: String = "localization_test/translation_en.bin"


func after_each() -> void:
	super()
	_SUPPORT.stop()


func test_bound_element_text_follows_get_text_at_binding_and_after_load_translation() -> void:
	assert_true(await _SUPPORT.start())
	LocalizationCoreDev.set_test_device_language("en")
	assert_ne(LocalizationCore.resolve_language(), 0)
	var none: Array[DownloadedTranslation] = []
	assert_true(await LocalizationCore.load_translation(none))
	var key: String = _SUPPORT.language_name_key("[lang_en]")
	var bound: Label = Label.new()
	var unbound: Label = Label.new()
	var empty: Label = Label.new()
	add_child_autofree(bound)
	add_child_autofree(unbound)
	add_child_autofree(empty)
	LocalizationCore.bind_text(bound, key)
	LocalizationCore.bind_text(unbound, key)
	assert_eq(bound.text, "English")
	assert_eq(bound.text, LocalizationCore.get_text(key))
	LocalizationCore.unbind_text(unbound)
	assert_eq(unbound.text, "English")
	assert_false(LocalizationCore._bindings.has(unbound.get_instance_id()))
	empty.text = "before"
	LocalizationCore.bind_text(empty, "")
	assert_eq(empty.text, "")
	assert_true(LocalizationCore._bindings.has(empty.get_instance_id()))
	var bytes: PackedByteArray = _SUPPORT.translation_binary(PackedStringArray([key, "English (downloaded)"]))
	var list: Array[DownloadedTranslation] = [_SUPPORT.write_downloaded(_PATH, bytes, "en")]
	assert_true(await LocalizationCore.load_translation(list))
	assert_eq(bound.text, "English (downloaded)")
	assert_eq(bound.text, LocalizationCore.get_text(key))
	assert_eq(unbound.text, "English")
	# The element bound with the empty key stays bound: `load_translation` writes the empty string over its text.
	empty.text = "changed"
	assert_true(await LocalizationCore.load_translation(list))
	assert_eq(empty.text, "")
	assert_eq(_SUPPORT.errors(), 0)


func test_bind_text_again_with_another_key_writes_the_later_key_also_after_load_translation() -> void:
	assert_ne(await _SUPPORT.start_language("en"), 0)
	var first: String = _SUPPORT.language_name_key("[lang_en]")
	var later: String = _SUPPORT.language_name_key("[lang_ca]")
	var label: Label = Label.new()
	add_child_autofree(label)
	LocalizationCore.bind_text(label, first)
	assert_eq(label.text, "English")
	LocalizationCore.bind_text(label, later)
	assert_eq(label.text, "Català")
	assert_eq(label.text, LocalizationCore.get_text(later))
	assert_eq(LocalizationCore._bindings.size(), 1)
	var bytes: PackedByteArray = _SUPPORT.translation_binary(PackedStringArray([first, "English (downloaded)", later, "Català (downloaded)"]))
	var list: Array[DownloadedTranslation] = [_SUPPORT.write_downloaded(_PATH, bytes, "en")]
	assert_true(await LocalizationCore.load_translation(list))
	assert_eq(label.text, "Català (downloaded)")
	assert_eq(label.text, LocalizationCore.get_text(later))
	assert_eq(_SUPPORT.errors(), 0)


func test_unbind_text_of_an_element_that_is_not_bound_leaves_no_log_and_keeps_its_text() -> void:
	assert_ne(await _SUPPORT.start_language("en"), 0)
	var bound: Label = Label.new()
	var label: Label = Label.new()
	add_child_autofree(bound)
	add_child_autofree(label)
	LocalizationCore.bind_text(bound, _SUPPORT.language_name_key("[lang_en]"))
	label.text = "before"
	LocalizationCore.unbind_text(label)
	assert_eq(label.text, "before")
	assert_eq(_SUPPORT.errors(), 0)
	assert_eq(LocalizationCore._bindings.size(), 1)
	assert_true(LocalizationCore._bindings.has(bound.get_instance_id()))


func test_bind_and_unbind_of_a_missing_element_each_log_once_and_change_no_binding() -> void:
	assert_ne(await _SUPPORT.start_language("en"), 0)
	var key: String = _SUPPORT.language_name_key("[lang_en]")
	var bound: Label = Label.new()
	add_child_autofree(bound)
	LocalizationCore.bind_text(bound, key)
	LocalizationCore.bind_text(null, key)
	assert_eq(_SUPPORT.errors(), 1)
	LocalizationCore.unbind_text(null)
	assert_eq(_SUPPORT.errors(), 1)
	assert_eq(LocalizationCore._bindings.size(), 1)
	assert_eq(LocalizationCore._bindings[bound.get_instance_id()], key)


func test_unbind_text_of_an_element_that_is_not_a_ui_text_element_is_an_error() -> void:
	assert_ne(await _SUPPORT.start_language("en"), 0)
	var key: String = _SUPPORT.language_name_key("[lang_en]")
	var bound: Label = Label.new()
	add_child_autofree(bound)
	LocalizationCore.bind_text(bound, key)
	var panel: Panel = Panel.new()
	add_child_autofree(panel)
	LocalizationCore.unbind_text(panel)
	assert_eq(_SUPPORT.errors(), 1)
	assert_eq(LocalizationCore._bindings.size(), 1)
	assert_eq(LocalizationCore._bindings[bound.get_instance_id()], key)


func test_every_ui_text_element_kind_takes_the_text() -> void:
	assert_ne(await _SUPPORT.start_language("en"), 0)
	var key: String = _SUPPORT.language_name_key("[lang_ca]")
	var label: Label = Label.new()
	var button: Button = Button.new()
	var line_edit: LineEdit = LineEdit.new()
	var text_edit: TextEdit = TextEdit.new()
	var rich: RichTextLabel = RichTextLabel.new()
	var elements: Array[Control] = [label, button, line_edit, text_edit, rich]
	for element: Control in elements:
		add_child_autofree(element)
		LocalizationCore.bind_text(element, key)
	assert_eq(label.text, "Català")
	assert_eq(button.text, "Català")
	assert_eq(line_edit.text, "Català")
	assert_eq(text_edit.text, "Català")
	assert_eq(rich.text, "Català")
	assert_true(rich.bbcode_enabled)


func test_bind_text_of_an_element_that_is_not_a_ui_text_element_is_an_error() -> void:
	assert_ne(await _SUPPORT.start_language("en"), 0)
	var panel: Panel = Panel.new()
	add_child_autofree(panel)
	LocalizationCore.bind_text(panel, _SUPPORT.language_name_key("[lang_en]"))
	assert_eq(_SUPPORT.errors(), 1)
	assert_true(LocalizationCore._bindings.is_empty())
	# A `Control` that only holds a UI text element is not one either.
	var holder: Control = Control.new()
	holder.add_child(Label.new())
	add_child_autofree(holder)
	LocalizationCore.bind_text(holder, _SUPPORT.language_name_key("[lang_en]"))
	assert_eq(_SUPPORT.errors(), 1)
	assert_true(LocalizationCore._bindings.is_empty())


func test_freed_bound_element_drops_its_binding() -> void:
	assert_ne(await _SUPPORT.start_language("en"), 0)
	var key: String = _SUPPORT.language_name_key("[lang_en]")
	var label: Label = Label.new()
	add_child(label)
	LocalizationCore.bind_text(label, key)
	assert_eq(LocalizationCore._bindings.size(), 1)
	label.free()
	var none: Array[DownloadedTranslation] = []
	assert_true(await LocalizationCore.load_translation(none))
	assert_true(LocalizationCore._bindings.is_empty())


func test_bind_text_drops_freed_bindings_only_when_the_bindings_double() -> void:
	assert_ne(await _SUPPORT.start_language("en"), 0)
	var key: String = _SUPPORT.language_name_key("[lang_en]")
	var sweep: int = LocalizationCore._MIN_BINDING_SWEEP_SIZE
	var live: Array[Label] = []
	for i: int in range(sweep / 2):
		var label: Label = Label.new()
		add_child_autofree(label)
		LocalizationCore.bind_text(label, key)
		live.append(label)
	# Bound and freed elements stay in the bindings until they reach the sweep size; no `bind_text` walks them.
	for i: int in range(sweep / 2):
		var freed: Label = Label.new()
		add_child(freed)
		LocalizationCore.bind_text(freed, key)
		freed.free()
	assert_eq(LocalizationCore._bindings.size(), sweep)
	# The next `bind_text` drops the freed ones; the sweep size is then twice the live bindings.
	var label: Label = Label.new()
	add_child_autofree(label)
	LocalizationCore.bind_text(label, key)
	live.append(label)
	assert_eq(LocalizationCore._bindings.size(), live.size())
	assert_eq(LocalizationCore._binding_sweep_size, maxi(sweep, (live.size() - 1) * 2))
	for element: Label in live:
		assert_eq(element.text, "English")
	# Binding and freeing many elements keeps the bindings within twice the live bindings.
	for i: int in range(sweep * 4):
		var freed: Label = Label.new()
		add_child(freed)
		LocalizationCore.bind_text(freed, key)
		freed.free()
		assert_true(LocalizationCore._bindings.size() <= maxi(sweep, live.size() * 2))
