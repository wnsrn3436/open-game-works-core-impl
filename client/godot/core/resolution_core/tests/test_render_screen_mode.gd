extends UnitTestCase
## Screen mode on a real window. A render test: the headless pass has no window whose screen mode changes. Only the
## platforms with screen modes run the `ResolutionCore` tests: the browser runtime (`web`) has none, and its window
## changes mode only on a request within a user input.

const _SUPPORT := preload("res://core/resolution_core/tests/support/resolution_test_support.gd")

const _WINDOW: Vector2i = Vector2i(1920, 1080)
const _PLATFORMS: PackedStringArray = ["windows", "macos", "linux"]
## Frames a browser test watches the window stay windowed after a request without a user input: a negative check, which
## no condition ends.
const _MODE_FRAMES: int = 120
## Longest wait for the transient user activation of an earlier test's input to end: Chromium keeps it 5 s.
const _ACTIVATION_LIMIT_MS: int = 6000
## Where the test clicks the page: a corner of the canvas.
const _PAGE_CLICK: Vector2 = Vector2(2, 2)
## Longest wait for a window mode change and the end of its transition: a macOS transition takes about 0.5 s. The test
## fails there, long before the test time limit.
const _WAIT_LIMIT_MS: int = 3000

## Title bar changes of the root window since the last `_starts_transition` that returned true.
var _titlebar_changes: int = 0
## A wait of the test reached `_WAIT_LIMIT_MS`: the later waits of the test end at once.
var _wait_failed: bool = false


func before_each() -> void:
	super()
	_wait_failed = false
	get_tree().root.titlebar_changed.connect(_on_titlebar_changed)


func after_each() -> void:
	get_tree().paused = false
	await super()
	# The next test starts from a windowed window with no screen mode transition going on.
	_wait_failed = false
	var transition: bool = _starts_transition(DisplayServer.WINDOW_MODE_WINDOWED)
	DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED)
	await _wait_window_mode(DisplayServer.WINDOW_MODE_WINDOWED, transition)
	get_tree().root.titlebar_changed.disconnect(_on_titlebar_changed)
	_SUPPORT.stop()


## Ends the test as a skip on a platform without screen modes. False there.
func _has_screen_modes() -> bool:
	UnitTestCore.require_platform(_PLATFORMS)
	return CoreBuildInfo.platform in _PLATFORMS


func _start() -> bool:
	_SUPPORT.set_common_settings()
	if not _SUPPORT.start():
		return false
	ResolutionCoreDev.set_test_screen(_SUPPORT.BASE, _WINDOW, ResolutionCore.FillMode.LETTERBOX, true)
	return true


func test_set_screen_mode_fullscreen_saves_1_and_the_saved_mode_comes_back_after_release_and_init() -> void:
	if not _has_screen_modes():
		return
	assert_true(_start())
	await _wait_window_mode(DisplayServer.WINDOW_MODE_WINDOWED)
	var transition: bool = _starts_transition(DisplayServer.WINDOW_MODE_FULLSCREEN)
	assert_true(ResolutionCore.set_screen_mode(ResolutionCore.ScreenMode.FULLSCREEN))
	assert_eq(_SUPPORT.saved_screen_mode(), 1)
	await _wait_window_mode(DisplayServer.WINDOW_MODE_FULLSCREEN, transition)
	ResolutionCore.release()
	# A windowed window at `init`: only `apply_saved_screen_mode` makes it fullscreen again.
	transition = _starts_transition(DisplayServer.WINDOW_MODE_WINDOWED)
	DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED)
	await _wait_window_mode(DisplayServer.WINDOW_MODE_WINDOWED, transition)
	assert_eq(DisplayServer.window_get_mode(), DisplayServer.WINDOW_MODE_WINDOWED, "windowed before init")
	assert_true(ResolutionCore.init())
	ResolutionCoreDev.set_test_screen(_SUPPORT.BASE, _WINDOW, ResolutionCore.FillMode.LETTERBOX, true)
	transition = _starts_transition(DisplayServer.WINDOW_MODE_FULLSCREEN)
	ResolutionCore.apply_saved_screen_mode()
	await _wait_window_mode(DisplayServer.WINDOW_MODE_FULLSCREEN, transition)
	assert_eq(ResolutionCore.get_screen_mode(), ResolutionCore.ScreenMode.FULLSCREEN)


func test_windowed_in_the_frame_of_a_fullscreen_request_is_refused_and_the_window_ends_fullscreen() -> void:
	if not _has_screen_modes():
		return
	assert_true(_start())
	await _wait_window_mode(DisplayServer.WINDOW_MODE_WINDOWED)
	_SUPPORT.save_screen_mode(0)
	var transition: bool = _starts_transition(DisplayServer.WINDOW_MODE_FULLSCREEN)
	assert_true(ResolutionCore.set_screen_mode(ResolutionCore.ScreenMode.FULLSCREEN))
	assert_false(ResolutionCore.set_screen_mode(ResolutionCore.ScreenMode.WINDOWED), "a request in the same frame")
	assert_eq(_SUPPORT.errors(), 0, "the refusal logs no error")
	assert_eq(_SUPPORT.saved_screen_mode(), 1, "the refusal keeps the saved value")
	await _wait_window_mode(DisplayServer.WINDOW_MODE_FULLSCREEN, transition)
	assert_eq(DisplayServer.window_get_mode(), DisplayServer.WINDOW_MODE_FULLSCREEN, "fullscreen after the transition")
	assert_eq(ResolutionCore.get_screen_mode(), ResolutionCore.ScreenMode.FULLSCREEN, "after the transition")
	assert_eq(_SUPPORT.saved_screen_mode(), 1)


func test_a_request_during_the_transition_of_a_module_request_is_refused_and_one_after_its_end_is_not() -> void:
	if not _has_screen_modes():
		return
	assert_true(_start())
	await _wait_window_mode(DisplayServer.WINDOW_MODE_WINDOWED)
	var transition: bool = _starts_transition(DisplayServer.WINDOW_MODE_FULLSCREEN)
	assert_true(ResolutionCore.set_screen_mode(ResolutionCore.ScreenMode.FULLSCREEN))
	await UnitTestCore.wait_frames(1)
	if transition:
		# Only a macOS window has a transition longer than the frame of the request.
		assert_false(ResolutionCore.set_screen_mode(ResolutionCore.ScreenMode.WINDOWED), "a frame into the transition")
		assert_eq(_SUPPORT.saved_screen_mode(), 1, "the refusal keeps the saved value")
	await _wait_window_mode(DisplayServer.WINDOW_MODE_FULLSCREEN, transition)
	# The core node checks the end in the frame the end shows in, after this test resumes.
	await UnitTestCore.wait_frames(1)
	assert_eq(ResolutionCore.get_screen_mode(), ResolutionCore.ScreenMode.FULLSCREEN, "after the enter")
	transition = _starts_transition(DisplayServer.WINDOW_MODE_WINDOWED)
	assert_true(ResolutionCore.set_screen_mode(ResolutionCore.ScreenMode.WINDOWED), "after the end of the enter")
	assert_eq(_SUPPORT.saved_screen_mode(), 0)
	await _wait_window_mode(DisplayServer.WINDOW_MODE_WINDOWED, transition)
	assert_eq(DisplayServer.window_get_mode(), DisplayServer.WINDOW_MODE_WINDOWED, "windowed after the leave")
	assert_eq(ResolutionCore.get_screen_mode(), ResolutionCore.ScreenMode.WINDOWED, "after the leave")


func test_a_request_during_the_leave_of_a_module_request_is_refused_and_one_after_its_end_is_not() -> void:
	if not _has_screen_modes():
		return
	assert_true(_start())
	await _wait_window_mode(DisplayServer.WINDOW_MODE_WINDOWED)
	var transition: bool = _starts_transition(DisplayServer.WINDOW_MODE_FULLSCREEN)
	assert_true(ResolutionCore.set_screen_mode(ResolutionCore.ScreenMode.FULLSCREEN))
	await _wait_window_mode(DisplayServer.WINDOW_MODE_FULLSCREEN, transition)
	# The core node checks the end in the frame the end shows in, after this test resumes.
	await UnitTestCore.wait_frames(1)
	transition = _starts_transition(DisplayServer.WINDOW_MODE_WINDOWED)
	assert_true(ResolutionCore.set_screen_mode(ResolutionCore.ScreenMode.WINDOWED), "after the end of the enter")
	await _assert_refused_during_transition(ResolutionCore.ScreenMode.FULLSCREEN, 0, transition, "the leave")
	await _wait_window_mode(DisplayServer.WINDOW_MODE_WINDOWED, transition)
	await UnitTestCore.wait_frames(1)
	assert_eq(ResolutionCore.get_screen_mode(), ResolutionCore.ScreenMode.WINDOWED, "after the leave")
	await _assert_accepted_after_end(ResolutionCore.ScreenMode.FULLSCREEN, "the leave")


func test_a_request_during_the_enter_of_apply_saved_screen_mode_is_refused_and_one_after_its_end_is_not() -> void:
	if not _has_screen_modes():
		return
	assert_true(_start())
	await _wait_window_mode(DisplayServer.WINDOW_MODE_WINDOWED)
	_SUPPORT.save_screen_mode(1)
	var transition: bool = _starts_transition(DisplayServer.WINDOW_MODE_FULLSCREEN)
	ResolutionCore.apply_saved_screen_mode()
	await _assert_refused_during_transition(ResolutionCore.ScreenMode.WINDOWED, 1, transition, "the enter")
	await _wait_window_mode(DisplayServer.WINDOW_MODE_FULLSCREEN, transition)
	await UnitTestCore.wait_frames(1)
	assert_eq(ResolutionCore.get_screen_mode(), ResolutionCore.ScreenMode.FULLSCREEN, "after the enter")
	await _assert_accepted_after_end(ResolutionCore.ScreenMode.WINDOWED, "the enter")


func test_a_request_during_the_leave_of_apply_saved_screen_mode_is_refused_and_one_after_its_end_is_not() -> void:
	if not _has_screen_modes():
		return
	assert_true(_start())
	await _wait_window_mode(DisplayServer.WINDOW_MODE_WINDOWED)
	var transition: bool = _starts_transition(DisplayServer.WINDOW_MODE_FULLSCREEN)
	DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN)
	await _wait_window_mode(DisplayServer.WINDOW_MODE_FULLSCREEN, transition)
	await UnitTestCore.wait_frames(1)
	_SUPPORT.save_screen_mode(0)
	transition = _starts_transition(DisplayServer.WINDOW_MODE_WINDOWED)
	ResolutionCore.apply_saved_screen_mode()
	await _assert_refused_during_transition(ResolutionCore.ScreenMode.FULLSCREEN, 0, transition, "the leave")
	await _wait_window_mode(DisplayServer.WINDOW_MODE_WINDOWED, transition)
	await UnitTestCore.wait_frames(1)
	assert_eq(ResolutionCore.get_screen_mode(), ResolutionCore.ScreenMode.WINDOWED, "after the leave")
	await _assert_accepted_after_end(ResolutionCore.ScreenMode.FULLSCREEN, "the leave")


## A request for the mode the window already reads changes nothing on screen, so the window stays the same whether the
## engine drops a request during a transition or not.
func test_a_request_during_a_transition_of_an_earlier_init_goes_to_the_window() -> void:
	if not _has_screen_modes():
		return
	assert_true(_start())
	await _wait_window_mode(DisplayServer.WINDOW_MODE_WINDOWED)
	var transition: bool = _starts_transition(DisplayServer.WINDOW_MODE_FULLSCREEN)
	assert_true(ResolutionCore.set_screen_mode(ResolutionCore.ScreenMode.FULLSCREEN))
	ResolutionCore.release()
	assert_true(ResolutionCore.init())
	ResolutionCoreDev.set_test_screen(_SUPPORT.BASE, _WINDOW, ResolutionCore.FillMode.LETTERBOX, true)
	_SUPPORT.save_screen_mode(0)
	assert_true(ResolutionCore.set_screen_mode(ResolutionCore.ScreenMode.FULLSCREEN), "in the frame of the init")
	assert_eq(_SUPPORT.saved_screen_mode(), 1)
	await _wait_window_mode(DisplayServer.WINDOW_MODE_FULLSCREEN, transition)
	assert_eq(ResolutionCore.get_screen_mode(), ResolutionCore.ScreenMode.FULLSCREEN, "after the transition")


func test_a_request_during_a_transition_the_os_started_goes_to_the_window() -> void:
	if not _has_screen_modes():
		return
	assert_true(_start())
	await _wait_window_mode(DisplayServer.WINDOW_MODE_WINDOWED)
	_SUPPORT.save_screen_mode(0)
	# As the OS full screen button does.
	var transition: bool = _starts_transition(DisplayServer.WINDOW_MODE_FULLSCREEN)
	DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN)
	assert_true(ResolutionCore.set_screen_mode(ResolutionCore.ScreenMode.FULLSCREEN), "in the frame of the OS request")
	assert_eq(_SUPPORT.saved_screen_mode(), 1)
	await _wait_window_mode(DisplayServer.WINDOW_MODE_FULLSCREEN, transition)
	assert_eq(ResolutionCore.get_screen_mode(), ResolutionCore.ScreenMode.FULLSCREEN, "after the transition")


func test_a_transition_in_a_paused_tree_ends_and_the_next_request_goes_to_the_window() -> void:
	if not _has_screen_modes():
		return
	assert_true(_start())
	await _wait_window_mode(DisplayServer.WINDOW_MODE_WINDOWED)
	# As `TimeCore.set_paused(true)` and DEV step mode with budget 0 do.
	get_tree().paused = true
	var transition: bool = _starts_transition(DisplayServer.WINDOW_MODE_FULLSCREEN)
	assert_true(ResolutionCore.set_screen_mode(ResolutionCore.ScreenMode.FULLSCREEN))
	await _wait_window_mode(DisplayServer.WINDOW_MODE_FULLSCREEN, transition)
	# The core node checks the end in the frame the end shows in, after this test resumes.
	await UnitTestCore.wait_frames(1)
	assert_eq(ResolutionCore.get_screen_mode(), ResolutionCore.ScreenMode.FULLSCREEN, "after the enter")
	transition = _starts_transition(DisplayServer.WINDOW_MODE_WINDOWED)
	assert_true(ResolutionCore.set_screen_mode(ResolutionCore.ScreenMode.WINDOWED))
	# With no transition left, the request goes to the window in its frame and the engine reads the requested mode.
	assert_eq(DisplayServer.window_get_mode(), DisplayServer.WINDOW_MODE_WINDOWED, "in the frame of the request")
	await _wait_window_mode(DisplayServer.WINDOW_MODE_WINDOWED, transition)
	assert_true(get_tree().paused, "still paused")
	assert_eq(DisplayServer.window_get_mode(), DisplayServer.WINDOW_MODE_WINDOWED, "windowed after the leave")
	assert_eq(ResolutionCore.get_screen_mode(), ResolutionCore.ScreenMode.WINDOWED, "after the leave")
	assert_eq(_SUPPORT.saved_screen_mode(), 0)


func test_apply_saved_screen_mode_0_puts_a_fullscreen_window_back_to_windowed() -> void:
	if not _has_screen_modes():
		return
	assert_true(_start())
	await _wait_window_mode(DisplayServer.WINDOW_MODE_WINDOWED)
	_SUPPORT.save_screen_mode(0)
	var transition: bool = _starts_transition(DisplayServer.WINDOW_MODE_FULLSCREEN)
	DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN)
	await _wait_window_mode(DisplayServer.WINDOW_MODE_FULLSCREEN, transition)
	assert_eq(ResolutionCore.get_screen_mode(), ResolutionCore.ScreenMode.FULLSCREEN, "fullscreen before apply")
	transition = _starts_transition(DisplayServer.WINDOW_MODE_WINDOWED)
	ResolutionCore.apply_saved_screen_mode()
	await _wait_window_mode(DisplayServer.WINDOW_MODE_WINDOWED, transition)
	assert_eq(ResolutionCore.get_screen_mode(), ResolutionCore.ScreenMode.WINDOWED)
	assert_eq(_SUPPORT.saved_screen_mode(), 0)


func test_screen_mode_changed_outside_set_screen_mode_is_the_current_mode_and_is_not_saved() -> void:
	if not _has_screen_modes():
		return
	assert_true(_start())
	_SUPPORT.save_screen_mode(0)
	var transition: bool = _starts_transition(DisplayServer.WINDOW_MODE_FULLSCREEN)
	DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN)
	assert_eq(ResolutionCore.get_screen_mode(), ResolutionCore.ScreenMode.FULLSCREEN)
	assert_eq(_SUPPORT.saved_screen_mode(), 0)
	await _wait_window_mode(DisplayServer.WINDOW_MODE_FULLSCREEN, transition)


func test_release_keeps_the_window_screen_mode() -> void:
	if not _has_screen_modes():
		return
	assert_true(_start())
	var transition: bool = _starts_transition(DisplayServer.WINDOW_MODE_FULLSCREEN)
	assert_true(ResolutionCore.set_screen_mode(ResolutionCore.ScreenMode.FULLSCREEN))
	ResolutionCore.release()
	var mode: DisplayServer.WindowMode = DisplayServer.window_get_mode()
	assert_true(mode == DisplayServer.WINDOW_MODE_FULLSCREEN or mode == DisplayServer.WINDOW_MODE_EXCLUSIVE_FULLSCREEN)
	await _wait_window_mode(DisplayServer.WINDOW_MODE_FULLSCREEN, transition)


## Browser runtime: why the browser run skips the tests above. The page changes to fullscreen only on a request within
## the transient user activation of a person's input (Chromium: 5 s after it), and a frame or more after the request.
## The test host puts such an input into the page (`UnitTestCore.put_page_click`).
func test_browser_window_stays_windowed_on_fullscreen_without_a_user_input() -> void:
	if not await _web_page_without_activation():
		return
	DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN)
	await UnitTestCore.wait_frames(_MODE_FRAMES)
	assert_eq(DisplayServer.window_get_mode(), DisplayServer.WINDOW_MODE_WINDOWED,
			"still windowed %d frames after the request" % _MODE_FRAMES)


func test_browser_window_becomes_fullscreen_on_a_request_within_the_user_activation_of_a_page_click() -> void:
	if not await _web_page_without_activation():
		return
	# The window waits below end at the release of these modules, as at the test time limit.
	assert_true(_SUPPORT.start_dependencies(), "start_dependencies")
	var size: Vector2i = DisplayServer.window_get_size()
	assert_true(await UnitTestCore.put_page_click(_PAGE_CLICK), "the test host put a click into the page")
	assert_eq(_js("String(navigator.userActivation.isActive)"), "true", "the click activated the page")
	DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN)
	assert_eq(DisplayServer.window_get_mode(), DisplayServer.WINDOW_MODE_WINDOWED, "not in the frame of the request")
	var frames: int = await _wait_window_mode(DisplayServer.WINDOW_MODE_FULLSCREEN)
	assert_eq(DisplayServer.window_get_mode(), DisplayServer.WINDOW_MODE_FULLSCREEN, "fullscreen after the request")
	assert_gt(frames, 0, "a frame or more after the request")
	# The tests after this one start from the window of the run.
	DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED)
	await _wait_window_mode(DisplayServer.WINDOW_MODE_WINDOWED)
	assert_eq(DisplayServer.window_get_mode(), DisplayServer.WINDOW_MODE_WINDOWED, "the page left fullscreen")
	var start_ms: int = Time.get_ticks_msec()
	while DisplayServer.window_get_size() != size:
		if not await _wait_frame(start_ms, "the window size of the run"):
			break
	assert_eq(DisplayServer.window_get_size(), size, "the window size of the run came back")


## Ends the test as a skip outside the browser runtime, else waits until the page has no transient user activation
## left from an input of an earlier test, at most `_ACTIVATION_LIMIT_MS`. Whether the test goes on. Async.
func _web_page_without_activation() -> bool:
	UnitTestCore.require_platform(PackedStringArray(["web"]))
	if OS.get_name() != "Web":
		return false
	assert_eq(DisplayServer.window_get_mode(), DisplayServer.WINDOW_MODE_WINDOWED)
	var until: int = Time.get_ticks_msec() + _ACTIVATION_LIMIT_MS
	while _js("String(navigator.userActivation.isActive)") != "false" and Time.get_ticks_msec() < until:
		await UnitTestCore.wait_frames(1)
	var inactive: bool = _js("String(navigator.userActivation.isActive)") == "false"
	assert_true(inactive, "the page has no user activation")
	return inactive


## Right after a module request whose transition goes on: a request for `mode` in the frame of the request, and with
## `transition` (a macOS transition longer than that frame) a frame later too, is refused and keeps the saved value
## `saved`. Async.
func _assert_refused_during_transition(
	mode: ResolutionCore.ScreenMode, saved: int, transition: bool, what: String
) -> void:
	assert_false(ResolutionCore.set_screen_mode(mode), "a request in the frame of the request of " + what)
	if transition:
		await UnitTestCore.wait_frames(1)
		assert_false(ResolutionCore.set_screen_mode(mode), "a frame into " + what)
	assert_eq(_SUPPORT.errors(), 0, "the refusal logs no error")
	assert_eq(_SUPPORT.saved_screen_mode(), saved, "the refusal keeps the saved value")


## After the end of the transition `what`: a request for `mode` goes to the window, saves it, and the window takes it.
## Async.
func _assert_accepted_after_end(mode: ResolutionCore.ScreenMode, what: String) -> void:
	var window_mode: DisplayServer.WindowMode = (
		DisplayServer.WINDOW_MODE_FULLSCREEN if mode == ResolutionCore.ScreenMode.FULLSCREEN
		else DisplayServer.WINDOW_MODE_WINDOWED
	)
	var transition: bool = _starts_transition(window_mode)
	assert_true(ResolutionCore.set_screen_mode(mode), "a request after the end of " + what)
	assert_eq(_SUPPORT.saved_screen_mode(), 1 if mode == ResolutionCore.ScreenMode.FULLSCREEN else 0)
	await _wait_window_mode(window_mode, transition)
	assert_eq(DisplayServer.window_get_mode(), window_mode, "the window took the request after the end of " + what)
	assert_eq(ResolutionCore.get_screen_mode(), mode, "after the request after the end of " + what)


## Checks once a frame, with no frame count, until the window mode is `mode`: neither the page nor every OS window
## changes mode in the frame of the request, and they tell the engine no change. With `transition`
## (`_starts_transition` before the request), then until the macOS transition of the request ends. At most
## `_WAIT_LIMIT_MS` (`_wait_frame`). The frames it waited. Async.
func _wait_window_mode(mode: DisplayServer.WindowMode, transition: bool = false) -> int:
	var start_ms: int = Time.get_ticks_msec()
	var what: String = "the fullscreen window mode" if _is_fullscreen(mode) else "the windowed window mode"
	var frames: int = 0
	while DisplayServer.window_get_mode() != mode:
		if not await _wait_frame(start_ms, what):
			return frames
		frames += 1
	if not transition:
		return frames
	if _is_fullscreen(mode):
		# The end of an enter changes the title bar (`windowDidEnterFullScreen`), and the window can draw again a
		# frame or a few after it.
		while _titlebar_changes == 0 or not DisplayServer.window_can_draw():
			if not await _wait_frame(start_ms, "the end of the transition to " + what):
				return frames
			frames += 1
		return frames
	# A leave tells no end: the window cannot draw from a few frames after the request to the end.
	var hidden: bool = false
	while not hidden or not DisplayServer.window_can_draw():
		hidden = hidden or not DisplayServer.window_can_draw()
		if not await _wait_frame(start_ms, "the end of the transition to " + what):
			return frames
		frames += 1
	return frames


## Waits a frame of a wait that started at `start_ms`. At `_WAIT_LIMIT_MS` from it, fails the test once with `what`
## and does not wait; after an earlier wait of the test failed, or a release of EventCore (as at the test time limit),
## does not wait either. Whether it waited. Async.
func _wait_frame(start_ms: int, what: String) -> bool:
	if _wait_failed or not EventCore.is_initialized():
		return false
	if Time.get_ticks_msec() - start_ms >= _WAIT_LIMIT_MS:
		_wait_failed = true
		fail_test("%s did not come within %d ms" % [what, _WAIT_LIMIT_MS])
		return false
	await UnitTestCore.wait_frames(1)
	return true


## Whether a request for `mode` now starts a macOS screen mode transition the test waits out. A macOS window enters
## and leaves fullscreen by a transition of about 0.5 s, and the engine reads the requested mode from the request on.
## A screen mode request during the transition changes nothing on screen while the engine reads the requested mode:
## the window stays in its mode, and a later request moves it the other way. True when the window enters or leaves
## fullscreen and can draw now: a window that cannot draw (a display asleep) shows no end of the transition.
func _starts_transition(mode: DisplayServer.WindowMode) -> bool:
	if CoreBuildInfo.platform != "macos" or not DisplayServer.window_can_draw():
		return false
	if _is_fullscreen(DisplayServer.window_get_mode()) == _is_fullscreen(mode):
		return false
	_titlebar_changes = 0
	return true


func _on_titlebar_changed() -> void:
	_titlebar_changes += 1


static func _is_fullscreen(mode: DisplayServer.WindowMode) -> bool:
	return mode == DisplayServer.WINDOW_MODE_FULLSCREEN or mode == DisplayServer.WINDOW_MODE_EXCLUSIVE_FULLSCREEN


# ogw:input_boundary
func _js(code: String) -> String:
	var reply: Variant = JavaScriptBridge.eval(code, true)
	if reply is String:
		var text: String = reply
		return text
	return ""
