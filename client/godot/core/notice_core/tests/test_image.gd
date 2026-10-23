extends "res://core/notice_core/tests/support/notice_test_case.gd"
## `load_image`: accepted URLs, the default image downloader against the loopback HTTP server and the time limit.

const _HTTP_DOWNLOADER = preload("res://core/notice_core/http_image_downloader.gd")
const _WEB_DOWNLOADER = preload("res://core/notice_core/web_image_downloader.gd")


static func png_bytes() -> PackedByteArray:
	var image: Image = Image.create_empty(2, 2, false, Image.FORMAT_RGBA8)
	image.fill(Color.RED)
	return image.save_png_to_buffer()


static func jpeg_bytes() -> PackedByteArray:
	var image: Image = Image.create_empty(2, 2, false, Image.FORMAT_RGB8)
	image.fill(Color.BLUE)
	return image.save_jpg_to_buffer()


static func image_notice(id: int, url: String) -> CoreContract.Notice:
	var notice: CoreContract.Notice = active_notice(id, BANNER)
	notice.image_url = url
	return notice


func test_load_image_with_the_default_downloader() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var base: String = await UnitTestCore.start_http_server()
	assert_false(base.is_empty())
	if base.is_empty():
		return
	var no_headers: Array[PackedStringArray] = []
	var big: PackedByteArray = PackedByteArray()
	big.resize(IMAGE_MAX_BYTES + 1)
	assert_true(await UnitTestCore.add_http_response(base, "/big.png", 200, no_headers, big))
	assert_true(await UnitTestCore.add_http_response(base, "/missing.png", 404, no_headers, png_bytes()))
	assert_true(await UnitTestCore.add_http_response(base, "/a.png", 200, no_headers, png_bytes()))
	assert_true(await fetch_with([image_notice(1, "http://example.com/a.png"), image_notice(2, base + "/big.png"),
			image_notice(3, base + "/missing.png"), image_notice(4, base + "/a.png"), image_notice(5, "")]))
	assert_null(await NoticeCore.load_image(1), "http URL of another host")
	assert_eq(errors(), 1)
	assert_null(await NoticeCore.load_image(2), "larger than imageMaxBytes")
	assert_eq(errors(), 1)
	assert_null(await NoticeCore.load_image(3), "404")
	assert_eq(errors(), 1)
	assert_null(await NoticeCore.load_image(5), "empty image_url")
	assert_eq(errors(), 1)
	var texture: ImageTexture = await NoticeCore.load_image(4)
	assert_not_null(texture, "PNG response")
	if texture != null:
		assert_eq(texture.get_width(), 2)
		assert_eq(texture.get_height(), 2)
	assert_eq(await NoticeCore.load_image(4), texture, "the image stays in memory")
	var asked: int = 0
	for request: UnitTestHttpRequest in await UnitTestCore.http_requests(base):
		if request.path == "/a.png":
			asked += 1
	assert_eq(asked, 1)
	assert_null(await NoticeCore.load_image(9), "notice out of the cache")
	assert_eq(warns(), 1)


func test_redirect_and_size_limit_over_real_http() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var downloader: ImageDownloader = NoticeCore._downloader
	var is_web: bool = OS.get_name() == "Web"
	assert_eq(downloader is _WEB_DOWNLOADER, is_web, "the fetch downloader in the browser runtime")
	assert_eq(downloader is _HTTP_DOWNLOADER, not is_web, "the HTTPRequest downloader outside the browser runtime")
	var base: String = await UnitTestCore.start_http_server()
	assert_false(base.is_empty())
	if base.is_empty():
		return
	var no_headers: Array[PackedStringArray] = []
	var big: PackedByteArray = PackedByteArray()
	big.resize(IMAGE_MAX_BYTES + 1)
	assert_true(await UnitTestCore.add_http_response(base, "/moved.png", 302,
			[PackedStringArray(["Location", base + "/elsewhere.png"])], PackedByteArray()))
	assert_true(await UnitTestCore.add_http_response(base, "/elsewhere.png", 200, no_headers, png_bytes()))
	assert_true(await UnitTestCore.add_http_response(base, "/big.png", 200, no_headers, big))
	assert_true(await UnitTestCore.add_http_response(base, "/a.png", 200, no_headers, png_bytes()))
	var moved: ImageDownloader.DownloadResult = await downloader.download(base + "/moved.png", IMAGE_MAX_BYTES)
	assert_eq(moved.status, NoticeCore.DownloadStatus.CONNECTION_FAILED, "a redirect")
	assert_true(moved.body.is_empty())
	var large: ImageDownloader.DownloadResult = await downloader.download(base + "/big.png", IMAGE_MAX_BYTES)
	assert_eq(large.status, NoticeCore.DownloadStatus.TOO_LARGE, "over the max bytes")
	assert_true(large.body.is_empty())
	var fits: ImageDownloader.DownloadResult = await downloader.download(base + "/a.png", IMAGE_MAX_BYTES)
	assert_eq(fits.status, NoticeCore.DownloadStatus.DONE, "a response in the limit")
	assert_eq(fits.http_status, 200)
	assert_eq(fits.body, png_bytes())
	var paths: PackedStringArray = PackedStringArray()
	for request: UnitTestHttpRequest in await UnitTestCore.http_requests(base):
		paths.append(request.path)
	assert_true(paths.has("/moved.png"))
	assert_false(paths.has("/elsewhere.png"), "the redirect is not followed")
	# `load_image` fails the redirect with an error log.
	assert_true(await fetch_with([image_notice(1, base + "/moved.png")]))
	assert_null(await NoticeCore.load_image(1), "a redirect")
	assert_eq(errors(), 1)


func test_load_image_time_limit_cancels_once() -> void:
	var downloader: _HANGING = _HANGING.new()
	if not await start(downloader):
		fail_test("setup failed")
		return
	assert_true(await fetch_with([image_notice(1, "https://images.example.com/a.png")]))
	var loading: Running = start_load(1)
	await pump()
	assert_true(downloader.is_waiting())
	await advance(IMAGE_TIMEOUT_MS - 1)
	assert_false(loading.done, "imageTimeoutMs - 1")
	assert_eq(downloader.cancel_count, 0)
	await advance(1)
	assert_true(loading.done, "imageTimeoutMs")
	assert_null(loading.texture)
	assert_eq(downloader.cancel_count, 1)
	assert_eq(errors(), 1)
	await advance(IMAGE_TIMEOUT_MS)
	assert_eq(downloader.cancel_count, 1, "cancel once")
	downloader.finish()
	await pump()



func test_jpeg_decodes_and_a_body_that_is_not_an_image_fails() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var base: String = await UnitTestCore.start_http_server()
	assert_false(base.is_empty())
	if base.is_empty():
		return
	var no_headers: Array[PackedStringArray] = []
	var jpeg: PackedByteArray = jpeg_bytes()
	assert_true(jpeg.size() <= IMAGE_MAX_BYTES, "the JPEG fits imageMaxBytes")
	assert_true(await UnitTestCore.add_http_response(base, "/a.jpg", 200, no_headers, jpeg))
	assert_true(await UnitTestCore.add_http_response(base, "/text.png", 200, no_headers,
			"not an image".to_utf8_buffer()))
	assert_true(await fetch_with([image_notice(1, base + "/a.jpg"), image_notice(2, base + "/text.png")]))
	var texture: ImageTexture = await NoticeCore.load_image(1)
	assert_not_null(texture, "JPEG response")
	if texture != null:
		assert_eq(texture.get_width(), 2)
		assert_eq(texture.get_height(), 2)
	assert_eq(errors(), 0)
	assert_null(await NoticeCore.load_image(2), "a 200 body that is not an image")
	assert_eq(errors(), 1)


func test_image_is_dropped_when_its_url_changes_or_its_notice_leaves() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var base: String = await UnitTestCore.start_http_server()
	assert_false(base.is_empty())
	if base.is_empty():
		return
	var no_headers: Array[PackedStringArray] = []
	assert_true(await UnitTestCore.add_http_response(base, "/a.png", 200, no_headers, png_bytes()))
	assert_true(await UnitTestCore.add_http_response(base, "/b.png", 200, no_headers, png_bytes()))
	var url_a: String = base + "/a.png"
	var url_b: String = base + "/b.png"
	assert_true(await fetch_with([image_notice(1, url_a)]))
	var first: ImageTexture = await NoticeCore.load_image(1)
	assert_not_null(first)
	assert_eq(await _asked(base, "/a.png"), 1)
	# Another image_url, then back to the first one without a load between: the first image was dropped.
	assert_true(await fetch_with([image_notice(1, url_b)]))
	assert_true(await fetch_with([image_notice(1, url_a)]))
	assert_not_null(await NoticeCore.load_image(1))
	assert_eq(await _asked(base, "/a.png"), 2, "the image of the old image_url was dropped")
	assert_true(await fetch_with([image_notice(1, url_b)]))
	var changed: ImageTexture = await NoticeCore.load_image(1)
	assert_not_null(changed, "the new image_url")
	assert_ne(changed, first, "not the image of the old image_url")
	assert_eq(await _asked(base, "/b.png"), 1, "the new image_url is downloaded")
	# The notice leaves the cache, then comes back with the same image_url.
	assert_true(await fetch_with([]))
	assert_null(await NoticeCore.load_image(1), "notice out of the cache")
	assert_eq(warns(), 1)
	assert_true(await fetch_with([image_notice(1, url_b)]))
	assert_not_null(await NoticeCore.load_image(1))
	assert_eq(await _asked(base, "/b.png"), 2, "the image of a notice that left the cache was dropped")
	assert_eq(errors(), 0)


func test_loopback_http_url_with_user_info_is_refused() -> void:
	var downloader: _HANGING = _HANGING.new()
	if not await start(downloader):
		fail_test("setup failed")
		return
	var refused: PackedStringArray = PackedStringArray([
		"http://127.0.0.1:80@example.com/a.png",
		"http://127.0.0.1@example.com/a.png",
		"http://127.0.0.1.example.com/a.png",
		"http://127.0.0.1:/a.png",
		"http://127.0.0.1:8a/a.png",
		"http://127.0.0.1?@example.com/a.png",
		"http://127.0.0.1:8080?@example.com/a.png",
	])
	var notices: Array[CoreContract.Notice] = []
	for i: int in refused.size():
		notices.append(image_notice(i + 1, refused[i]))
	notices.append(image_notice(9, "http://127.0.0.1:8080/a.png"))
	assert_true(await fetch_with(notices))
	for i: int in refused.size():
		assert_null(await NoticeCore.load_image(i + 1), refused[i])
		assert_eq(errors(), 1, refused[i])
	assert_eq(downloader.urls.size(), 0, "no download of a refused URL")
	var loading: Running = start_load(9)
	await pump()
	assert_eq(downloader.urls, PackedStringArray(["http://127.0.0.1:8080/a.png"]), "a loopback URL with a port")
	downloader.finish()
	await pump()
	assert_true(loading.done)
	assert_null(loading.texture)
	assert_eq(errors(), 1, "the cancelled download")


## Number of requests the loopback HTTP server at `base` got for `path`.
func _asked(base: String, path: String) -> int:
	var count: int = 0
	for request: UnitTestHttpRequest in await UnitTestCore.http_requests(base):
		if request.path == path:
			count += 1
	return count
