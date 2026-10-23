extends UnitTestCase
## Sample test file of the nested runs: the first test leaves LogCore initialized, a loopback HTTP server, and a server
## number the test host does not have, whose delete fails. The second test checks that no test host request is open
## when it starts.


func test_a_leaves_servers() -> void:
	assert_true(LogCore.init(), "LogCore.init")
	var base_url: String = await UnitTestCore.start_http_server()
	assert_false(base_url.is_empty(), "a base URL")
	UnitTestCore._run.test.servers.append(UnitTestCore._run.config.test_host + "/servers/999999/files")


func test_b_starts_after_the_deletes() -> void:
	assert_true(UnitTestCore._node._replies.is_empty(), "no test host request is open")
