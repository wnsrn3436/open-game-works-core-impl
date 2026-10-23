class_name RealtimeTestCase
extends UnitTestCase
## Base of the RealtimeCore core tests. Starts RealtimeCore and the modules it depends on in module list order, logs
## in with a dev account through the fake network, and gives RealtimeCore the `UnitTestCore` fake realtime transport
## inside a `RealtimeRecordingTransport` that keeps the transport calls.

const TAG: String = "RealtimeCore"
const MODE_ID: int = 7
const OTHER_MODE_ID: int = 8
const SERVER_TIME: int = 1700000500000
const BASE_URL: String = "http://127.0.0.1"
const APP_VERSION: String = "1.2.3"
const USER_ID: int = 1001
const OTHER_ID: int = 1002
const THIRD_ID: int = 1003
const ACCESS_TOKEN: String = "realtime-test-access-token-value"
const NEW_ACCESS_TOKEN: String = "realtime-test-refreshed-access-token"
const MATCH_ID: String = "match-0001"
const MATCH_SEED: int = 424242
const ROOM_CODE: String = "ROOM42"
const DEV_LOGIN: String = "core/cheat/DevLogin"
const REFRESH_TOKEN: String = "core/RefreshToken"
const RESYNC: String = "core/Resync"
## The `LogCore` sender sends the warn and error logs of a test through NetworkCore once a session is open.
const REPORT_ERRORS: String = "core/ReportClientErrors"
## `ReportClientErrors` results registered after the login: more than the sends of the longest test clock.
const REPORT_ERRORS_RESULTS: int = 16
## The resource key of `[ui_button_click]` in the core test data. `UICore.prepare` loads it.
const CLICK: String = "sfx/ui_button_click"
const CLICK_PATH: String = "res://core/realtime_core/tests/resources/test_click.tres"

## Life of the access token of the login result.
const ACCESS_TOKEN_LIFE_MS: int = 86400000

const CONNECT_TIMEOUT_MS: int = 5000
const RECONNECT_TIMEOUT_MS: int = 8000
const BACKGROUND_TIMEOUT_MS: int = 6000
const MESSAGE_MAX_BYTES: int = 64
const PENDING_MAX: int = 3
const RETRY_DELAY_MS: int = 1000
const RETRY_FACTOR_PERMILLE: int = 2000
const RETRY_DELAY_MAX_MS: int = 3000

var fake: UnitTestRealtimeTransport = null
var transport: RealtimeRecordingTransport = null
var events: RealtimeEventRecorder = null
var _nodes: Array[Node] = []


func after_each() -> void:
	await super()
	RealtimeCore.release()
	AuthCore.release()
	NetworkCore.release()
	UserStateCore.release()
	MessageCore.release()
	UICore.release()
	TweenCore.release()
	SafeAreaCore.release()
	LocalizationCore.release()
	SoundCore.release()
	InputCore.release()
	InputBlockCore.release()
	ResolutionCore.release()
	DataCore.release()
	PoolCore.release()
	ResourceCore.release()
	LocalDataCore.release()
	TimeCore.release()
	EventCore.release()
	LogCore.release()
	for node: Node in _nodes:
		if is_instance_valid(node):
			node.free()
	_nodes.clear()


## Starts the dependencies, logs in and loads the `user` file. With `with_transport`, makes the fake realtime
## transport and passes it before `RealtimeCore.init`. With `start_core`, initializes RealtimeCore.
func start_realtime(with_transport: bool = true, start_core: bool = true) -> void:
	set_settings()
	await start_dependencies()
	fake = UnitTestCore.create_fake_realtime()
	transport = RealtimeRecordingTransport.new(fake)
	if with_transport:
		RealtimeCore.set_transport(transport)
	if start_core:
		assert_true(RealtimeCore.init(), "RealtimeCore.init")
	events = RealtimeEventRecorder.new()
	_nodes.append(events)
	assert_true(events.subscribe_all())


func set_settings() -> void:
	assert_true(UnitTestCore.set_test_settings("RealtimeCore.connectTimeoutMs", CONNECT_TIMEOUT_MS))
	assert_true(UnitTestCore.set_test_settings("RealtimeCore.reconnectTimeoutMs", RECONNECT_TIMEOUT_MS))
	assert_true(UnitTestCore.set_test_settings("RealtimeCore.backgroundTimeoutMs", BACKGROUND_TIMEOUT_MS))
	assert_true(UnitTestCore.set_test_settings("RealtimeCore.messageMaxBytes", MESSAGE_MAX_BYTES))
	assert_true(UnitTestCore.set_test_settings("RealtimeCore.pendingMessageMax", PENDING_MAX))
	assert_true(UnitTestCore.set_test_settings("NetworkCore.retryDelayMs", RETRY_DELAY_MS))
	assert_true(UnitTestCore.set_test_settings("NetworkCore.retryDelayFactorPermille", RETRY_FACTOR_PERMILLE))
	assert_true(UnitTestCore.set_test_settings("NetworkCore.retryDelayMaxMs", RETRY_DELAY_MAX_MS))
	assert_true(UnitTestCore.set_test_settings("RealtimeCore.simLatencyMs", 0))
	assert_true(UnitTestCore.set_test_settings("RealtimeCore.simJitterMs", 0))
	assert_true(UnitTestCore.set_test_settings("RealtimeCore.simLossPermille", 0))


## Initializes the modules RealtimeCore depends on in module list order, logs in with `DevLogin` and loads the
## `user` file of the user.
func start_dependencies() -> void:
	var keys: Dictionary[String, String] = {CLICK: CLICK_PATH}
	ResourceCoreDev.set_test_key_list(keys)
	assert_true(LogCore.init(), "LogCore.init")
	assert_true(EventCore.init(), "EventCore.init")
	assert_true(TimeCore.init(), "TimeCore.init")
	assert_true(LocalDataCore.init(), "LocalDataCore.init")
	assert_true(LocalDataCore.load_device_file(), "LocalDataCore.load_device_file")
	assert_true(ResourceCore.init(), "ResourceCore.init")
	assert_true(PoolCore.init(), "PoolCore.init")
	assert_true(DataCore.init(), "DataCore.init")
	assert_true(ResolutionCore.init(), "ResolutionCore.init")
	assert_true(InputBlockCore.init(), "InputBlockCore.init")
	assert_true(InputCore.init(), "InputCore.init")
	assert_true(SoundCore.init(), "SoundCore.init")
	assert_true(LocalizationCore.init(), "LocalizationCore.init")
	assert_true(SafeAreaCore.init(), "SafeAreaCore.init")
	assert_true(TweenCore.init(), "TweenCore.init")
	assert_true(UICore.init(), "UICore.init")
	assert_true(MessageCore.init(), "MessageCore.init")
	assert_true(UserStateCore.init(), "UserStateCore.init")
	assert_true(NetworkCore.init(), "NetworkCore.init")
	assert_true(AuthCore.init(), "AuthCore.init")
	assert_true(await DataCore.load(null), "DataCore.load")
	LocalizationCore.resolve_language()
	assert_true(await LocalizationCore.load_translation([]), "LocalizationCore.load_translation")
	assert_true(await UICore.prepare(), "UICore.prepare")
	assert_true(await MessageCore.prepare(), "MessageCore.prepare")
	assert_true(NetworkCore.set_server_info(BASE_URL, APP_VERSION, CoreBuildInfo.platform), "set_server_info")
	add_login_result()
	var login: LoginResult = await AuthCoreDev.dev_login("realtime")
	assert_eq(login.status, AuthCore.LoginStatus.SUCCESS, "dev_login")
	for i: int in REPORT_ERRORS_RESULTS:
		add_response(REPORT_ERRORS, CoreContract.ReportClientErrorsResponse.new())
	assert_true(LocalDataCore.load_user_file(USER_ID), "LocalDataCore.load_user_file")


func add_login_result() -> void:
	var auth: CoreContract.AuthResult = CoreContract.AuthResult.new()
	auth.user_id = USER_ID
	auth.user_created_at = SERVER_TIME - 1000
	auth.login_token = "realtime-test-login-token"
	auth.access_token = ACCESS_TOKEN
	auth.access_token_expires_at = SERVER_TIME + ACCESS_TOKEN_LIFE_MS
	auth.session_signing_key = "realtime-test-signing-key"
	auth.consent = CoreContract.ConsentUserState.new()
	auth.remote_config = CoreContract.GetRemoteConfigResponse.new()
	var response: CoreCheatContract.DevLoginResponse = CoreCheatContract.DevLoginResponse.new()
	response.result = auth
	add_response(DEV_LOGIN, response)


## Adds a successful fake network result of `request_name` with `response` as its body.
func add_response(request_name: String, response: ContractMessage) -> void:
	var env: CoreContract.ResponseEnvelope = CoreContract.ResponseEnvelope.new()
	env.server_time_at = SERVER_TIME
	env.body = response.encode()
	UnitTestCore.add_result(request_name, NetworkCore.TransferResult.DONE, 200, UnitTestCore.make_response(env))


## Adds a fake network error result of `request_name`.
func add_error(request_name: String, code: int) -> void:
	var env: CoreContract.ResponseEnvelope = CoreContract.ResponseEnvelope.new()
	env.server_time_at = SERVER_TIME
	env.error = CoreContract.ServerError.new()
	env.error.code = code
	UnitTestCore.add_result(request_name, NetworkCore.TransferResult.DONE, 200, UnitTestCore.make_response(env))


## Adds a successful `RefreshToken` result that gives `NEW_ACCESS_TOKEN`.
func add_refresh_result() -> void:
	var response: CoreContract.RefreshTokenResponse = CoreContract.RefreshTokenResponse.new()
	response.access_token = NEW_ACCESS_TOKEN
	response.access_token_expires_at = SERVER_TIME + 86400000
	add_response(REFRESH_TOKEN, response)


## Ends the `RefreshToken` request that a hold of `add_pending` keeps: with `ok`, a result that gives
## `NEW_ACCESS_TOKEN`, otherwise a `MAINTENANCE` error.
func release_refresh(ok: bool) -> void:
	var env: CoreContract.ResponseEnvelope = CoreContract.ResponseEnvelope.new()
	env.server_time_at = SERVER_TIME
	if ok:
		var response: CoreContract.RefreshTokenResponse = CoreContract.RefreshTokenResponse.new()
		response.access_token = NEW_ACCESS_TOKEN
		response.access_token_expires_at = SERVER_TIME + 86400000
		env.body = response.encode()
	else:
		env.error = CoreContract.ServerError.new()
		env.error.code = CoreContract.CoreError.CORE_ERROR_MAINTENANCE
	var released: bool = UnitTestCore.release_pending(REFRESH_TOKEN, NetworkCore.TransferResult.DONE, 200, UnitTestCore.make_response(env))
	assert_true(released, "a RefreshToken request is held")


## Moves the test clock to the expiry of the access token and makes the next `RefreshToken` fail: the next
## `AuthCore.get_access_token` gives no access token. AuthCore's own refresh at the expiry fails first and stops.
func lose_access_token() -> void:
	UnitTestCore.advance_clock(ACCESS_TOKEN_LIFE_MS, false)
	add_error(REFRESH_TOKEN, CoreContract.CoreError.CORE_ERROR_MAINTENANCE)
	await frames(5)
	add_error(REFRESH_TOKEN, CoreContract.CoreError.CORE_ERROR_MAINTENANCE)


## Adds the results of the requests one background return sends: `AuthCore`'s `RefreshToken` and `NetworkCore`'s
## `Resync`.
func add_background_return_results() -> void:
	add_refresh_result()
	add_response(RESYNC, CoreContract.ResyncResponse.new())


# --- logs ---


func warn_logs() -> int:
	return UnitTestCore.check_logs("warn", TAG)


func error_logs() -> int:
	return UnitTestCore.check_logs("error", TAG)


# --- frames and time ---


## Lets RealtimeCore poll the transport and run deferred work.
func frames(count: int = 2) -> void:
	await UnitTestCore.wait_frames(count)


## Moves the test clock and lets RealtimeCore poll.
func advance(ms: int) -> void:
	UnitTestCore.advance_clock(ms, false)
	await frames(1)


# --- notifications ---


func new_notice(kind: RealtimeNotice.Kind) -> RealtimeNotice:
	var notice: RealtimeNotice = RealtimeNotice.new()
	notice.reset(kind)
	return notice


## Adds a notification to the fake realtime transport. It comes at the next `poll`.
func push(notice: RealtimeNotice) -> void:
	UnitTestCore.add_realtime_notice(fake, notice)


## A `MatchInfo` of `count` participants where this user is `my_index`.
func make_info(count: int = 2, my_index: int = 0) -> MatchInfo:
	var info: MatchInfo = MatchInfo.new()
	info.match_id = MATCH_ID
	info.mode_id = MODE_ID
	info.my_index = my_index
	var others: PackedInt64Array = [OTHER_ID, THIRD_ID, 1004, 1005]
	var next_other: int = 0
	for i: int in count:
		if i == my_index:
			info.user_ids.append(USER_ID)
		else:
			info.user_ids.append(others[next_other])
			next_other += 1
		info.teams.append(i % 2)
		info.parties.append(0)
	info.match_seed = MATCH_SEED
	info.start_at = SERVER_TIME + 3000
	return info


func push_match_found(info: MatchInfo) -> void:
	var notice: RealtimeNotice = new_notice(RealtimeNotice.Kind.MATCH_FOUND)
	notice.match_info = info
	push(notice)


func push_match_failed(reason: CoreContract.MatchFailReason, error_code: int) -> void:
	var notice: RealtimeNotice = new_notice(RealtimeNotice.Kind.MATCH_FAILED)
	notice.fail_reason = reason
	notice.error_code = error_code
	push(notice)


func push_matchmaker_lost(error_code: int) -> void:
	var notice: RealtimeNotice = new_notice(RealtimeNotice.Kind.MATCHMAKER_LOST)
	notice.error_code = error_code
	push(notice)


func push_rejoined(ok: bool, left_indices: PackedInt32Array = PackedInt32Array()) -> void:
	var notice: RealtimeNotice = new_notice(RealtimeNotice.Kind.REJOINED)
	notice.ok = ok
	notice.left_indices = left_indices
	push(notice)


func push_peer_connected(participant: int) -> void:
	var notice: RealtimeNotice = new_notice(RealtimeNotice.Kind.PEER_CONNECTED)
	notice.participant = participant
	push(notice)


func push_peer_lost(participant: int) -> void:
	var notice: RealtimeNotice = new_notice(RealtimeNotice.Kind.PEER_LOST)
	notice.participant = participant
	push(notice)


func push_packet(participant: int, channel: RealtimeCore.RealtimeChannel, packet: PackedByteArray) -> void:
	var notice: RealtimeNotice = new_notice(RealtimeNotice.Kind.PACKET_RECEIVED)
	notice.participant = participant
	notice.channel = channel
	notice.packet = packet
	push(notice)


## Pushes a realtime message packet: kind `0` and `bytes`.
func push_message(participant: int, channel: RealtimeCore.RealtimeChannel, bytes: PackedByteArray) -> void:
	var packet: PackedByteArray = PackedByteArray([0])
	packet.append_array(bytes)
	push_packet(participant, channel, packet)


## Pushes a leave notice: `[1, 1, reason]`, reason 1 = `Left`, 2 = `Ended`.
func push_leave_notice(participant: int, reason: int) -> void:
	push_packet(participant, RealtimeCore.RealtimeChannel.RELIABLE, PackedByteArray([1, 1, reason]))


func make_room(members: PackedInt64Array, status: CoreContract.RoomStatus = CoreContract.RoomStatus.ROOM_STATUS_OPEN) -> RoomInfo:
	var room: RoomInfo = RoomInfo.new()
	room.room_code = ROOM_CODE
	room.mode_id = MODE_ID
	room.members = members
	room.status = status
	return room


func push_room_updated(room: RoomInfo) -> void:
	var notice: RealtimeNotice = new_notice(RealtimeNotice.Kind.ROOM_UPDATED)
	notice.room_info = room
	push(notice)


func push_room_failed(error_code: int, request: RealtimeCore.RoomRequest) -> void:
	var notice: RealtimeNotice = new_notice(RealtimeNotice.Kind.ROOM_FAILED)
	notice.error_code = error_code
	notice.room_request = request
	push(notice)


func push_room_kicked() -> void:
	push(new_notice(RealtimeNotice.Kind.ROOM_KICKED))


# --- flows ---


## Starts `join_match` and waits until it calls `start_matching`.
func start_join() -> RealtimeAsyncCall:
	var op: RealtimeAsyncCall = RealtimeAsyncCall.new()
	op.join_match(MODE_ID)
	await frames()
	return op


## Joins a match of `count` participants as `my_index` and connects every other participant.
func reach_playing(count: int = 2, my_index: int = 0) -> RealtimeAsyncCall:
	var op: RealtimeAsyncCall = await start_join()
	push_match_found(make_info(count, my_index))
	await frames()
	for i: int in count:
		if i != my_index:
			push_peer_connected(i)
	await frames()
	await op.wait()
	assert_eq(op.join_result.status, RealtimeCore.MatchJoinStatus.SUCCESS, "reach_playing")
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.PLAYING, "reach_playing state")
	return op


## Creates a room with `members` (the first is the host) and waits until it is in the room.
func reach_room(members: PackedInt64Array) -> void:
	var op: RealtimeAsyncCall = RealtimeAsyncCall.new()
	op.create_room(MODE_ID)
	await frames()
	push_room_updated(make_room(members))
	await frames()
	await op.wait()
	assert_true(op.room_result.ok, "reach_room")


## The saved `MatchInfo` match ID in the `user` file.
func saved_id() -> String:
	return LocalDataCore.get_value_string(LocalDataCore.FileKind.USER, "RealtimeCore.match_id", "")


func add_node(node: Node) -> Node:
	_nodes.append(node)
	return node
