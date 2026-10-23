extends UnitTestCase
## Input prompt tokens: display names, inline icons, `load_prompt_icons` and bound elements on prompt changes.

const _SUPPORT := preload("res://core/localization_core/tests/support/localization_test_support.gd")
const Run := preload("res://core/localization_core/tests/support/async_run.gd")
const _KEY: String = _SUPPORT.TEXT_KEY
const _ICON_PATH: String = _SUPPORT.RESOURCES + "key_escape.tres"


func after_each() -> void:
	super()
	_SUPPORT.stop()


func _start_text(text: String, resources: Dictionary[String, String] = _SUPPORT.all_resources()) -> void:
	assert_ne(await _SUPPORT.start_language("en", resources), 0)
	_SUPPORT.put_text(_KEY, text)


func _icon(height: int) -> String:
	return "[img=0x%d]%s[/img]" % [height, _ICON_PATH]


func test_token_is_the_display_name_of_the_input_prompt_of_the_device() -> void:
	await _start_text("Press {action:back} [now]")
	InputCoreDev.set_test_device(InputCore.InputDevice.TOUCH)
	assert_eq(LocalizationCore.get_text(_KEY), "Press Back [now]")
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	assert_eq(LocalizationCore.get_text(_KEY), "Press Esc key [now]")
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	assert_eq(LocalizationCore.get_text(_KEY), "Press B button [now]")


func test_token_without_an_input_prompt_row_is_the_prompt_input() -> void:
	await _start_text("{action:cutscene_skip}")
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	assert_eq(LocalizationCore.get_text(_KEY), "Tab")
	InputCoreDev.set_test_device(InputCore.InputDevice.TOUCH)
	assert_eq(LocalizationCore.get_text(_KEY), "cutscene_skip")


func test_inline_icon_after_load_prompt_icons_and_display_name_before() -> void:
	await _start_text("Press {action:back} [now] {action:cutscene_skip}")
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	assert_eq(LocalizationCore.get_text(_KEY, 16), "Press Esc key [lb]now] Tab")
	assert_true(await LocalizationCore.load_prompt_icons())
	assert_true(ResourceCore.is_loaded(_SUPPORT.ICON_ESCAPE, ResourceCore.BaseKind.TEXTURE_2D))
	assert_eq(LocalizationCore.get_text(_KEY, 16), "Press " + _icon(16) + " [lb]now] Tab")
	assert_eq(LocalizationCore.get_text(_KEY), "Press Esc key [now] Tab")


func test_icon_loaded_as_the_fallback_resource_is_not_an_inline_icon() -> void:
	var resources: Dictionary[String, String] = _SUPPORT.all_resources()
	resources.erase(_SUPPORT.ICON_ESCAPE)
	await _start_text("Press {action:back}", resources)
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	assert_false(await LocalizationCore.load_prompt_icons())
	assert_eq(_SUPPORT.errors(), 1)
	assert_gt(_SUPPORT.errors("ResourceCore"), 0)
	assert_false(ResourceCore.is_loaded(_SUPPORT.ICON_ESCAPE, ResourceCore.BaseKind.TEXTURE_2D))
	for icon: String in [_SUPPORT.ICON_KEY_J, _SUPPORT.ICON_PAD_B, _SUPPORT.ICON_PS_CIRCLE]:
		assert_true(ResourceCore.is_loaded(icon, ResourceCore.BaseKind.TEXTURE_2D), icon)
	assert_eq(LocalizationCore.get_text(_KEY, 16), "Press Esc key")


func test_load_prompt_icons_while_another_runs_is_an_error_and_the_first_completes() -> void:
	await _start_text("Press {action:back}")
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	var first: Run = Run.new()
	first.start(func(run: Run) -> void: run.finish(await LocalizationCore.load_prompt_icons()))
	assert_false(first.finished)
	assert_false(await LocalizationCore.load_prompt_icons())
	assert_eq(_SUPPORT.errors(), 1)
	await first.wait()
	assert_true(first.ok)
	assert_eq(LocalizationCore.get_text(_KEY, 16), "Press " + _icon(16))
	assert_true(await LocalizationCore.load_prompt_icons())


func test_token_and_format_argument_together() -> void:
	await _start_text("{action:back} x{v:n} {v:ordinal}")
	InputCoreDev.set_test_device(InputCore.InputDevice.TOUCH)
	var args: FormatArgs = FormatArgs.new()
	args.set_int("v", 1002)
	assert_eq(LocalizationCore.format(_KEY, args), "Back x1,002 1002nd")


func test_token_without_an_input_prompt_is_empty_and_logged_once_an_action_a_load() -> void:
	await _start_text("{action:no_such_action}!")
	var expected: String = ("‼ {action:no_such_action}" if CoreBuildInfo.has_dev_code else "") + "!"
	assert_eq(LocalizationCore.get_text(_KEY), expected)
	assert_eq(LocalizationCore.get_text(_KEY), expected)
	assert_eq(_SUPPORT.errors(), 1)
	assert_gt(_SUPPORT.errors("InputCore"), 0)
	var none: Array[DownloadedTranslation] = []
	assert_true(await LocalizationCore.load_translation(none))
	_SUPPORT.put_text(_KEY, "{action:no_such_action}!")
	assert_eq(LocalizationCore.get_text(_KEY), expected)
	assert_eq(_SUPPORT.errors(), 1)
	assert_gt(_SUPPORT.errors("InputCore"), 0)


func test_bound_element_is_written_again_on_input_prompt_changed() -> void:
	await _start_text("Press {action:back}")
	InputCoreDev.set_test_device(InputCore.InputDevice.TOUCH)
	var label: Label = Label.new()
	add_child_autofree(label)
	LocalizationCore.bind_text(label, _KEY)
	assert_eq(label.text, "Press Back")
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	assert_eq(label.text, "Press B button")


func test_bound_rich_text_element_uses_its_font_size_as_the_icon_height() -> void:
	await _start_text("Press {action:back} [x]")
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	assert_true(await LocalizationCore.load_prompt_icons())
	var rich: RichTextLabel = RichTextLabel.new()
	rich.add_theme_font_size_override("normal_font_size", 20)
	add_child_autofree(rich)
	LocalizationCore.bind_text(rich, _KEY)
	assert_true(rich.bbcode_enabled)
	assert_eq(rich.text, "Press " + _icon(20) + " [lb]x]")
	LocalizationCore.set_text_scale(1500)
	assert_eq(rich.text, "Press " + _icon(30) + " [lb]x]")
	InputCoreDev.set_test_device(InputCore.InputDevice.TOUCH)
	assert_eq(rich.text, "Press Back [lb]x]")


func test_bound_rich_text_element_is_written_again_when_it_enters_the_tree() -> void:
	await _start_text("Press {action:back} [x]")
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	assert_true(await LocalizationCore.load_prompt_icons())
	LocalizationCore.set_text_scale(1500)
	var rich: RichTextLabel = RichTextLabel.new()
	rich.add_theme_font_size_override("normal_font_size", 20)
	LocalizationCore.bind_text(rich, _KEY)
	assert_eq(rich.text, "Press " + _icon(20) + " [lb]x]")
	add_child_autofree(rich)
	assert_eq(rich.get_theme_font_size("normal_font_size"), 30)
	assert_eq(rich.text, "Press " + _icon(30) + " [lb]x]")
	remove_child(rich)
	LocalizationCore.set_text_scale(2000)
	add_child(rich)
	assert_eq(rich.text, "Press " + _icon(40) + " [lb]x]")
	var unbound: RichTextLabel = RichTextLabel.new()
	unbound.add_theme_font_size_override("normal_font_size", 20)
	LocalizationCore.bind_text(unbound, _KEY)
	LocalizationCore.unbind_text(unbound)
	add_child_autofree(unbound)
	assert_eq(unbound.text, "Press " + _icon(20) + " [lb]x]")
