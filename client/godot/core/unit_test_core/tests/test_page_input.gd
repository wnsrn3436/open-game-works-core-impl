extends UnitTestCase
## Page input of the browser run: the test host puts a click or a key press into the page as a person's input.

## Records on the page whether each `mousedown` and `keydown` was a trusted event, and the page's user activation.
const _WATCH: String = """(function(){var w=window.__ogwInputWatch={events:[]};
var on=function(e){w.events.push(e.type+":"+e.isTrusted+":"+(e.key||""));};
window.addEventListener("mousedown",on,true);window.addEventListener("keydown",on,true);
w.stop=function(){window.removeEventListener("mousedown",on,true);window.removeEventListener("keydown",on,true);
delete window.__ogwInputWatch;return "0";};return "0";})()"""
const _NATIVE: PackedStringArray = ["macos", "windows", "linux"]


## Mouse buttons the engine received, as `pressed` flags in order.
var _engine_presses: Array[bool] = []
## `Q` key events the engine received, as `pressed` flags in order.
var _engine_keys: Array[bool] = []


func after_each() -> void:
	if OS.get_name() == "Web":
		_js("window.__ogwInputWatch ? window.__ogwInputWatch.stop() : '0'")
	await super()


func _input(event: InputEvent) -> void:
	var button: InputEventMouseButton = event as InputEventMouseButton
	if button != null and button.button_index == MOUSE_BUTTON_LEFT:
		_engine_presses.append(button.pressed)
	var key: InputEventKey = event as InputEventKey
	if key != null and not key.echo and (key.keycode == KEY_Q or key.physical_keycode == KEY_Q):
		_engine_keys.append(key.pressed)


# ogw:input_boundary
func _js(code: String) -> String:
	var reply: Variant = JavaScriptBridge.eval(code, true)
	if reply is String:
		var text: String = reply
		return text
	return ""


func test_a_page_click_and_a_page_key_are_trusted_page_events_that_activate_the_page() -> void:
	UnitTestCore.require_platform(PackedStringArray(["web"]))
	if OS.get_name() != "Web":
		return
	assert_eq(_js(_WATCH), "0")
	assert_true(await UnitTestCore.put_page_click(Vector2(2, 2)))
	assert_eq(_js("window.__ogwInputWatch.events.join(',')"), "mousedown:true:", "a trusted mousedown")
	assert_eq(_js("String(navigator.userActivation.isActive)"), "true", "the page has a user activation")
	await UnitTestCore.wait_frames(2)
	var press_and_release: Array[bool] = [true, false]
	assert_eq(_engine_presses, press_and_release, "the engine got the press and the release")
	assert_true(await UnitTestCore.put_page_key("q"))
	assert_eq(_js("window.__ogwInputWatch.events.join(',')"), "mousedown:true:,keydown:true:q", "a trusted keydown")
	await UnitTestCore.wait_frames(2)
	assert_eq(_engine_keys, press_and_release, "the engine got the key press and the key release")


## An error log would fail the test: it is left unchecked.
func test_page_input_is_false_without_an_error_log_in_the_native_run() -> void:
	UnitTestCore.require_platform(_NATIVE)
	if not CoreBuildInfo.platform in _NATIVE:
		return
	assert_false(await UnitTestCore.put_page_click(Vector2(2, 2)))
	assert_false(await UnitTestCore.put_page_key("q"))
