extends UnitTestCase
## Sample test file of the nested runs: the first test leaves LogCore initialized, a WebSocket relay, and a relay number
## the test host does not have, whose delete fails. The second test checks that no test host request is open when it
## starts.


func test_a_leaves_relays() -> void:
	assert_true(LogCore.init(), "LogCore.init")
	var relay: UnitTestWsRelay = await UnitTestCore.open_ws_relay()
	assert_false(relay.url.is_empty(), "a relay")
	UnitTestCore._run.test.relays.append(UnitTestCore._run.config.test_host + "/ws-servers/999999")


func test_b_starts_after_the_deletes() -> void:
	assert_true(UnitTestCore._node._replies.is_empty(), "no test host request is open")
