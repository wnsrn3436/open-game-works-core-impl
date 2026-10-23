extends UnitTestCase
## Loopback HTTP servers on the test host.


## One GET to `url` with the engine HTTP client: its HTTP status and body text, or `0` and an empty body.
# ogw:input_boundary
func _fetch(url: String) -> PackedStringArray:
	var http: HTTPRequest = HTTPRequest.new()
	add_child(http)
	var status: int = 0
	var text: String = ""
	if http.request(url) == OK:
		var args: Array = await http.request_completed
		if args.size() >= 4 and args[0] is int and args[0] == HTTPRequest.RESULT_SUCCESS and args[1] is int and args[3] is PackedByteArray:
			status = args[1]
			var body: PackedByteArray = args[3]
			text = body.get_string_from_utf8()
	remove_child(http)
	http.queue_free()
	return PackedStringArray([str(status), text])


func test_two_servers_have_their_own_base_url_responses_and_requests() -> void:
	var first: String = await UnitTestCore.start_http_server()
	var second: String = await UnitTestCore.start_http_server()
	assert_false(first.is_empty() or second.is_empty(), "two base URLs")
	assert_ne(first, second)
	var none: Array[PackedStringArray] = []
	assert_true(await UnitTestCore.add_http_response(first, "/a.txt", 200, none, "first a".to_utf8_buffer()))
	assert_true(await UnitTestCore.add_http_response(second, "/a.txt", 201, [PackedStringArray(["X-Test", "1"])], "second a".to_utf8_buffer()))
	assert_eq(await _fetch(first + "/a.txt"), PackedStringArray(["200", "first a"]))
	assert_eq(await _fetch(second + "/a.txt"), PackedStringArray(["201", "second a"]))
	assert_eq(await _fetch(first + "/not_registered.txt"), PackedStringArray(["404", ""]), "a path without a response")
	var first_paths: PackedStringArray = PackedStringArray()
	for request: UnitTestHttpRequest in await UnitTestCore.http_requests(first):
		first_paths.append(request.path)
	assert_eq(first_paths, PackedStringArray(["/a.txt", "/not_registered.txt"]))
	var second_requests: Array[UnitTestHttpRequest] = await UnitTestCore.http_requests(second)
	assert_eq(second_requests.size(), 1)
	if second_requests.size() == 1:
		assert_eq(second_requests[0].path, "/a.txt")


func test_server_of_an_ended_test_answers_404() -> void:
	var base_url: String = await UnitTestCore.start_http_server()
	assert_false(base_url.is_empty(), "a base URL")
	var none: Array[PackedStringArray] = []
	assert_true(await UnitTestCore.add_http_response(base_url, "/kept.txt", 200, none, "kept".to_utf8_buffer()))
	await UnitTestCore._delete_test_servers()
	assert_eq(await _fetch(base_url + "/kept.txt"), PackedStringArray(["404", ""]))
