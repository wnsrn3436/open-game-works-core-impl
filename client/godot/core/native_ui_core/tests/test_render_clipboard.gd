extends "res://core/native_ui_core/tests/support/native_ui_test_case.gd"
## Clipboard copy in a run that is not headless, on a platform that gives a clipboard. The browser runtime is left
## out: its engine clipboard writes through the page clipboard API, which needs a user input.

const _PLATFORMS: PackedStringArray = ["android", "ios", "macos", "windows", "linux"]

## Clipboard text before the test, put back after it.
var _saved: String = ""
var _has_saved: bool = false


func after_each() -> void:
	super()
	if _has_saved:
		DisplayServer.clipboard_set(_saved)
		_has_saved = false


func test_copy_text_puts_the_text_on_the_clipboard() -> void:
	UnitTestCore.require_platform(_PLATFORMS)
	if not CoreBuildInfo.platform in _PLATFORMS:
		return
	_saved = DisplayServer.clipboard_get()
	_has_saved = true
	assert_true(await start_modules(null))
	assert_true(DisplayServer.has_feature(DisplayServer.FEATURE_CLIPBOARD))
	assert_true(NativeUiCore.copy_text("12345"))
	assert_eq(DisplayServer.clipboard_get(), "12345")
	assert_false(NativeUiCore.copy_text(""))
	assert_eq(errors(), 1)
	assert_eq(DisplayServer.clipboard_get(), "12345", "the clipboard stays")
	assert_eq(warns(), 0)
