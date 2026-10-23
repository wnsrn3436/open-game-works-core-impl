extends "res://core/time_core/tests/support/time_test_case.gd"
## Page visibility of the browser runtime: the core node turns `visibilitychange` into the background entry and return
## notifications, and takes its callback off the page when it leaves the tree. The page of the browser run stays
## visible, so the test makes `document.hidden` an own property of `document` and dispatches the event itself; the
## property is deleted after a test, which gives back the `Document.prototype` getter.

## Sets `document.hidden` to the argument and dispatches `visibilitychange` on `document`.
const _SET_HIDDEN: String = """(function(h){Object.defineProperty(document,"hidden",{value:h,configurable:true});
document.dispatchEvent(new Event("visibilitychange"));return "0";})(%s)"""
const _PUT_BACK: String = """(function(){delete document.hidden;return "0";})()"""


func after_each() -> void:
	if OS.get_name() == "Web":
		_js(_PUT_BACK)
	super()


# ogw:input_boundary
func _js(code: String) -> String:
	var reply: Variant = JavaScriptBridge.eval(code, true)
	if reply is String:
		var text: String = reply
		return text
	return ""


func test_page_visibility_changes_enter_and_return_once_and_release_takes_the_callback_off() -> void:
	UnitTestCore.require_platform(PackedStringArray(["web"]))
	if OS.get_name() != "Web":
		return
	init_with_recorder()
	assert_eq(_js("typeof document.onvisibilitychange"), "function", "the core node put its callback on the page")
	assert_eq(_js(_SET_HIDDEN % "true"), "0")
	await UnitTestCore.wait_frames(1)
	assert_eq(recorder.order, PackedStringArray(["background"]))
	assert_eq(_js(_SET_HIDDEN % "false"), "0")
	await UnitTestCore.wait_frames(1)
	assert_eq(recorder.order, PackedStringArray(["background", "foreground"]))
	assert_eq(TimeCore.get_resume_count(), 1)
	TimeCore.release()
	assert_eq(_js("String(document.onvisibilitychange === null)"), "true", "release took the callback off the page")
