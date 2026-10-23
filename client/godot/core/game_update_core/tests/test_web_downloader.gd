extends "res://core/game_update_core/tests/support/game_update_test_case.gd"
## The default downloader of the browser runtime, the page `fetch` with `redirect: "manual"`: the size limit, the
## cancel and the stall timeout over it.

const _STALL_MS: int = 5000
const _MAX_BYTES: int = 64
const _PAGE_STATE: String = "window.ogwGameUpdateFetch"


## Holds the result of a `download` the test does not await.
class Running:
	extends RefCounted
	var done: bool = false
	var ends: int = 0
	var result: UpdateDownloader.DownloadResult = null

	func run(downloader: UpdateDownloader, url: String, max_bytes: int) -> void:
		result = await downloader.download(url, max_bytes)
		ends += 1
		done = true


func test_default_downloader_of_the_runtime() -> void:
	if not await _init_modules():
		fail_test("setup failed")
		return
	assert_true(GameUpdateCore.init())
	var is_web: bool = OS.get_name() == "Web"
	assert_eq(GameUpdateCore._downloader is _WEB_DOWNLOADER, is_web, "the fetch downloader in the browser runtime")
	assert_eq(GameUpdateCore._downloader is _HTTP_DOWNLOADER, not is_web,
			"the HTTPRequest downloader outside the browser runtime")


func test_redirect_and_size_limit_over_real_http() -> void:
	UnitTestCore.require_platform(PackedStringArray(["web"]))
	if not await start():
		fail_test("setup failed")
		return
	var base: String = await UnitTestCore.start_http_server()
	assert_false(base.is_empty())
	if base.is_empty():
		return
	var none: Array[PackedStringArray] = []
	var big: PackedByteArray = PackedByteArray()
	big.resize(_MAX_BYTES + 1)
	var fits: PackedByteArray = "in the limit".to_utf8_buffer()
	assert_true(await UnitTestCore.add_http_response(base, "/moved", 302,
			[PackedStringArray(["Location", base + "/elsewhere"])], PackedByteArray()))
	assert_true(await UnitTestCore.add_http_response(base, "/elsewhere", 200, none, fits))
	assert_true(await UnitTestCore.add_http_response(base, "/big", 200, none, big))
	assert_true(await UnitTestCore.add_http_response(base, "/fits", 200, none, fits))
	var downloader: UpdateDownloader = default_downloader()
	var moved: UpdateDownloader.DownloadResult = await downloader.download(base + "/moved", _MAX_BYTES)
	assert_eq(moved.status, GameUpdateCore.DownloadStatus.DONE, "a redirect is a response")
	assert_ne(moved.http_status, 200, "a redirect is not a 200 response")
	assert_true(moved.body.is_empty())
	var large: UpdateDownloader.DownloadResult = await downloader.download(base + "/big", _MAX_BYTES)
	assert_eq(large.status, GameUpdateCore.DownloadStatus.TOO_LARGE, "over the max bytes")
	assert_true(large.body.is_empty())
	var small: UpdateDownloader.DownloadResult = await downloader.download(base + "/fits", _MAX_BYTES)
	assert_eq(small.status, GameUpdateCore.DownloadStatus.DONE, "a response in the limit")
	assert_eq(small.http_status, 200)
	assert_eq(small.body, fits)
	assert_eq(downloader.received_bytes(), 0, "no running download")
	var paths: PackedStringArray = PackedStringArray()
	for request: UnitTestHttpRequest in await UnitTestCore.http_requests(base):
		paths.append(request.path)
		assert_true(request.headers.filter(_is_added_header).is_empty(), "no added request header")
	assert_true(paths.has("/moved"))
	assert_false(paths.has("/elsewhere"), "the redirect is not followed")


func test_cancel_ends_the_download_once() -> void:
	UnitTestCore.require_platform(PackedStringArray(["web"]))
	if not await start():
		fail_test("setup failed")
		return
	var base: String = await UnitTestCore.start_http_server()
	assert_false(base.is_empty())
	var none: Array[PackedStringArray] = []
	assert_true(await UnitTestCore.add_http_response(base, "/file", 200, none, "file".to_utf8_buffer()))
	var downloader: UpdateDownloader = default_downloader()
	var running: Running = Running.new()
	running.run(downloader, base + "/file", _MAX_BYTES)
	assert_false(running.done, "the fetch has not answered in this frame")
	downloader.cancel()
	assert_true(running.done)
	assert_eq(running.result.status, GameUpdateCore.DownloadStatus.CANCELLED)
	await UnitTestCore.wait_frames(PUMP_FRAMES)
	assert_eq(running.ends, 1, "the aborted fetch does not end the download again")
	assert_eq(_page_eval("String(Object.keys(%s.sends).length)" % _PAGE_STATE), "0", "the page forgot the download")


func test_stall_timeout_over_the_fetch_downloader() -> void:
	UnitTestCore.require_platform(PackedStringArray(["web"]))
	if not await start(_STALL_MS):
		fail_test("setup failed")
		return
	var base: String = await UnitTestCore.start_http_server()
	assert_false(base.is_empty())
	var none: Array[PackedStringArray] = []
	assert_true(await UnitTestCore.add_http_response(base, "/deploy_list.json", 200, none, make_list().to_bytes()))
	var web: _WEB_DOWNLOADER = _WEB_DOWNLOADER.new(GameUpdateCore._node)
	GameUpdateCore._downloader = web
	var source: UpdateSource = make_source()
	source.game_update_url = base + "/deploy_list.json"
	start_check(source)
	var id: String = web._id
	assert_true(id.is_valid_int(), "the deploy list fetch started")
	if not id.is_valid_int():
		return
	# The fetch cannot answer before this frame ends: its page entry becomes one that waits until the test says,
	# keeping the fetch's abort controller.
	assert_eq(_page_eval("(function(){var s=%s;s.sends[%s]={c:s.sends[%s].c,r:\"\",n:0};return \"1\";})()"
			% [_PAGE_STATE, id, id]), "1")
	UnitTestCore.advance_clock(_STALL_MS - 1, false)
	await UnitTestCore.wait_frames(2)
	assert_eq(web._id, id, "not failed at stall timeout - 1")
	assert_eq(_page_eval("(function(){%s.sends[%s].n=1;return \"1\";})()" % [_PAGE_STATE, id]), "1")
	await UnitTestCore.wait_frames(2)
	assert_eq(web.received_bytes(), 1, "the received bytes of the page fetch")
	UnitTestCore.advance_clock(_STALL_MS - 1, false)
	await UnitTestCore.wait_frames(2)
	assert_eq(web._id, id, "the stall timeout counts from the last growth")
	UnitTestCore.advance_clock(1, false)
	await UnitTestCore.wait_frames(2)
	assert_eq(web._id, "", "failed at stall timeout")
	assert_eq(_page_eval("String(%s.sends[%s]===undefined)" % [_PAGE_STATE, id]), "true", "the fetch is aborted")
	await expect_fetch_failure(ReservedString.game_update_download_failed())


## Request headers a `GET` without added headers does not send: a CORS preflight in a cross-origin page.
static func _is_added_header(header: PackedStringArray) -> bool:
	var name: String = header[0].to_lower()
	return name.begins_with("x-") or name == "authorization" or name == "content-type"


static func _page_eval(code: String) -> String:
	return _WEB_DOWNLOADER._eval(code)
