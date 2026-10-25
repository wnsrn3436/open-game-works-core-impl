extends "res://core/qa_core/tests/support/qa_realtime_case.gd"
## Commands and QAState with `RealtimeCore` in the module list: `drop_peer`, `drop_matchmaker`, `leave_match`, the
## step mode commands in a match, the room fields, `step` in a lockstep match and the `AuthCore` setups.

const REFRESH_TOKEN: String = "core/RefreshToken"


func test_drop_peer_other() -> void:
	assert_true(await start_realtime())
	await reach_playing(3, 0)
	await run_ok("drop_peer", PackedStringArray(["other"]))
	assert_eq(calls_of("force_close_peer"), PackedStringArray(["1"]), "the smallest Connected other index")
	await UnitTestCore.wait_frames(2)
	RealtimeCore.leave()
	await UnitTestCore.wait_frames(2)
	await reach_playing(3, 1)
	var lost: RealtimeNotice = notice(RealtimeNotice.Kind.PEER_LOST)
	lost.participant = 0
	UnitTestCore.add_realtime_notice(fake, lost)
	await UnitTestCore.wait_frames(2)
	assert_eq(RealtimeCore.peer_state(0), RealtimeCore.PeerState.DISCONNECTED)
	await run_ok("drop_peer", PackedStringArray(["other"]))
	assert_eq(calls_of("force_close_peer"), PackedStringArray(["1", "2"]), "index 0 is Disconnected, so 2")
	await UnitTestCore.wait_frames(2)
	assert_false((await run("drop_peer", PackedStringArray(["other"]))).ok, "no Connected other participant")
	assert_eq(calls_of("force_close_peer").size(), 2, "no call without a target")
	assert_eq(warns(), 1)
	# `force_peer_lost` ran only on Connected participants, and the third command found no target before calling it.
	assert_eq(UnitTestCore.check_logs(WARN, "RealtimeCore"), 0)


func test_drop_peer_index_and_drop_matchmaker() -> void:
	assert_true(await start_realtime())
	await reach_playing(2, 0)
	await run_ok("drop_peer", PackedStringArray(["1"]))
	assert_eq(calls_of("force_close_peer"), PackedStringArray(["1"]))
	await UnitTestCore.wait_frames(2)
	assert_false((await run("drop_peer", PackedStringArray(["1"]))).ok, "the result of force_peer_lost")
	assert_eq(calls_of("force_close_peer").size(), 1)
	await run_ok("drop_matchmaker")
	assert_eq(calls_of("force_close_matchmaker").size(), 1, "force_matchmaker_lost ran once")
	assert_eq(warns(), 1)
	assert_eq(UnitTestCore.check_logs(WARN, "RealtimeCore"), 1, "force_peer_lost of 1, no longer Connected")


func test_leave_match_and_step_mode() -> void:
	assert_true(await start_realtime())
	await run_ok("leave_match")
	assert_eq(calls_of("cancel_matching").size(), 0, "no leave in None")
	var call: Call = Call.new()
	call.join_match(mode_id)
	await UnitTestCore.wait_frames(2)
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.MATCHING)
	assert_eq(JSONR.text(await state(), "match_state"), "Matching")
	assert_false((await run("set_step_mode", PackedStringArray(["on"]))).ok, "not in a match")
	assert_false(TimeCoreDev.is_step_mode())
	await run_ok("leave_match")
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.NONE, "leave ran")
	assert_eq(calls_of("cancel_matching").size(), 1)
	await run_ok("set_step_mode", PackedStringArray(["on"]))
	assert_true(TimeCoreDev.is_step_mode())
	await run_ok("set_step_mode", PackedStringArray(["off"]))
	if not call.done:
		await call.finished
	assert_eq(warns(), 1)


func test_room_fields() -> void:
	assert_true(await start_realtime())
	var json: String = await state()
	assert_eq(JSONR.text(json, "room_code"), "")
	assert_eq(JSONR.integer(json, "room_mode_id"), 0)
	assert_eq(JSONR.text(json, "room_mode"), "")
	var call: Call = Call.new()
	call.create_room(mode_id)
	await UnitTestCore.wait_frames(2)
	var room: RoomInfo = RoomInfo.new()
	room.room_code = ROOM_CODE
	room.mode_id = mode_id
	room.members = PackedInt64Array([USER_ID])
	room.status = CoreContract.RoomStatus.ROOM_STATUS_OPEN
	var updated: RealtimeNotice = notice(RealtimeNotice.Kind.ROOM_UPDATED)
	updated.room_info = room
	UnitTestCore.add_realtime_notice(fake, updated)
	await UnitTestCore.wait_frames(2)
	if not call.done:
		await call.finished
	assert_true(call.room.ok, "create_room")
	json = await state()
	assert_eq(JSONR.text(json, "room_code"), RealtimeCore.room_info().room_code)
	assert_eq(JSONR.integer(json, "room_mode_id"), mode_id)
	assert_eq(JSONR.text(json, "room_mode"), "[testing_duel]", "the ID name of the match mode")
	RealtimeCore.leave_room()
	await UnitTestCore.wait_frames(2)
	json = await state()
	assert_eq(JSONR.text(json, "room_code"), "")
	assert_eq(JSONR.integer(json, "room_mode_id"), 0)
	assert_eq(JSONR.text(json, "room_mode"), "")


func test_step_in_a_lockstep_match() -> void:
	assert_true(await start_realtime())
	TimeCoreDev.set_step_mode(true)
	await reach_playing(2, 0, true)
	assert_true(RealtimeCore.match_info().lockstep)
	var result: RunCommandResult = await run("step", PackedStringArray(["100"]))
	assert_false(result.ok, "the result of request_step, false on a transport that is not lockstep")
	assert_eq(UnitTestCore.check_logs(WARN, "RealtimeCore"), 1, "request_step ran once")
	assert_eq(TimeCoreDev.get_step_budget(), 0, "no step budget in a lockstep match")
	assert_eq(warns(), 1)
	TimeCoreDev.set_step_mode(false)


func test_an_input_in_a_lockstep_match_adds_no_step_budget() -> void:
	assert_true(await start_realtime(true))
	TimeCoreDev.set_step_mode(true)
	await reach_playing(2, 0, true)
	var budgets: Array[int] = []
	QACore._node.frame_started.connect(func() -> void: budgets.append(TimeCoreDev.get_step_budget()))
	var game_time: int = TimeCore.get_game_time()
	assert_true((await finish(start_command("key", PackedStringArray(["Space"])))).ok)
	assert_false(budgets.is_empty())
	assert_eq(budgets.count(0), budgets.size(), "no budget in Playing of a lockstep match")
	assert_eq(TimeCore.get_game_time(), game_time, "only the steps of the match move game time")
	assert_eq(warns(), 0)
	TimeCoreDev.set_step_mode(false)


func test_step_in_a_lockstep_match_ends_with_the_request_step_result() -> void:
	assert_true(await start_realtime(true))
	TimeCoreDev.set_step_mode(true)
	await reach_playing(2, 0, true)
	var game_time: int = TimeCore.get_game_time()
	var result: RunCommandResult = await finish(start_command("step", PackedStringArray(["100"])))
	assert_true(result.ok, "request_step gave true")
	assert_eq(steps_sent(), 1, "request_step sent one step to the other participant")
	assert_eq(TimeCore.get_game_time(), game_time + 100, "the step ran")
	assert_eq(warns(), 0)
	TimeCoreDev.set_step_mode(false)


func test_lockstep_step_over_its_time_limit() -> void:
	assert_true(await start_realtime(true))
	TimeCoreDev.set_step_mode(true)
	await reach_playing(2, 0, true)
	assert_true((await finish(start_command("step", PackedStringArray(["100"])))).ok, "the first step runs")
	var budget: int = TimeCoreDev.get_step_budget()
	# The other participant sends no step end, so the next step does not start.
	var result: RunCommandResult = await finish(start_command("step", PackedStringArray(["100"])), 100, 100)
	assert_false(result.ok)
	assert_eq(JSONR.text(result.result, ""), "the command went over its time limit")
	var json: String = await state()
	assert_eq(JSONR.integer(json, "step_budget_ms"), budget, "the budget stays")
	assert_true(JSONR.boolean(json, "step_mode"), "step mode stays on")
	assert_true(QACore._lockstep_step_running, "its request_step still runs")
	var packets: int = calls_of("send_packet").size()
	var third: RunCommandResult = await run("step", PackedStringArray(["100"]))
	assert_false(third.ok)
	assert_eq(JSONR.text(third.result, ""), "the request_step of an earlier step has not returned")
	assert_eq(calls_of("send_packet").size(), packets, "no request_step")
	assert_eq(UnitTestCore.check_logs(WARN, "RealtimeCore"), 0, "request_step was not called")
	assert_eq(warns(), 2)


func test_step_in_a_lockstep_match_while_paused() -> void:
	assert_true(await start_realtime(true))
	TimeCoreDev.set_step_mode(true)
	await reach_playing(2, 0, true)
	TimeCore.set_paused(true)
	var game_time: int = TimeCore.get_game_time()
	var result: RunCommandResult = await run("step", PackedStringArray(["100"]))
	assert_false(result.ok)
	assert_eq(JSONR.text(result.result, ""), "game time is paused")
	assert_eq(steps_sent(), 0, "no request_step")
	assert_eq(TimeCoreDev.get_step_budget(), 0)
	assert_eq(warns(), 1)
	TimeCore.set_paused(false)
	await advance(100, 2)
	assert_eq(TimeCore.get_game_time(), game_time, "no step ran after the pause")
	TimeCoreDev.set_step_mode(false)


func test_drop_peer_argument_checks_with_realtime_core() -> void:
	assert_true(await start_realtime())
	await reach_playing(2, 0)
	for participant: String in ["-1", "others"]:
		var result: RunCommandResult = await run("drop_peer", PackedStringArray([participant]))
		assert_false(result.ok, participant)
		assert_eq(warns(), 1, participant)
	assert_eq(calls_of("force_close_peer").size(), 0, "no force_peer_lost")
	assert_eq(UnitTestCore.check_logs(WARN, "RealtimeCore"), 0)


func test_auth_setups_with_auth_core() -> void:
	assert_true(await start_realtime())
	var token: GetAccessTokenResult = await AuthCore.get_access_token()
	assert_true(token.ok)
	assert_eq(bodies(REFRESH_TOKEN).size(), 0, "the access token of the login is fresh")
	await run_ok("expire_access_token")
	var refreshed: CoreContract.RefreshTokenResponse = CoreContract.RefreshTokenResponse.new()
	refreshed.access_token = "qa-test-access-token-refreshed"
	refreshed.access_token_expires_at = SERVER_TIME + ACCESS_TOKEN_MS
	UnitTestCore.add_result(REFRESH_TOKEN, NetworkCore.TransferResult.DONE, 200, ok_bytes(refreshed))
	token = await AuthCore.get_access_token()
	assert_eq(bodies(REFRESH_TOKEN).size(), 1, "expire_access_token expired the access token")
	assert_eq(token.access_token, "qa-test-access-token-refreshed")
	await run_ok("set_social_account", PackedStringArray(["fake_one"]))
	var adapter: SocialAdapter = FakeSocialAdapter.new()
	var signed: SocialAdapter.SignInResult = adapter.sign_in()
	assert_eq(signed.credential, "fake:fake_one", "the fake social adapter signs in with the fake account")
	assert_false((await run("set_social_account", PackedStringArray(["Fake-One"]))).ok, "not snake_case")
	assert_eq(adapter.sign_in().credential, "fake:fake_one", "no target operation")
	assert_eq(warns(), 1)


## Step messages of the lockstep transport to participant 1: `[1, 2, k, ms]`.
func steps_sent() -> int:
	var count: int = 0
	for inputs: String in calls_of("send_packet"):
		var parts: PackedStringArray = inputs.split(" ")
		if parts.size() == 3 and parts[0] == "1" and parts[2].begins_with("0102"):
			count += 1
	return count
