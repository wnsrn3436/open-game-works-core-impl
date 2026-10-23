extends "res://core/native_ui_core/tests/support/native_ui_test_case.gd"
## Screen capture and clipboard in a headless run: no screen and no clipboard. Other runs check them in the render
## tests.


func test_capture_screen_in_a_headless_run_is_empty_with_a_warning() -> void:
	if DisplayServer.get_name() != "headless":
		pass_test("not a headless run")
		return
	assert_true(await start_modules(null))
	assert_eq((await NativeUiCore.capture_screen()).size(), 0)
	assert_eq(warns(), 1)
	assert_eq(errors(), 0)


func test_copy_text_in_a_headless_run_is_false_with_a_warning() -> void:
	if DisplayServer.get_name() != "headless":
		pass_test("not a headless run")
		return
	assert_true(await start_modules(null))
	assert_false(NativeUiCore.copy_text("12345"))
	assert_eq(warns(), 1)
	assert_eq(errors(), 0)


func test_copy_text_of_an_empty_text_is_false_with_an_error() -> void:
	assert_true(await start_modules(null))
	assert_false(NativeUiCore.copy_text(""))
	assert_eq(errors(), 1)
	assert_eq(warns(), 0)
