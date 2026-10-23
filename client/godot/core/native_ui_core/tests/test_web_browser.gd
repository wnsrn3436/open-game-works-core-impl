extends "res://core/native_ui_core/tests/support/native_ui_test_case.gd"
## `copy_text` and the share of the browser runtime. The engine clipboard writes through
## `navigator.clipboard.writeText`, which the browser refuses outside a secure context and without a transient user
## activation, and does not report to the engine. The page of the browser run is a secure context with
## `navigator.userActivation`; a click the test host puts into the page (`UnitTestCore.put_page_click`) activates it.
## The tests replace `navigator.userActivation`, `navigator.clipboard` and `window.isSecureContext` only for what that
## page cannot be: a browser without `navigator.userActivation`, a Clipboard API without `writeText`, a page that is not
## a secure context. Replaced members are put back after a test.

## Counts the `writeText` calls and how each ended, and keeps the replaced members, so `_PUT_BACK` restores them.
## `isSecureContext` is an own property of `window`, so its descriptor is kept.
const _WATCH: String = """(function(){var w=window.__ogwTestWatch={writes:0,texts:[],written:0,refused:0,errors:[],
share:navigator.share,can_share:navigator.canShare,write:navigator.clipboard?navigator.clipboard.writeText:null,
secure:Object.getOwnPropertyDescriptor(window,"isSecureContext")};
if(navigator.clipboard&&navigator.clipboard.writeText){var o=navigator.clipboard.writeText.bind(navigator.clipboard);
navigator.clipboard.writeText=function(t){w.writes++;w.texts.push(t);
return o(t).then(function(){w.written++;},function(e){w.refused++;w.errors.push(String(e&&e.name)+": "+String(e&&e.message));});};}
return "0";})()"""
const _PUT_BACK: String = """(function(){var w=window.__ogwTestWatch;if(!w){return "0";}delete navigator.clipboard;
if(w.secure){Object.defineProperty(window,"isSecureContext",w.secure);}else{delete window.isSecureContext;}
if(w.write){navigator.clipboard.writeText=w.write;}delete navigator.userActivation;
if(w.share===undefined){delete navigator.share;}else{navigator.share=w.share;}
if(w.can_share===undefined){delete navigator.canShare;}else{navigator.canShare=w.can_share;}
delete window.__ogwTestWatch;delete window.__ogwTestShareEnd;return "0";})()"""
## A browser without `navigator.userActivation`.
const _NO_USER_ACTIVATION: String = """(function(){Object.defineProperty(navigator,"userActivation",
{value:undefined,configurable:true});return "0";})()"""
## A Clipboard API with no `writeText`.
const _NO_WRITE_TEXT: String = """(function(){Object.defineProperty(navigator,"clipboard",{value:{},configurable:true});
return "0";})()"""
## A page that is not a secure context.
const _NOT_SECURE: String = """(function(){Object.defineProperty(window,"isSecureContext",
{value:false,configurable:true});return "0";})()"""
## A Web Share API whose window stays open until `window.__ogwTestShareEnd()`.
const _OPEN_SHARE: String = """(function(){navigator.canShare=function(){return true;};
navigator.share=function(){return new Promise(function(r){window.__ogwTestShareEnd=r;});};return "0";})()"""
## Where the test clicks the page: a corner of the canvas.
const _PAGE_CLICK: Vector2 = Vector2(2, 2)
## Longest wait for the transient user activation of an earlier test's input to end: Chromium keeps it 5 s.
const _ACTIVATION_LIMIT_MS: int = 6000


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


func _web_run() -> bool:
	UnitTestCore.require_platform(["web"])
	return OS.get_name() == "Web"


## Ends the test as a skip outside the browser runtime, else waits until the page has no transient user activation
## left from an input of an earlier test, at most `_ACTIVATION_LIMIT_MS`. Whether the test goes on. Async.
func _web_page_without_activation() -> bool:
	if not _web_run():
		return false
	var until: int = Time.get_ticks_msec() + _ACTIVATION_LIMIT_MS
	while _js("String(navigator.userActivation.isActive)") != "false" and Time.get_ticks_msec() < until:
		await UnitTestCore.wait_frames(1)
	var inactive: bool = _js("String(navigator.userActivation.isActive)") == "false"
	assert_true(inactive, "the page has no user activation")
	return inactive


## Checks once a frame, with no frame count, until every `writeText` call of the page ended: the page tells the engine
## no end. A release of NativeUiCore, as at the test time limit, ends the wait too. Whether they ended. Async.
func _wait_write_end() -> bool:
	var ended: String = "w.writes>0&&w.written+w.refused===w.writes"
	var check: String = "(function(){var w=window.__ogwTestWatch;return String(%s);})()" % ended
	while _js(check) != "true" and NativeUiCore.is_initialized():
		await UnitTestCore.wait_frames(1)
	return _js(check) == "true"


func test_copy_text_without_a_user_input_is_false_and_leaves_the_clipboard() -> void:
	if not await _web_page_without_activation():
		return
	assert_true(await start_modules(null))
	assert_eq(_js(_WATCH), "0")
	assert_eq(_js("String(window.isSecureContext)"), "true", "the page is a secure context")
	assert_false(NativeUiCore.copy_text("12345"), "the browser refuses the write")
	assert_eq(warns(), 1)
	await UnitTestCore.wait_frames(2)
	assert_eq(_js("String(window.__ogwTestWatch.writes)"), "0", "no clipboard write")


## The page's real `navigator.userActivation` after a trusted click: the browser writes the clipboard. The browser run
## grants the page clipboard writes when it attaches to it, as a person's browser writes within a user activation
## without asking.
func test_copy_text_within_the_user_activation_of_a_page_click_writes_the_clipboard() -> void:
	if not await _web_page_without_activation():
		return
	assert_true(await start_modules(null))
	assert_eq(_js(_WATCH), "0")
	assert_true(await UnitTestCore.put_page_click(_PAGE_CLICK), "the test host put a click into the page")
	assert_eq(_js("String(navigator.userActivation.isActive)"), "true", "the click activated the page")
	assert_eq(_js("String(document.hasFocus())"), "true", "the click focused the page")
	assert_true(NativeUiCore.copy_text("12345"))
	assert_eq(warns(), 0)
	assert_true(await _wait_write_end(), "the clipboard write ended")
	assert_eq(_js("String(window.__ogwTestWatch.writes)"), "1", "the engine asked the page for the write")
	assert_eq(_js("window.__ogwTestWatch.texts[0]"), "12345")
	assert_eq(_js("window.__ogwTestWatch.errors.join('; ')"), "", "the browser did not refuse the write")
	assert_eq(_js("String(window.__ogwTestWatch.written)"), "1", "the browser wrote the clipboard")


func test_copy_text_in_a_browser_without_navigator_user_activation_asks_for_the_write() -> void:
	if not await _web_page_without_activation():
		return
	assert_true(await start_modules(null))
	assert_eq(_js(_WATCH), "0")
	assert_eq(_js(_NO_USER_ACTIVATION), "0")
	assert_eq(_js("typeof navigator.userActivation"), "undefined")
	assert_true(NativeUiCore.copy_text("12345"), "a browser without navigator.userActivation counts as activated")
	assert_true(await _wait_write_end(), "the clipboard write ended")
	assert_eq(_js("String(window.__ogwTestWatch.writes)"), "1", "the engine asked the page for the write")
	assert_eq(_js("window.__ogwTestWatch.texts[0]"), "12345")
	assert_eq(warns(), 0)


func test_copy_text_without_the_clipboard_write_api_is_false_within_a_user_activation() -> void:
	if not await _web_page_without_activation():
		return
	assert_true(await start_modules(null))
	assert_eq(_js(_WATCH), "0")
	assert_true(await UnitTestCore.put_page_click(_PAGE_CLICK), "the test host put a click into the page")
	assert_eq(_js(_NO_WRITE_TEXT), "0")
	assert_false(NativeUiCore.copy_text("12345"), "no navigator.clipboard.writeText")
	assert_eq(warns(), 1)
	await UnitTestCore.wait_frames(2)
	assert_eq(_js("String(window.__ogwTestWatch.writes)"), "0", "no clipboard write")


func test_copy_text_outside_a_secure_context_is_false_within_a_user_activation() -> void:
	if not await _web_page_without_activation():
		return
	assert_true(await start_modules(null))
	assert_eq(_js(_WATCH), "0")
	assert_true(await UnitTestCore.put_page_click(_PAGE_CLICK), "the test host put a click into the page")
	assert_eq(_js(_NOT_SECURE), "0")
	assert_false(NativeUiCore.copy_text("12345"))
	assert_eq(warns(), 1)
	await UnitTestCore.wait_frames(2)
	assert_eq(_js("String(window.__ogwTestWatch.writes)"), "0", "no clipboard write")


func test_the_browser_without_the_web_share_api_cannot_share() -> void:
	if not _web_run():
		return
	if _js("typeof navigator.share") != "undefined":
		pass_test("this browser has the Web Share API")
		return
	assert_true(await start_modules(NativeUiWebAdapter.new()))
	assert_false(NativeUiCore.can_share())
	assert_eq(await NativeUiCore.share(content("hi")), SHARE_UNSUPPORTED)
	assert_eq(errors(), 0)


func test_release_ends_a_web_share_whose_window_stays_open() -> void:
	if not _web_run():
		return
	assert_eq(_js(_WATCH), "0")
	assert_eq(_js(_OPEN_SHARE), "0")
	assert_true(await start_modules(NativeUiWebAdapter.new()))
	assert_true(NativeUiCore.can_share())
	start_share(content("hi"))
	UnitTestCore.advance_clock(REVIEW_INTERVAL_MS, false)
	await UnitTestCore.wait_frames(3)
	assert_eq(share_results.size(), 0, "the share waits for the window with no time limit")
	NativeUiCore.release()
	await UnitTestCore.wait_frames(2)
	assert_eq(share_results.size(), 1, "release ends the share")
	if share_results.size() == 1:
		assert_eq(share_results[0], SHARE_FAILED)
	_js("window.__ogwTestShareEnd();\"0\"")
	await UnitTestCore.wait_frames(2)
	assert_eq(
		_js("JSON.stringify(window.ogwNativeUiShare.results)+JSON.stringify(window.ogwNativeUiShare.dropped)"),
		"{}{}",
		"the late result is dropped"
	)
	assert_eq(errors(), 0)
