extends RealtimeTestCase
## The P2P transport against a test matchmaker on a WebSocket relay of the test host and a test WebRTC participant. The
## same tests run in the native run and the browser run: in the browser run the transport's `WebSocketPeer` is the
## browser's `WebSocket`, and the transport and the participant use browser WebRTC.

const _SIGNAL := preload("res://core/realtime_core/p2p_signal.gd")
const _PEER := preload("res://core/realtime_core/p2p_peer.gd")
const PEER_SIGNAL: CoreContract.MatchmakerFrameKind = CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_PEER_SIGNAL
## Kind of the frame `_sync_sent` puts on the transport's matchmaker connection.
const _MARKER: CoreContract.MatchmakerFrameKind = CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_UNSPECIFIED
const HOST_CANDIDATE: String = "candidate:1 1 UDP 2122317823 127.0.0.1 50000 typ host"

var server: RealtimeFakeMatchmaker = null
var driver: RealtimeTransportDriver = null
var p2p: P2pRealtimeTransport = null


func test_matchmaker_frames_become_notifications_and_hello_comes_first() -> void:
	if not await _start_p2p(false):
		return
	p2p.start_matching(MODE_ID, ACCESS_TOKEN, false)
	await server.wait_count(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_REQUEST, 1)
	var hello: CoreContract.MatchmakerFrame = server.received[0]
	assert_eq(hello.kind, CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_HELLO)
	assert_eq(hello.access_token, ACCESS_TOKEN)
	assert_eq(hello.data_version, DataCore.get_data_version())
	assert_eq(hello.client_version, APP_VERSION)
	assert_eq(server.received[1].mode_id, MODE_ID)
	var failed: CoreContract.MatchmakerFrame = server.new_frame(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_FAILED)
	failed.reason = CoreContract.MatchFailReason.MATCH_FAIL_REASON_REJECTED
	failed.error_code = 77
	server.send(failed)
	await driver.wait_count(RealtimeNotice.Kind.MATCH_FAILED, 1)
	var at: int = driver.last(RealtimeNotice.Kind.MATCH_FAILED)
	assert_eq(driver.fail_reasons[at], CoreContract.MatchFailReason.MATCH_FAIL_REASON_REJECTED)
	assert_eq(driver.error_codes[at], 77)
	server.send(server.match_found(PackedInt64Array([USER_ID, OTHER_ID]), 0, false))
	await driver.wait_count(RealtimeNotice.Kind.MATCH_FOUND, 1)
	var info: MatchInfo = driver.match_infos[driver.last(RealtimeNotice.Kind.MATCH_FOUND)]
	assert_eq(info.match_id, "match-p2p")
	assert_eq(info.my_index, 0)
	assert_eq(info.user_ids, PackedInt64Array([USER_ID, OTHER_ID]))
	assert_eq(info.match_seed, 99)
	var rejoined: CoreContract.MatchmakerFrame = server.new_frame(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_REJOINED)
	rejoined.match_id = "match-p2p"
	rejoined.ok = true
	rejoined.left_indices = PackedInt32Array([1])
	rejoined.players = server.match_found(PackedInt64Array([USER_ID, OTHER_ID]), 0, false).players
	server.send(rejoined)
	await driver.wait_count(RealtimeNotice.Kind.REJOINED, 1)
	at = driver.last(RealtimeNotice.Kind.REJOINED)
	assert_true(driver.oks[at])
	assert_eq(driver.left_lists[at], PackedInt32Array([1]))
	server.send_close(CoreContract.CoreError.CORE_ERROR_MAINTENANCE)
	await driver.wait_count(RealtimeNotice.Kind.MATCHMAKER_LOST, 1)
	assert_eq(driver.error_codes[driver.last(RealtimeNotice.Kind.MATCHMAKER_LOST)], CoreContract.CoreError.CORE_ERROR_MAINTENANCE)
	p2p.start_matching(MODE_ID, ACCESS_TOKEN, false)
	await server.wait_count(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_REQUEST, 2)
	server.drop()
	await driver.wait_count(RealtimeNotice.Kind.MATCHMAKER_LOST, 2)
	assert_eq(driver.error_codes[driver.last(RealtimeNotice.Kind.MATCHMAKER_LOST)], 0)


## The server sends `CLOSE` and closes at once, so a native `WebSocketPeer` may end the close handshake in the `poll`
## that would hand out `CLOSE` and drop it; the close code 4000 carries the code.
func test_a_close_with_4000_right_after_close_is_a_matchmaker_lost_of_that_code() -> void:
	if not await _start_p2p(false):
		return
	p2p.start_matching(MODE_ID, ACCESS_TOKEN, false)
	await server.wait_count(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_REQUEST, 1)
	server.send_close(CoreContract.CoreError.CORE_ERROR_BANNED)
	await driver.wait_count(RealtimeNotice.Kind.MATCHMAKER_LOST, 1)
	assert_eq(driver.error_codes[driver.last(RealtimeNotice.Kind.MATCHMAKER_LOST)], CoreContract.CoreError.CORE_ERROR_BANNED)
	p2p.start_matching(MODE_ID, ACCESS_TOKEN, false)
	await server.wait_count(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_REQUEST, 2)
	server.close_connection(4000, str(CoreContract.CoreError.CORE_ERROR_MAINTENANCE))
	await driver.wait_count(RealtimeNotice.Kind.MATCHMAKER_LOST, 2)
	assert_eq(driver.error_codes[driver.last(RealtimeNotice.Kind.MATCHMAKER_LOST)], CoreContract.CoreError.CORE_ERROR_MAINTENANCE,
			"close code 4000 without CLOSE takes the code of its reason")
	p2p.start_matching(MODE_ID, ACCESS_TOKEN, false)
	await server.wait_count(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_REQUEST, 3)
	server.close_connection(4000, "maintenance")
	await driver.wait_count(RealtimeNotice.Kind.MATCHMAKER_LOST, 3)
	assert_eq(driver.error_codes[driver.last(RealtimeNotice.Kind.MATCHMAKER_LOST)], 0, "a reason that is no integer is 0")
	p2p.start_matching(MODE_ID, ACCESS_TOKEN, false)
	await server.wait_count(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_REQUEST, 4)
	server.close_connection(4001, str(CoreContract.CoreError.CORE_ERROR_MAINTENANCE))
	await driver.wait_count(RealtimeNotice.Kind.MATCHMAKER_LOST, 4)
	assert_eq(driver.error_codes[driver.last(RealtimeNotice.Kind.MATCHMAKER_LOST)], 0, "another close code is 0")


func test_only_the_smaller_index_sends_the_offer() -> void:
	if not await _start_p2p(false):
		return
	await _found(PackedInt64Array([USER_ID, OTHER_ID]), 0)
	p2p.connect_peer(1)
	await server.wait_count(PEER_SIGNAL, 1)
	assert_eq(_signals_of(_SIGNAL.Type.OFFER), 1)
	# The candidates of the closed connection reach the matchmaker before the count.
	await _sync_sent()
	p2p.close()
	await _found(PackedInt64Array([OTHER_ID, USER_ID]), 1)
	var before: int = server.count(PEER_SIGNAL)
	p2p.connect_peer(0)
	await frames(20)
	assert_eq(server.count(PEER_SIGNAL), before)


func test_signals_before_connect_peer_are_kept_and_used_in_order() -> void:
	if not await _start_p2p(false):
		return
	var remote: RealtimeRemotePeer = _remote(0)
	remote.hold = true
	assert_true(remote.start(true))
	# The WebRTC library makes the offer: the held signal ends the wait, not a frame count.
	while remote.held.is_empty() and _running():
		await frames(1)
	assert_true(remote.held.size() >= 1)
	var held: int = remote.held.size()
	p2p.start_matching(MODE_ID, ACCESS_TOKEN, false)
	await server.wait_count(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_REQUEST, 1)
	# The `MATCH_FOUND` and the held signals reach the client before its next `poll`.
	driver.paused = true
	server.send(server.match_found(PackedInt64Array([OTHER_ID, USER_ID]), 1, false))
	remote.release_held()
	await _wait_arrived(1 + held)
	driver.paused = false
	await driver.wait_count(RealtimeNotice.Kind.MATCH_FOUND, 1)
	assert_true(p2p._queued.size() >= held)
	assert_null(p2p._peers[0])
	p2p.connect_peer(0)
	assert_eq(p2p._queued.size(), 0)
	await driver.wait_count(RealtimeNotice.Kind.PEER_CONNECTED, 1)
	assert_eq(driver.count_for(RealtimeNotice.Kind.PEER_CONNECTED, 0), 1)


func test_close_peer_and_close_drop_kept_signals_and_a_closed_index_stays_closed() -> void:
	if not await _start_p2p(false):
		return
	await _found(PackedInt64Array([USER_ID, OTHER_ID, THIRD_ID]), 0)
	await _deliver([server.peer_signal(1, _offer_payload()), server.peer_signal(2, _offer_payload())])
	assert_eq(p2p._queued.size(), 2)
	p2p.close_peer(1)
	assert_eq(p2p._queued.size(), 1)
	var rejoined: CoreContract.MatchmakerFrame = server.new_frame(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_PEER_REJOINED)
	rejoined.index = 1
	await _deliver([rejoined, server.peer_signal(1, _offer_payload())])
	assert_null(p2p._peers[1])
	assert_eq(p2p._queued.size(), 1)
	assert_eq(driver.count_for(RealtimeNotice.Kind.PEER_CONNECTED, 1), 0)
	assert_eq(driver.count_for(RealtimeNotice.Kind.PEER_LOST, 1), 0)
	p2p.close()
	assert_eq(p2p._queued.size(), 0)


func test_candidate_signals_carry_data_mid_and_index_and_malformed_ones_are_dropped() -> void:
	if not await _start_p2p(false):
		return
	var remote: RealtimeRemotePeer = _remote(1)
	assert_true(remote.start(false))
	await _found(PackedInt64Array([USER_ID, OTHER_ID]), 0)
	p2p.connect_peer(1)
	await driver.wait_count(RealtimeNotice.Kind.PEER_CONNECTED, 1)
	var candidates: int = 0
	for frame: CoreContract.MatchmakerFrame in server.frames_of(PEER_SIGNAL):
		var sent: _SIGNAL = _SIGNAL.new()
		assert_true(sent.read(frame.payload))
		assert_eq(sent.attempt, 1)
		if sent.type == _SIGNAL.Type.CANDIDATE:
			candidates += 1
			assert_false(sent.data.is_empty())
			var text: String = frame.payload.get_string_from_utf8()
			assert_string_contains(text, "\"mid\"")
			assert_string_contains(text, "\"index\"")
	assert_true(candidates > 0)
	var peer: _PEER = p2p._peers[1]
	# The connection can open on the participant's connectivity checks before its candidate reaches the client: the
	# candidate put into the connection ends the wait, not a frame count.
	while peer.added_candidates == 0 and _running():
		await frames(1)
	assert_true(peer.added_candidates > 0)
	var connected: int = driver.count(RealtimeNotice.Kind.PEER_CONNECTED)
	var malformed: PackedStringArray = [
		'{"type":"candidate","attempt":1,"data":"%s","index":0}' % HOST_CANDIDATE,
		'{"type":"candidate","attempt":1,"data":"%s","mid":"0"}' % HOST_CANDIDATE,
		'{"type":"candidate","attempt":1,"data":"%s","mid":"0","index":-1}' % HOST_CANDIDATE,
	]
	for payload: String in malformed:
		await _deliver([server.peer_signal(1, payload.to_utf8_buffer())])
		assert_eq(warn_logs(), 1)
	assert_eq(driver.count(RealtimeNotice.Kind.PEER_CONNECTED), connected)
	assert_eq(driver.count(RealtimeNotice.Kind.PEER_LOST), 0)
	assert_eq(server.malformed_signals, 0)
	assert_eq(remote.other_attempt_signals, 0)


func test_an_attempt_or_index_that_is_not_an_integer_in_range_is_a_malformed_payload() -> void:
	if not await _start_p2p(false):
		return
	await _found(PackedInt64Array([OTHER_ID, USER_ID]), 1)
	var malformed: PackedStringArray = [
		'{"type":"offer","data":"v=0"}',
		'{"type":"offer","attempt":0,"data":"v=0"}',
		'{"type":"offer","attempt":-1,"data":"v=0"}',
		'{"type":"offer","attempt":1.5,"data":"v=0"}',
		'{"type":"offer","attempt":"1","data":"v=0"}',
		'{"type":"offer","attempt":null,"data":"v=0"}',
		'{"type":"offer","attempt":9007199254740992,"data":"v=0"}',
		'{"type":"offer","attempt":9223372036854775807,"data":"v=0"}',
		'{"type":"offer","attempt":1e19,"data":"v=0"}',
		'{"type":"candidate","attempt":0,"data":"%s","mid":"0","index":0}' % HOST_CANDIDATE,
		'{"type":"candidate","attempt":9007199254740992,"data":"%s","mid":"0","index":0}' % HOST_CANDIDATE,
		'{"type":"candidate","attempt":1,"data":"%s","mid":"0","index":9007199254740992}' % HOST_CANDIDATE,
		'{"type":"candidate","attempt":1,"data":"%s","mid":"0","index":9223372036854775807}' % HOST_CANDIDATE,
	]
	for payload: String in malformed:
		await _deliver([server.peer_signal(0, payload.to_utf8_buffer())])
		assert_eq(warn_logs(), 1, payload)
		assert_eq(p2p._queued.size(), 0, payload)
	var valid: PackedStringArray = [
		'{"type":"offer","attempt":1,"data":"v=0"}',
		'{"type":"offer","attempt":9007199254740991,"data":"v=0"}',
		'{"type":"candidate","attempt":9007199254740991,"data":"%s","mid":"0","index":9007199254740991}' % HOST_CANDIDATE,
	]
	for payload: String in valid:
		await _deliver([server.peer_signal(0, payload.to_utf8_buffer())])
		assert_eq(warn_logs(), 0, payload)
	assert_eq(p2p._queued.size(), 3)
	assert_eq(p2p._queued[0].received.attempt, 1)
	assert_eq(p2p._queued[1].received.attempt, 9007199254740991)
	assert_eq(p2p._queued[2].received.attempt, 9007199254740991)
	assert_eq(p2p._queued[2].received.index, 9007199254740991)
	assert_eq(p2p._queued[2].received.to_payload().get_string_from_utf8(), valid[2], "2^53 - 1 is written back exactly")


## The forced order: the participant's answer to offer 1 reaches the client after `PEER_REJOINED` restarted the offer.
func test_a_held_answer_of_an_earlier_attempt_after_the_restarted_offer_is_dropped_and_the_new_attempt_connects() -> void:
	if not await _start_p2p(false):
		return
	var remote: RealtimeRemotePeer = await _restart_holding_attempt_1()
	if remote == null:
		return
	var peer: _PEER = p2p._peers[1]
	assert_eq(peer.attempt, 2)
	var answer: _SIGNAL = _held(remote, 1, _SIGNAL.Type.ANSWER)
	await _deliver([server.peer_signal(1, answer.to_payload())])
	assert_eq(warn_logs(), 1)
	assert_eq(p2p._peers[1], peer)
	assert_false(peer.has_remote, "the answer of attempt 1 did not enter the connection of attempt 2")
	remote.drop_held(1)
	remote.release_held()
	await driver.wait_count(RealtimeNotice.Kind.PEER_CONNECTED, 1)
	assert_eq(driver.count_for(RealtimeNotice.Kind.PEER_CONNECTED, 1), 1)
	assert_eq(driver.count(RealtimeNotice.Kind.PEER_LOST), 0)
	assert_eq(p2p._peers[1], peer)
	assert_eq(server.malformed_signals, 0)
	assert_eq(remote.other_attempt_signals, 0)


func test_a_candidate_of_an_earlier_attempt_after_the_restarted_offer_is_dropped() -> void:
	if not await _start_p2p(false):
		return
	var remote: RealtimeRemotePeer = await _restart_holding_attempt_1()
	if remote == null:
		return
	var peer: _PEER = p2p._peers[1]
	var candidate: _SIGNAL = _held(remote, 1, _SIGNAL.Type.CANDIDATE)
	await _deliver([server.peer_signal(1, candidate.to_payload())])
	assert_eq(warn_logs(), 1)
	assert_eq(peer.waiting_candidates.size(), 0, "the candidate of attempt 1 does not wait for the answer of attempt 2")
	remote.drop_held(1)
	# The participant gathers all its candidates of attempt 2 while it holds them, and they reach the client in one
	# `poll`: none of them reaches the client with the candidate of attempt 1 below and enters the connection.
	await _wait_gathered(remote.connection)
	var held: Array[CoreContract.MatchmakerFrame] = []
	for payload: PackedByteArray in remote.held:
		held.append(server.peer_signal(1, payload))
	remote.held.clear()
	await _deliver(held)
	await driver.wait_count(RealtimeNotice.Kind.PEER_CONNECTED, 1)
	assert_eq(driver.count_for(RealtimeNotice.Kind.PEER_CONNECTED, 1), 1)
	var added: int = peer.added_candidates
	await _deliver([server.peer_signal(1, candidate.to_payload())])
	assert_eq(warn_logs(), 1)
	assert_eq(peer.added_candidates, added, "the candidate of attempt 1 did not enter the connection of attempt 2")
	assert_eq(driver.count(RealtimeNotice.Kind.PEER_LOST), 0)
	assert_eq(remote.other_attempt_signals, 0)


func test_the_answering_side_replaces_the_connection_for_a_larger_offer_and_drops_a_smaller_one() -> void:
	if not await _start_p2p(false):
		return
	var remote: RealtimeRemotePeer = _remote(0)
	remote.hold = true
	assert_true(remote.start(true))
	# The WebRTC library makes the offer: the held signal ends the wait, not a frame count.
	while _held(remote, 1, _SIGNAL.Type.OFFER) == null and _running():
		await frames(1)
	var first: _SIGNAL = _held(remote, 1, _SIGNAL.Type.OFFER)
	assert_not_null(first)
	assert_true(remote.start(true))
	while _held(remote, 2, _SIGNAL.Type.OFFER) == null and _running():
		await frames(1)
	remote.drop_held(1)
	await _found(PackedInt64Array([OTHER_ID, USER_ID]), 1)
	p2p.connect_peer(0)
	await _deliver([server.peer_signal(0, first.to_payload())])
	var peer: _PEER = p2p._peers[0]
	assert_eq(peer.attempt, 1)
	assert_true(peer.has_remote)
	# The WebRTC library makes the answer: the sent answer ends the wait, not a frame count.
	while _signals_of(_SIGNAL.Type.ANSWER) == 0 and _running():
		await frames(1)
	remote.release_held()
	await driver.wait_count(RealtimeNotice.Kind.PEER_CONNECTED, 1)
	assert_eq(driver.count_for(RealtimeNotice.Kind.PEER_CONNECTED, 0), 1)
	assert_ne(p2p._peers[0], peer, "the offer of attempt 2 replaced the connection")
	peer = p2p._peers[0]
	assert_eq(peer.attempt, 2)
	var answers: Array[int] = []
	for frame: CoreContract.MatchmakerFrame in server.frames_of(PEER_SIGNAL):
		var sent: _SIGNAL = _SIGNAL.new()
		if sent.read(frame.payload) and sent.type == _SIGNAL.Type.ANSWER:
			answers.append(sent.attempt)
	assert_eq(answers, [1, 2] as Array[int], "each answer carries the number of its offer")
	await _settle_signals(0)
	var signals: int = server.count(PEER_SIGNAL)
	await _deliver([server.peer_signal(0, first.to_payload())])
	assert_eq(warn_logs(), 1)
	await frames(10)
	assert_eq(p2p._peers[0], peer)
	assert_eq(server.count(PEER_SIGNAL), signals)
	assert_eq(driver.count(RealtimeNotice.Kind.PEER_CONNECTED), 1)
	assert_eq(driver.count(RealtimeNotice.Kind.PEER_LOST), 0)
	assert_eq(server.malformed_signals, 0)


func test_the_answering_side_drops_offers_up_to_its_number_and_takes_any_offer_after_peer_rejoined() -> void:
	if not await _start_p2p(false):
		return
	var remote: RealtimeRemotePeer = _remote(0)
	remote.hold = true
	assert_true(remote.start(true))
	# The WebRTC library makes the offer: the held signal ends the wait, not a frame count.
	while _held(remote, 1, _SIGNAL.Type.OFFER) == null and _running():
		await frames(1)
	var first: _SIGNAL = _held(remote, 1, _SIGNAL.Type.OFFER)
	assert_true(remote.start(true))
	while _held(remote, 2, _SIGNAL.Type.OFFER) == null and _running():
		await frames(1)
	var second: _SIGNAL = _held(remote, 2, _SIGNAL.Type.OFFER)
	assert_not_null(first)
	assert_not_null(second)
	remote.drop_held(1)
	await _found(PackedInt64Array([OTHER_ID, USER_ID]), 1)
	p2p.connect_peer(0)
	remote.release_held()
	await driver.wait_count(RealtimeNotice.Kind.PEER_CONNECTED, 1)
	var peer: _PEER = p2p._peers[0]
	assert_eq(peer.attempt, 2)
	await _settle_signals(0)
	var signals: int = server.count(PEER_SIGNAL)
	await _deliver([server.peer_signal(0, second.to_payload())])
	assert_eq(warn_logs(), 1, "the offer with the number of the connection is dropped")
	await _deliver([server.peer_signal(0, first.to_payload())])
	assert_eq(warn_logs(), 1, "the offer with a smaller number is dropped")
	await frames(10)
	assert_eq(p2p._peers[0], peer)
	assert_eq(peer.status, _PEER.Status.CONNECTED)
	assert_eq(server.count(PEER_SIGNAL), signals)
	# The participant restarts the app and rejoins: its offers count from 1 again. `PEER_REJOINED` and its offer reach
	# the client in one `poll`, before the client reads the closed earlier connection.
	driver.paused = true
	remote.restart()
	remote.hold = true
	assert_true(remote.start(true))
	while _held(remote, 1, _SIGNAL.Type.OFFER) == null and _running():
		await frames(1)
	var rejoined: CoreContract.MatchmakerFrame = server.new_frame(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_PEER_REJOINED)
	rejoined.index = 0
	server.send(rejoined)
	var restarted: _SIGNAL = _held(remote, 1, _SIGNAL.Type.OFFER)
	var held: int = remote.held.size()
	remote.release_held()
	await _wait_arrived(1 + held)
	driver.paused = false
	while _running() and driver.count(RealtimeNotice.Kind.PEER_LOST) == 0:
		var now: _PEER = p2p._peers[0]
		if now != null and now != peer and now.status == _PEER.Status.CONNECTED:
			break
		await frames(1)
	var replaced: _PEER = p2p._peers[0]
	assert_ne(replaced, peer, "the offer after PEER_REJOINED replaced the connection")
	assert_not_null(replaced)
	if replaced == null:
		return
	assert_eq(replaced.status, _PEER.Status.CONNECTED)
	assert_eq(replaced.attempt, 1)
	assert_eq(_answer_attempts(), [2, 1] as Array[int], "the answer carries the number of the offer it answers")
	assert_eq(warn_logs(), 0)
	assert_eq(driver.count_for(RealtimeNotice.Kind.PEER_LOST, 0), 0)
	assert_eq(driver.count_for(RealtimeNotice.Kind.PEER_CONNECTED, 0), 1, "the participant stayed connected")
	assert_true(p2p.send_packet(0, RealtimeCore.RealtimeChannel.RELIABLE, PackedByteArray([1])))
	assert_eq(server.malformed_signals, 0)
	# Only the first offer after `PEER_REJOINED` is taken whatever its number.
	await _settle_signals(0)
	signals = server.count(PEER_SIGNAL)
	await _deliver([server.peer_signal(0, restarted.to_payload())])
	assert_eq(warn_logs(), 1)
	await frames(10)
	assert_eq(p2p._peers[0], replaced)
	assert_eq(server.count(PEER_SIGNAL), signals)


func test_a_new_transport_that_rejoins_counts_its_offers_from_1_and_connects() -> void:
	if not await _start_p2p(false):
		return
	var remote: RealtimeRemotePeer = _remote(1)
	assert_true(remote.start(false))
	remote.drop_offers = 1
	await _found(PackedInt64Array([USER_ID, OTHER_ID]), 0)
	p2p.connect_peer(1)
	await _wait_offers(1)
	var peer_rejoined: CoreContract.MatchmakerFrame = server.new_frame(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_PEER_REJOINED)
	peer_rejoined.index = 1
	server.send(peer_rejoined)
	await driver.wait_count(RealtimeNotice.Kind.PEER_CONNECTED, 1)
	assert_eq(_offer_attempts(), [1, 2] as Array[int])
	assert_eq(remote.attempt, 2)
	# The app restarts: the earlier transport sends nothing more, and a new transport rejoins the match.
	p2p.disconnect_all()
	var before: int = server.frames_of(PEER_SIGNAL).size()
	p2p = P2pRealtimeTransport.new(server.base_url(), APP_VERSION, false)
	driver.transport = p2p
	p2p.rejoin("match-p2p", ACCESS_TOKEN)
	await server.wait_count(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_REJOIN, 1)
	var rejoined: CoreContract.MatchmakerFrame = server.new_frame(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_REJOINED)
	rejoined.match_id = "match-p2p"
	rejoined.ok = true
	rejoined.my_index = 0
	rejoined.players = server.match_found(PackedInt64Array([USER_ID, OTHER_ID]), 0, false).players
	# The participant gets `PEER_REJOINED` of the client from the server.
	remote.take_any_offer = true
	server.send(rejoined)
	await driver.wait_count(RealtimeNotice.Kind.REJOINED, 1)
	assert_true(driver.oks[driver.last(RealtimeNotice.Kind.REJOINED)])
	p2p.connect_peer(1)
	await driver.wait_count(RealtimeNotice.Kind.PEER_CONNECTED, 2)
	var offers: Array[int] = []
	var sent: Array[CoreContract.MatchmakerFrame] = server.frames_of(PEER_SIGNAL)
	for i: int in range(before, sent.size()):
		var item: _SIGNAL = _SIGNAL.new()
		if item.read(sent[i].payload) and item.type == _SIGNAL.Type.OFFER:
			offers.append(item.attempt)
	assert_eq(offers, [1] as Array[int], "the new transport counts its offers from 1")
	assert_eq(remote.attempt, 1)
	assert_eq(driver.count(RealtimeNotice.Kind.PEER_LOST), 0)
	assert_eq(server.malformed_signals, 0)


func test_peer_rejoined_before_the_answer_restarts_the_offer_without_peer_lost() -> void:
	if not await _start_p2p(false):
		return
	var remote: RealtimeRemotePeer = _remote(1)
	assert_true(remote.start(false))
	remote.drop_offers = 1
	await _found(PackedInt64Array([USER_ID, OTHER_ID]), 0)
	p2p.connect_peer(1)
	await _wait_offers(1)
	var rejoined: CoreContract.MatchmakerFrame = server.new_frame(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_PEER_REJOINED)
	rejoined.index = 1
	server.send(rejoined)
	await _wait_offers(2)
	await driver.wait_count(RealtimeNotice.Kind.PEER_CONNECTED, 1)
	assert_eq(_signals_of(_SIGNAL.Type.OFFER), 2)
	assert_eq(_offer_attempts(), [1, 2] as Array[int], "the offer of each new connection takes the next number")
	assert_eq(driver.count(RealtimeNotice.Kind.PEER_LOST), 0)
	assert_eq(server.malformed_signals, 0)
	assert_eq(remote.other_attempt_signals, 0)
	# `PEER_REJOINED` of the participant connected with number 2: the client drops that connection and offers number 3.
	var peer: _PEER = p2p._peers[1]
	assert_eq(peer.attempt, 2)
	await _deliver([rejoined])
	assert_ne(p2p._peers[1], peer, "PEER_REJOINED of the connected participant dropped its connection")
	var replaced: _PEER = await _wait_replaced(1, peer)
	assert_not_null(replaced)
	if replaced == null:
		return
	assert_eq(replaced.status, _PEER.Status.CONNECTED)
	assert_eq(replaced.attempt, 3)
	assert_eq(remote.attempt, 3)
	assert_eq(driver.count(RealtimeNotice.Kind.PEER_CONNECTED), 1, "no second peer connected")
	assert_eq(driver.count(RealtimeNotice.Kind.PEER_LOST), 0)
	assert_eq(remote.other_attempt_signals, 0)
	assert_eq(server.malformed_signals, 0)
	await frames(10)
	assert_eq(_offer_attempts(), [1, 2, 3] as Array[int], "the offer of number 3 was sent once")
	assert_eq(p2p._peers[1], replaced)
	assert_true(p2p.send_packet(1, RealtimeCore.RealtimeChannel.RELIABLE, PackedByteArray([1])))


## The participant at index 1 restarts its app while its old connection still looks connected to the client at index 0:
## a new P2P transport rejoins on its own matchmaker connection, and the client's offer 3 after `PEER_REJOINED`
## connects the two transports.
func test_an_answering_side_app_restart_gets_the_next_offer_and_connects_without_peer_lost() -> void:
	if not await _start_p2p(false):
		return
	var other_server: RealtimeFakeMatchmaker = add_node(RealtimeFakeMatchmaker.new()) as RealtimeFakeMatchmaker
	add_child(other_server)
	if not await other_server.start():
		fail_test("the second test matchmaker did not start")
		return
	var other: P2pRealtimeTransport = P2pRealtimeTransport.new(other_server.base_url(), APP_VERSION, false)
	var other_driver: RealtimeTransportDriver = add_node(RealtimeTransportDriver.new()) as RealtimeTransportDriver
	other_driver.transport = other
	add_child(other_driver)
	# Each server passes the signals of its client to the other client, from the client's participant index.
	var to_other: _Bridge = add_node(_Bridge.new()) as _Bridge
	to_other.target = other_server
	to_other.index = 0
	to_other.drop_attempt = 1
	server.remotes[1] = to_other
	add_child(to_other)
	var to_client: _Bridge = add_node(_Bridge.new()) as _Bridge
	to_client.target = server
	to_client.index = 1
	other_server.remotes[0] = to_client
	add_child(to_client)
	var users: PackedInt64Array = PackedInt64Array([USER_ID, OTHER_ID])
	await _found(users, 0)
	other.start_matching(MODE_ID, ACCESS_TOKEN, false)
	await other_server.wait_count(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_REQUEST, 1)
	other_server.send(other_server.match_found(users, 1, false))
	await other_driver.wait_count(RealtimeNotice.Kind.MATCH_FOUND, 1)
	# Offer 1 does not reach the other transport, and `PEER_REJOINED` before its answer makes offer 2.
	p2p.connect_peer(1)
	other.connect_peer(0)
	await _wait_offers(1)
	var peer_rejoined: CoreContract.MatchmakerFrame = server.new_frame(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_PEER_REJOINED)
	peer_rejoined.index = 1
	server.send(peer_rejoined)
	await driver.wait_count(RealtimeNotice.Kind.PEER_CONNECTED, 1)
	await other_driver.wait_count(RealtimeNotice.Kind.PEER_CONNECTED, 1)
	var peer: _PEER = p2p._peers[1]
	assert_not_null(peer)
	if peer == null:
		return
	assert_eq(peer.attempt, 2)
	assert_eq(other._peers[0].attempt, 2)
	# The app restarts without closing anything: the earlier transport is no longer polled and its connection stays open,
	# so the client still reads the participant as connected. A new transport rejoins the match.
	var earlier: P2pRealtimeTransport = other
	other = P2pRealtimeTransport.new(other_server.base_url(), APP_VERSION, false)
	other_driver.transport = other
	other.rejoin("match-p2p", ACCESS_TOKEN)
	await other_server.wait_count(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_REJOIN, 1)
	var rejoined: CoreContract.MatchmakerFrame = other_server.new_frame(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_REJOINED)
	rejoined.match_id = "match-p2p"
	rejoined.ok = true
	rejoined.my_index = 1
	rejoined.players = other_server.match_found(users, 1, false).players
	other_server.send(rejoined)
	await other_driver.wait_count(RealtimeNotice.Kind.REJOINED, 1)
	assert_true(other_driver.oks[other_driver.last(RealtimeNotice.Kind.REJOINED)])
	other.connect_peer(0)
	await frames(10)
	assert_eq(p2p._peers[1], peer)
	assert_eq(peer.status, _PEER.Status.CONNECTED, "the earlier connection still looks connected")
	await _deliver([peer_rejoined])
	var replaced: _PEER = await _wait_replaced(1, peer)
	await other_driver.wait_count(RealtimeNotice.Kind.PEER_CONNECTED, 2)
	assert_not_null(replaced)
	if replaced == null:
		return
	assert_eq(replaced.status, _PEER.Status.CONNECTED)
	assert_eq(replaced.attempt, 3)
	assert_eq(_offer_attempts(), [1, 2, 3] as Array[int], "the client offers number 3 to the restarted app")
	assert_eq(other._peers[0].attempt, 3)
	assert_eq(driver.count(RealtimeNotice.Kind.PEER_CONNECTED), 1, "no second peer connected")
	assert_eq(driver.count(RealtimeNotice.Kind.PEER_LOST), 0)
	assert_eq(other_driver.count(RealtimeNotice.Kind.PEER_LOST), 0)
	assert_eq(server.malformed_signals, 0)
	assert_eq(other_server.malformed_signals, 0)
	assert_eq(warn_logs(), 0)
	assert_true(p2p.send_packet(1, RealtimeCore.RealtimeChannel.RELIABLE, PackedByteArray([7])))
	while other_driver.count(RealtimeNotice.Kind.PACKET_RECEIVED) == 0 and _running():
		await frames(1)
	assert_eq(other_driver.count(RealtimeNotice.Kind.PACKET_RECEIVED), 1, "the new connection carries packets")
	earlier.disconnect_all()


## The client at index 0 loses its matchmaker connection and its connection with index 1 together. The offer of the
## reconnect after the peer lost goes nowhere while the matchmaker connection is gone, and index 1, which only answers,
## waits for an offer: the rejoined of the same match offers again.
func test_a_rejoin_after_losing_the_matchmaker_and_the_peer_offers_again_and_connects() -> void:
	if not await _start_p2p(false):
		return
	var remote: RealtimeRemotePeer = _remote(1)
	assert_true(remote.start(false))
	var users: PackedInt64Array = PackedInt64Array([USER_ID, OTHER_ID])
	await _found(users, 0)
	p2p.connect_peer(1)
	await driver.wait_count(RealtimeNotice.Kind.PEER_CONNECTED, 1)
	# The DEV code closes the two connections: the P2P transport has no DEV operation of its own.
	RealtimeCoreDev._force_close_matchmaker(p2p)
	RealtimeCoreDev._force_close_peer(p2p, 1)
	await driver.wait_count(RealtimeNotice.Kind.MATCHMAKER_LOST, 1)
	await driver.wait_count(RealtimeNotice.Kind.PEER_LOST, 1)
	# RealtimeCore reconnects the `Disconnected` participant; offer 2 has no matchmaker connection to go on.
	p2p.connect_peer(1)
	await frames(10)
	assert_eq(_offer_attempts(), [1] as Array[int])
	# The participant's connection broke too, and it answers the next offer on a new connection.
	assert_true(remote.start(false))
	p2p.rejoin("match-p2p", ACCESS_TOKEN)
	await server.wait_count(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_REJOIN, 1)
	var rejoined: CoreContract.MatchmakerFrame = server.new_frame(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_REJOINED)
	rejoined.match_id = "match-p2p"
	rejoined.ok = true
	rejoined.my_index = 0
	rejoined.players = server.match_found(users, 0, false).players
	server.send(rejoined)
	await driver.wait_count(RealtimeNotice.Kind.REJOINED, 1)
	assert_true(driver.oks[driver.last(RealtimeNotice.Kind.REJOINED)])
	await driver.wait_count(RealtimeNotice.Kind.PEER_CONNECTED, 2)
	assert_eq(_offer_attempts(), [1, 3] as Array[int], "the rejoined offers the next number")
	assert_eq(remote.attempt, 3)
	assert_eq(driver.count(RealtimeNotice.Kind.PEER_LOST), 1)
	assert_eq(server.malformed_signals, 0)
	assert_true(p2p.send_packet(1, RealtimeCore.RealtimeChannel.RELIABLE, PackedByteArray([1])))


func test_peer_rejoined_on_the_larger_index_answers_without_an_offer() -> void:
	if not await _start_p2p(false):
		return
	await _found(PackedInt64Array([OTHER_ID, USER_ID]), 1)
	p2p.connect_peer(0)
	var rejoined: CoreContract.MatchmakerFrame = server.new_frame(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_PEER_REJOINED)
	rejoined.index = 0
	await _deliver([rejoined])
	var remote: RealtimeRemotePeer = _remote(0)
	assert_true(remote.start(true))
	await driver.wait_count(RealtimeNotice.Kind.PEER_CONNECTED, 1)
	assert_eq(_signals_of(_SIGNAL.Type.OFFER), 0)
	assert_eq(_signals_of(_SIGNAL.Type.ANSWER), 1)


func test_disconnect_closes_without_match_leave_and_close_sends_it_first() -> void:
	if not await _start_p2p(false):
		return
	var remote: RealtimeRemotePeer = _remote(1)
	assert_true(remote.start(false))
	await _found(PackedInt64Array([USER_ID, OTHER_ID]), 0)
	p2p.connect_peer(1)
	await driver.wait_count(RealtimeNotice.Kind.PEER_CONNECTED, 1)
	p2p.disconnect_all()
	await server.wait_closed(1)
	assert_eq(server.count(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_LEAVE), 0)
	assert_null(p2p._socket)
	assert_eq(p2p._peers.size(), 0)
	await _found(PackedInt64Array([USER_ID, OTHER_ID]), 0)
	p2p.close()
	await server.wait_closed(2)
	var leaves: Array[CoreContract.MatchmakerFrame] = server.frames_of(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_LEAVE)
	assert_eq(leaves.size(), 1)
	assert_eq(leaves[0].match_id, "match-p2p")


func test_relay_only_sends_and_takes_no_candidate_that_is_not_relay() -> void:
	if not await _start_p2p(true):
		return
	# A browser page cannot listen on a UDP socket, so the browser run has no test TURN server: there the test checks only
	# that no candidate that is not relay is sent or taken.
	var turn: RealtimeFakeTurn = null
	if CoreBuildInfo.platform != "web":
		turn = add_node(RealtimeFakeTurn.new()) as RealtimeFakeTurn
		add_child(turn)
		assert_true(turn.start())
		server.relay_url = turn.url()
	var remote: RealtimeRemotePeer = _remote(1)
	remote.drop_offers = 1
	assert_true(remote.start(false))
	p2p.start_matching(MODE_ID, ACCESS_TOKEN, false)
	await server.wait_count(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_REQUEST, 1)
	server.send(server.match_found(PackedInt64Array([USER_ID, OTHER_ID]), 0, true))
	await driver.wait_count(RealtimeNotice.Kind.MATCH_FOUND, 1)
	p2p.connect_peer(1)
	await _wait_offers(1)
	if turn != null:
		# The relay allocation on the test TURN server goes over UDP: the relay candidate ends the wait, not a frame count.
		while _sent_relay_candidates() == 0 and _running():
			await frames(1)
	await frames(30)
	if turn != null:
		assert_gt(turn.allocations, 0, "the client allocated a relay on the test TURN server")
		assert_gt(_sent_relay_candidates(), 0, "the client sent its relay candidate")
	for frame: CoreContract.MatchmakerFrame in server.frames_of(PEER_SIGNAL):
		var sent: _SIGNAL = _SIGNAL.new()
		assert_true(sent.read(frame.payload))
		if sent.type == _SIGNAL.Type.CANDIDATE:
			assert_true(_SIGNAL.is_relay_candidate(sent.data))
		else:
			for line: String in sent.data.split("\n"):
				if line.strip_edges().begins_with("a=candidate:"):
					assert_true(_SIGNAL.is_relay_candidate(line))
	var candidate: _SIGNAL = _SIGNAL.new()
	candidate.type = _SIGNAL.Type.CANDIDATE
	candidate.attempt = 1
	candidate.data = HOST_CANDIDATE
	candidate.mid = "0"
	candidate.index = 0
	await _deliver([server.peer_signal(1, candidate.to_payload())])
	var peer: _PEER = p2p._peers[1]
	assert_eq(peer.attempt, 1)
	assert_eq(peer.added_candidates, 0)
	assert_eq(peer.waiting_candidates.size(), 0)


func test_relay_only_without_relays_leaves_the_match_and_fails_join_match() -> void:
	set_settings()
	await start_dependencies()
	server = add_node(RealtimeFakeMatchmaker.new()) as RealtimeFakeMatchmaker
	add_child(server)
	assert_true(await server.start())
	server.match_reply = server.match_found(PackedInt64Array([USER_ID, OTHER_ID]), 0, false)
	RealtimeCore.set_transport(P2pRealtimeTransport.new(server.base_url(), APP_VERSION, true))
	assert_true(RealtimeCore.init())
	var result: MatchJoinResult = await RealtimeCore.join_match(MODE_ID)
	assert_eq(result.status, RealtimeCore.MatchJoinStatus.FAILED)
	assert_eq(result.fail_reason, CoreContract.MatchFailReason.MATCH_FAIL_REASON_CREATE_FAILED)
	assert_eq(result.error_code, 0)
	await server.wait_count(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_LEAVE, 1)
	await server.wait_closed(1)
	assert_eq(server.count(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_LEAVE), 1)
	assert_eq(warn_logs(), 1)


func test_relay_only_rejoined_without_relays_is_a_failed_rejoined() -> void:
	if not await _start_p2p(true):
		return
	p2p.rejoin("match-p2p", ACCESS_TOKEN)
	await server.wait_count(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_REJOIN, 1)
	var rejoined: CoreContract.MatchmakerFrame = server.new_frame(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_REJOINED)
	rejoined.match_id = "match-p2p"
	rejoined.ok = true
	rejoined.players = server.match_found(PackedInt64Array([USER_ID, OTHER_ID]), 0, false).players
	rejoined.transport = CoreContract.Transport.new()
	server.send(rejoined)
	await driver.wait_count(RealtimeNotice.Kind.REJOINED, 1)
	assert_false(driver.oks[driver.last(RealtimeNotice.Kind.REJOINED)])


func test_a_whole_match_logs_no_access_token_and_no_nat_traversal_values() -> void:
	set_settings()
	await start_dependencies()
	server = add_node(RealtimeFakeMatchmaker.new()) as RealtimeFakeMatchmaker
	add_child(server)
	assert_true(await server.start())
	var remote: RealtimeRemotePeer = _remote(1)
	assert_true(remote.start(false))
	server.match_reply = server.match_found(PackedInt64Array([USER_ID, OTHER_ID]), 0, true)
	RealtimeCore.set_transport(P2pRealtimeTransport.new(server.base_url(), APP_VERSION, false))
	assert_true(RealtimeCore.init())
	var result: MatchJoinResult = await RealtimeCore.join_match(MODE_ID)
	assert_eq(result.status, RealtimeCore.MatchJoinStatus.SUCCESS)
	assert_true(RealtimeCore.send(1, RealtimeCore.RealtimeChannel.RELIABLE, PackedByteArray([1, 2])))
	RealtimeCore.end_match()
	await frames(5)
	var text: String = ""
	for path: String in LogCoreDev.list_log_files():
		text += FileAccess.get_file_as_string(path)
	var secrets: PackedStringArray = [ACCESS_TOKEN, "relay-user-secret-name", "relay-credential-secret", "a=candidate", "typ host"]
	for secret: String in secrets:
		assert_false(text.contains(secret), "log contains %s" % secret)


# --- support ---


## Relay candidates the client sent, in candidate `PEER_SIGNAL`s and in the `a=candidate:` lines of its SDP.
func _sent_relay_candidates() -> int:
	var found: int = 0
	for frame: CoreContract.MatchmakerFrame in server.frames_of(PEER_SIGNAL):
		var sent: _SIGNAL = _SIGNAL.new()
		if not sent.read(frame.payload):
			continue
		if sent.type == _SIGNAL.Type.CANDIDATE:
			if _SIGNAL.is_relay_candidate(sent.data):
				found += 1
			continue
		for line: String in sent.data.split("\n"):
			if line.strip_edges().begins_with("a=candidate:") and _SIGNAL.is_relay_candidate(line):
				found += 1
	return found


## Starts the modules the P2P transport reads, the test matchmaker and a driver that polls a P2P transport.
func _start_p2p(relay_only: bool) -> bool:
	set_settings()
	await start_dependencies()
	server = add_node(RealtimeFakeMatchmaker.new()) as RealtimeFakeMatchmaker
	add_child(server)
	if not await server.start():
		fail_test("the test matchmaker did not start")
		return false
	p2p = P2pRealtimeTransport.new(server.base_url(), APP_VERSION, relay_only)
	driver = add_node(RealtimeTransportDriver.new()) as RealtimeTransportDriver
	driver.transport = p2p
	add_child(driver)
	return true


## Opens the matchmaker connection and takes a `MATCH_FOUND` of `user_ids` where the client is `my_index`.
func _found(user_ids: PackedInt64Array, my_index: int) -> void:
	var found: int = driver.count(RealtimeNotice.Kind.MATCH_FOUND)
	p2p.start_matching(MODE_ID, ACCESS_TOKEN, false)
	var requests: int = server.count(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_REQUEST)
	await server.wait_count(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_REQUEST, requests + 1)
	server.send(server.match_found(user_ids, my_index, false))
	await driver.wait_count(RealtimeNotice.Kind.MATCH_FOUND, found + 1)


## Sends `sent` to the client and lets the transport read them in one `poll`, after all of them reached its matchmaker
## connection: the relay passes them on after a time no frame count bounds.
func _deliver(sent: Array[CoreContract.MatchmakerFrame]) -> void:
	driver.paused = true
	for frame: CoreContract.MatchmakerFrame in sent:
		server.send(frame)
	await _wait_arrived(sent.size())
	driver.paused = false
	# `process_frame` comes before the nodes' `_process`: the second one comes after a `poll` of the driver.
	await frames(2)


## While the driver is paused, waits until `n` frames the transport has not read are on its matchmaker connection. Ends
## like the other condition waits.
func _wait_arrived(n: int) -> void:
	var socket: WebSocketPeer = p2p._socket
	while socket != null and socket.get_available_packet_count() < n and _running():
		await frames(1)
		socket.poll()


func _remote(index: int) -> RealtimeRemotePeer:
	var remote: RealtimeRemotePeer = add_node(RealtimeRemotePeer.new()) as RealtimeRemotePeer
	remote.index = index
	remote.server = server
	server.remotes[index] = remote
	add_child(remote)
	return remote


## Number of `PEER_SIGNAL`s of `type` the client sent.
func _signals_of(type: int) -> int:
	var found: int = 0
	for frame: CoreContract.MatchmakerFrame in server.frames_of(PEER_SIGNAL):
		var sent: _SIGNAL = _SIGNAL.new()
		if sent.read(frame.payload) and sent.type == type:
			found += 1
	return found


## Connection attempt numbers of the offers the client sent, in order.
func _offer_attempts() -> Array[int]:
	var found: Array[int] = []
	for frame: CoreContract.MatchmakerFrame in server.frames_of(PEER_SIGNAL):
		var sent: _SIGNAL = _SIGNAL.new()
		if sent.read(frame.payload) and sent.type == _SIGNAL.Type.OFFER:
			found.append(sent.attempt)
	return found


## Connection attempt numbers of the answers the client sent, in order.
func _answer_attempts() -> Array[int]:
	var found: Array[int] = []
	for frame: CoreContract.MatchmakerFrame in server.frames_of(PEER_SIGNAL):
		var sent: _SIGNAL = _SIGNAL.new()
		if sent.read(frame.payload) and sent.type == _SIGNAL.Type.ANSWER:
			found.append(sent.attempt)
	return found


## The first held signal of `remote` with connection attempt `number` and `type`; `null` when none.
func _held(remote: RealtimeRemotePeer, number: int, type: int) -> _SIGNAL:
	for item: _SIGNAL in remote.held_of(number):
		if item.type == type:
			return item
	return null


## The client at index 0 offers to the participant at index 1, which answers and holds its signals. Once its answer and
## a candidate of attempt 1 are held, `PEER_REJOINED` restarts the offer, and the participant answers offer 2 on a new
## connection, still holding. Returns the participant, or `null` when the test ended.
##
## The participant drops the client's candidates of attempt 1. With them, its connection of attempt 1 got answers to its
## connectivity checks from the client's connection, which answers checks before it has a remote description, and
## started a DTLS handshake that the client's connection never answers. Offer 2 drops that connection mid-handshake,
## and the WebRTC library may log the handshake cut short as two engine errors, depending on its thread timing.
func _restart_holding_attempt_1() -> RealtimeRemotePeer:
	var remote: RealtimeRemotePeer = _remote(1)
	assert_true(remote.start(false))
	remote.hold = true
	remote.drop_candidates_of_attempt = 1
	await _found(PackedInt64Array([USER_ID, OTHER_ID]), 0)
	p2p.connect_peer(1)
	# The WebRTC library makes the answer and gathers the candidates: the held signals end the wait, not a frame count.
	while (
		(_held(remote, 1, _SIGNAL.Type.ANSWER) == null or _held(remote, 1, _SIGNAL.Type.CANDIDATE) == null)
		and _running()
	):
		await frames(1)
	var rejoined: CoreContract.MatchmakerFrame = server.new_frame(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_PEER_REJOINED)
	rejoined.index = 1
	server.send(rejoined)
	await _wait_offers(2)
	while _held(remote, 2, _SIGNAL.Type.ANSWER) == null and _running():
		await frames(1)
	if not _running():
		fail_test("the participant did not answer offer 2")
		return null
	assert_eq(_offer_attempts(), [1, 2] as Array[int])
	assert_not_null(_held(remote, 1, _SIGNAL.Type.ANSWER))
	assert_not_null(_held(remote, 1, _SIGNAL.Type.CANDIDATE))
	return remote


## Waits until the connection of participant `index` is a connection other than `peer` that connected, or none is left.
## Returns that connection; `null` when none is left or the test ended.
func _wait_replaced(index: int, peer: _PEER) -> _PEER:
	while _running():
		var now: _PEER = p2p._peers[index]
		if now == null:
			return null
		if now != peer and now.status == _PEER.Status.CONNECTED:
			return now
		await frames(1)
	return null


## Waits until the client's connection with participant `index` gathered all its ICE candidates and every signal the
## transport sent reached the test matchmaker. A count of the client's `PEER_SIGNAL`s taken after it holds every signal
## the client sent: the client sends its candidates while and after it connects, and the relay passes them on after a
## time no frame count bounds.
func _settle_signals(index: int) -> void:
	var peer: _PEER = p2p._peers[index]
	if peer != null:
		await _wait_gathered(peer.connection)
	# `process_frame` comes before the nodes' `_process`: the second one comes after a `poll` of the driver, which sends
	# the candidates the connection gave.
	await frames(2)
	await _sync_sent()


## Waits until `connection` gathered all its ICE candidates. Ends like the other condition waits.
func _wait_gathered(connection: WebRTCPeerConnection) -> void:
	while (
		connection != null and connection.get_gathering_state() != WebRTCPeerConnection.GATHERING_STATE_COMPLETE
		and _running()
	):
		await frames(1)


## Waits until every frame the transport sent on its matchmaker connection so far reached the test matchmaker: a frame
## the test puts on that connection after them reaches the matchmaker after them. The frame has no kind, and the
## matchmaker only records it.
func _sync_sent() -> void:
	var socket: WebSocketPeer = p2p._socket
	if socket == null:
		fail_test("the transport has no matchmaker connection")
		return
	var marker: CoreContract.MatchmakerFrame = server.new_frame(_MARKER)
	marker.match_id = "sync"
	var marked: int = server.count(_MARKER)
	assert_eq(socket.send(marker.encode(), WebSocketPeer.WRITE_MODE_BINARY), OK)
	await server.wait_count(_MARKER, marked + 1)


func _wait_offers(n: int) -> void:
	while _signals_of(_SIGNAL.Type.OFFER) < n and _running():
		await frames(1)


## Whether the test goes on. A release of the modules, as at the test time limit, ends the condition waits.
static func _running() -> bool:
	return EventCore.is_initialized()


func _offer_payload() -> PackedByteArray:
	var offer: _SIGNAL = _SIGNAL.new()
	offer.type = _SIGNAL.Type.OFFER
	offer.attempt = 1
	offer.data = "v=0"
	return offer.to_payload()


## Test participant that is another client: the `PEER_SIGNAL`s a server got from its client for this participant go to
## the `target` server's client as `PEER_SIGNAL`s from `index`. IPv4 host candidates get the loopback address, as
## `RealtimeRemotePeer` gives them. Signals of connection attempt `drop_attempt` are dropped.
class _Bridge:
	extends RealtimeRemotePeer

	var target: RealtimeFakeMatchmaker = null
	var drop_attempt: int = 0

	func receive(payload: PackedByteArray) -> void:
		var received: _SIGNAL = _SIGNAL.new()
		if not received.read(payload) or received.attempt == drop_attempt:
			return
		if received.type == _SIGNAL.Type.CANDIDATE:
			received.data = RealtimeRemotePeer._loopback(received.data)
		target.send(target.peer_signal(index, received.to_payload()))
