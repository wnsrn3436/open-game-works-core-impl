extends UnitTestCase
## Screen mode cases that need no real window: the saved value, platforms without screen modes, and the end of a
## module request on a window that does not change mode at the request.

const _SUPPORT := preload("res://core/resolution_core/tests/support/resolution_test_support.gd")

const _WINDOW: Vector2i = Vector2i(1920, 1080)


func after_each() -> void:
	super()
	_SUPPORT.stop()
	CoreBuildInfo.platform = CoreBuildInfo.os_platform()


func _start(supported: bool) -> bool:
	_SUPPORT.set_common_settings()
	if not _SUPPORT.start():
		return false
	ResolutionCoreDev.set_test_screen(_SUPPORT.BASE, _WINDOW, ResolutionCore.FillMode.LETTERBOX, supported)
	return true


func test_saved_screen_mode_other_than_0_and_1_logs_a_warning_and_is_windowed() -> void:
	assert_true(_start(true))
	_SUPPORT.save_screen_mode(2)
	ResolutionCore.apply_saved_screen_mode()
	assert_eq(_SUPPORT.warnings(), 1)
	assert_eq(ResolutionCore.get_screen_mode(), ResolutionCore.ScreenMode.WINDOWED)


func test_set_screen_mode_without_screen_mode_support_logs_an_error_and_saves_nothing() -> void:
	assert_true(_start(false))
	_SUPPORT.save_screen_mode(0)
	assert_false(ResolutionCore.set_screen_mode(ResolutionCore.ScreenMode.FULLSCREEN))
	assert_eq(_SUPPORT.errors(), 1)
	assert_eq(_SUPPORT.saved_screen_mode(), 0)


func test_get_screen_mode_without_screen_mode_support_logs_an_error_and_is_fullscreen() -> void:
	assert_true(_start(false))
	assert_eq(ResolutionCore.get_screen_mode(), ResolutionCore.ScreenMode.FULLSCREEN)
	assert_eq(_SUPPORT.errors(), 1)


func test_apply_saved_screen_mode_without_screen_mode_support_does_nothing_without_a_log() -> void:
	assert_true(_start(false))
	_SUPPORT.save_screen_mode(2)
	ResolutionCore.apply_saved_screen_mode()
	assert_eq(_SUPPORT.saved_screen_mode(), 2)


func test_set_screen_mode_with_a_value_outside_the_screen_modes_logs_an_error_and_fails() -> void:
	assert_true(_start(true))
	assert_false(ResolutionCore.set_screen_mode(7 as ResolutionCore.ScreenMode))
	assert_eq(_SUPPORT.errors(), 1)
	assert_eq(_SUPPORT.saved_screen_mode(), -1)


## The headless display server ignores `window_set_mode` and reads no fullscreen, as a driver that changes the mode
## after the request (Wayland at the compositor's configure). Off macOS the transition of a module request still ends
## only with the frame of the request.
func test_off_macos_a_request_in_the_frame_of_a_request_the_window_did_not_read_yet_is_refused() -> void:
	if DisplayServer.get_name() != "headless":
		pass_test("not a headless run")
		return
	CoreBuildInfo.platform = "linux"
	assert_true(_start(true))
	_SUPPORT.save_screen_mode(0)
	assert_true(ResolutionCore.set_screen_mode(ResolutionCore.ScreenMode.FULLSCREEN))
	assert_eq(ResolutionCore.get_screen_mode(), ResolutionCore.ScreenMode.WINDOWED, "the window did not read the request")
	assert_false(ResolutionCore.set_screen_mode(ResolutionCore.ScreenMode.WINDOWED), "a request in the same frame")
	assert_eq(_SUPPORT.errors(), 0, "the refusal logs no error")
	assert_eq(_SUPPORT.saved_screen_mode(), 1, "the refusal keeps the saved value")
	await UnitTestCore.wait_frames(1)
	assert_true(ResolutionCore.set_screen_mode(ResolutionCore.ScreenMode.WINDOWED), "a request after the frame")
	assert_eq(_SUPPORT.saved_screen_mode(), 0)


## The same window on macOS: AppKit starts no transition for a request the window did not take, so no transition of
## the module waits for an end that never comes.
func test_on_macos_a_request_the_window_did_not_take_starts_no_transition() -> void:
	if DisplayServer.get_name() != "headless":
		pass_test("not a headless run")
		return
	CoreBuildInfo.platform = "macos"
	assert_true(_start(true))
	_SUPPORT.save_screen_mode(0)
	assert_true(ResolutionCore.set_screen_mode(ResolutionCore.ScreenMode.FULLSCREEN))
	assert_eq(_SUPPORT.saved_screen_mode(), 1)
	await UnitTestCore.wait_frames(2)
	assert_true(ResolutionCore.set_screen_mode(ResolutionCore.ScreenMode.WINDOWED), "a request frames later")
	assert_eq(_SUPPORT.saved_screen_mode(), 0)
