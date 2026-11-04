extends "res://core/game_update_core/tests/support/game_update_test_case.gd"
## The default downloader of this runtime against the loopback HTTP server.

const _WATCHED = preload("res://core/game_update_core/tests/support/watched_downloader.gd")


func test_redirect_is_not_followed() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var base: String = await UnitTestCore.start_http_server()
	assert_false(base.is_empty())
	var list: _BUILDER = make_list()
	var redirect: Array[PackedStringArray] = [PackedStringArray(["Location", base + "/moved.json"])]
	var none: Array[PackedStringArray] = []
	assert_true(await UnitTestCore.add_http_response(base, "/deploy_list.json", 302, redirect, PackedByteArray()))
	assert_true(await UnitTestCore.add_http_response(base, "/moved.json", 200, none, list.to_bytes()))
	var http: _WATCHED = _WATCHED.new(default_downloader())
	GameUpdateCore._downloader = http
	var source: UpdateSource = make_source()
	source.game_update_url = base + "/deploy_list.json"
	start_check(source)
	await http.finished
	await expect_fetch_failure(ReservedString.game_update_download_failed())
	assert_eq(await _request_count(base), 1, "no second request")


func test_error_response_over_max_bytes_is_download_failed() -> void:
	var list: _BUILDER = make_list()
	var bytes: PackedByteArray = list.to_bytes()
	var signature_size: int = signature_bytes(bytes, list.sequence).size()
	if not UnitTestCore.set_test_settings("GameUpdateCore.signatureMaxBytes", signature_size):
		fail_test("setup failed")
		return
	if not await start():
		fail_test("setup failed")
		return
	var base: String = await UnitTestCore.start_http_server()
	assert_false(base.is_empty())
	var none: Array[PackedStringArray] = []
	var error_page: PackedByteArray = ("<html>" + "x".repeat(signature_size) + "</html>").to_utf8_buffer()
	assert_true(await UnitTestCore.add_http_response(base, "/deploy_list.json", 200, none, bytes))
	assert_true(await UnitTestCore.add_http_response(base, "/deploy_list.json.sig", 503, none, error_page))
	var http: _WATCHED = _WATCHED.new(default_downloader())
	GameUpdateCore._downloader = http
	var source: UpdateSource = make_source()
	source.game_update_url = base + "/deploy_list.json"
	start_check(source)
	await http.finished
	await http.finished
	await expect_fetch_failure(ReservedString.game_update_download_failed())


# ogw:input_boundary
func _request_count(base: String) -> int:
	var requests: Variant = await UnitTestCore.http_requests(base)
	if not requests is Array:
		return -1
	var list: Array = requests
	return list.size()
