extends UnitTestCase
## Access token, its refresh, the frame refresh, refresh rejection and session replacement.

const Env := preload("res://core/auth_core/tests/support/auth_test_env.gd")
const Flow := preload("res://core/auth_core/tests/support/flow.gd")
const Storage := preload("res://core/auth_core/adapters/token_storage.gd")

const MARGIN_MS: int = 60000

var env: Env = null


func before_each() -> void:
	super()
	env = Env.new()


func after_each() -> void:
	env.finish()
	super()


func _login() -> void:
	assert_true(UnitTestCore.set_test_settings("AuthCore.tokenRefreshMarginMs", MARGIN_MS))
	assert_true(await env.boot())
	var result: LoginResult = await env.boot_guest(201, "token-a")
	assert_eq(result.status, AuthCore.LoginStatus.SUCCESS)


func _start_get_token() -> Flow:
	var flow: Flow = Flow.new()
	flow.start(func(f: Flow) -> void:
		f.result = await AuthCore.get_access_token()
		f.finish())
	return flow


func test_token_is_refreshed_only_within_the_margin() -> void:
	await _login()
	var early: GetAccessTokenResult = await AuthCore.get_access_token()
	assert_true(early.ok)
	assert_eq(early.access_token, "access-201-token-a")
	assert_eq(Env.request_count("core/RefreshToken"), 0)
	Env.respond_refresh("access-new")
	UnitTestCore.advance_clock(Env.TOKEN_TTL_MS - MARGIN_MS, false)
	var late: GetAccessTokenResult = await AuthCore.get_access_token()
	assert_true(late.ok)
	assert_eq(late.access_token, "access-new")
	await UnitTestCore.wait_frames(3)
	assert_eq(Env.request_count("core/RefreshToken"), 1)


func test_frame_refresh_runs_during_a_pause_and_in_step_mode_with_budget_0() -> void:
	await _login()
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	TimeCore.set_paused(true)
	assert_true(tree.paused)
	Env.respond_refresh("access-paused")
	AuthCoreDev.expire_access_token()
	await UnitTestCore.wait_frames(5)
	assert_eq(Env.request_count("core/RefreshToken"), 1, "refreshed during the pause")
	TimeCore.set_paused(false)
	TimeCoreDev.set_step_mode(true)
	assert_true(tree.paused, "step mode with budget 0 stops the engine features")
	Env.respond_refresh("access-step")
	AuthCoreDev.expire_access_token()
	await UnitTestCore.wait_frames(5)
	assert_eq(Env.request_count("core/RefreshToken"), 2, "refreshed in step mode with budget 0")
	TimeCoreDev.set_step_mode(false)
	var token: GetAccessTokenResult = await AuthCore.get_access_token()
	assert_true(token.ok)
	assert_eq(token.access_token, "access-step")
	assert_eq(Env.request_count("core/RefreshToken"), 2)


func test_lookups_during_a_refresh_share_one_request() -> void:
	await _login()
	AuthCoreDev.expire_access_token()
	UnitTestCore.add_pending("core/RefreshToken")
	var flows: Array[Flow] = [_start_get_token(), _start_get_token(), _start_get_token()]
	await UnitTestCore.wait_frames(3)
	assert_eq(Env.request_count("core/RefreshToken"), 1)
	var response: CoreContract.RefreshTokenResponse = CoreContract.RefreshTokenResponse.new()
	response.access_token = "access-shared"
	response.access_token_expires_at = Env.SERVER_TIME + Env.TOKEN_TTL_MS
	assert_true(
		UnitTestCore.release_pending("core/RefreshToken", NetworkCore.TransferResult.DONE, 200, Env.envelope(response, 0, null))
	)
	for flow: Flow in flows:
		await flow.wait()
		var result: GetAccessTokenResult = flow.result as GetAccessTokenResult
		assert_true(result.ok)
		assert_eq(result.access_token, "access-shared")
	assert_eq(Env.request_count("core/RefreshToken"), 1)


func test_failed_frame_refresh_waits_for_foreground_and_each_foreground_refreshes_once() -> void:
	await _login()
	Env.respond_error("core/RefreshToken", CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST)
	AuthCoreDev.expire_access_token()
	await UnitTestCore.wait_frames(10)
	assert_eq(Env.request_count("core/RefreshToken"), 1)
	await UnitTestCore.wait_frames(10)
	assert_eq(Env.request_count("core/RefreshToken"), 1)
	# A network answers after the event that sent the request. The foreground refresh of AuthCore and the token of
	# the `Resync` of NetworkCore share one refresh.
	UnitTestCore.add_pending("core/RefreshToken")
	Env.respond("core/Resync", CoreContract.ResyncResponse.new())
	UnitTestCore.advance_clock(1000, true)
	await UnitTestCore.wait_frames(5)
	assert_eq(Env.request_count("core/RefreshToken"), 2)
	assert_true(
		UnitTestCore.release_pending(
			"core/RefreshToken", NetworkCore.TransferResult.DONE, 200, Env.envelope(Env.refresh_response("access-2"), 0, null)
		)
	)
	await UnitTestCore.wait_frames(5)
	assert_eq(Env.request_count("core/RefreshToken"), 2)
	Env.respond_refresh("access-3")
	Env.respond("core/Resync", CoreContract.ResyncResponse.new())
	UnitTestCore.advance_clock(1000, true)
	await UnitTestCore.wait_frames(5)
	assert_eq(Env.request_count("core/RefreshToken"), 3)


func test_refresh_unauthorized_ends_session_and_requests_restart_once() -> void:
	await _login()
	var removes: int = env.storage.count("remove")
	Env.respond_error("core/RefreshToken", CoreContract.CoreError.CORE_ERROR_UNAUTHORIZED)
	var result: GetAccessTokenResult = await AuthCore.refresh_access_token()
	assert_false(result.ok)
	assert_false(AuthCore.is_logged_in())
	assert_eq(env.storage.count("remove"), removes)
	assert_eq(env.stored_token(), "token-a")
	assert_eq(env.recorder.session_ends, PackedInt32Array([AuthCore.SessionEndReason.REJECTED]))
	assert_eq(env.recorder.restarts, 1)


func test_refresh_session_replaced_opens_one_popup_and_restarts_after_the_button() -> void:
	await _login()
	Env.respond_error("core/RefreshToken", CoreContract.CoreError.CORE_ERROR_SESSION_REPLACED)
	var result: GetAccessTokenResult = await AuthCore.refresh_access_token()
	assert_false(result.ok)
	await UnitTestCore.wait_frames(5)
	assert_false(AuthCore.is_logged_in())
	assert_eq(env.recorder.session_ends, PackedInt32Array([AuthCore.SessionEndReason.REPLACED]))
	assert_true(Env.shows(ReservedString.auth_session_replaced()))
	assert_eq(UICore.get_open_popup_count(), 1)
	assert_eq(env.recorder.restarts, 0)
	assert_eq(env.stored_token(), "token-a")
	assert_true(await Env.press(ReservedString.auth_go_to_title()))
	assert_eq(env.recorder.restarts, 1)


func test_refresh_session_replaced_keeps_the_pending_token() -> void:
	assert_true(await env.boot())
	env.storage.script("write", Storage.Status.FAILED)
	var result: LoginResult = await env.boot_auto(202, "token-old", "token-new")
	assert_eq(result.status, AuthCore.LoginStatus.SUCCESS)
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 1)
	assert_eq(AuthCore._pending_token, "token-new")
	Env.respond_error("core/RefreshToken", CoreContract.CoreError.CORE_ERROR_SESSION_REPLACED)
	var refreshed: GetAccessTokenResult = await AuthCore.refresh_access_token()
	assert_false(refreshed.ok)
	await UnitTestCore.wait_frames(5)
	assert_eq(env.recorder.session_ends, PackedInt32Array([AuthCore.SessionEndReason.REPLACED]))
	assert_eq(Env.request_header("core/RefreshToken", "Authorization"), "Bearer token-old")
	assert_eq(AuthCore._pending_token, "token-new")
	assert_eq(env.stored_token(), "token-old")
	var writes: int = env.storage.count("write")
	EventCore.publish(EventCore.acquire(AppBackgroundEnteredEvent))
	await UnitTestCore.wait_frames(3)
	assert_eq(env.storage.count("write"), writes + 1)
	assert_eq(env.stored_token(), "token-new")
	assert_eq(AuthCore._pending_token, "")


func test_two_session_replaced_notices_end_the_session_once() -> void:
	await _login()
	var provider: SessionProvider = AuthCore._provider
	provider.notify_session_replaced()
	provider.notify_session_replaced()
	await UnitTestCore.wait_frames(5)
	assert_eq(env.recorder.session_ends, PackedInt32Array([AuthCore.SessionEndReason.REPLACED]))
	assert_eq(UICore.get_open_popup_count(), 1)


func test_refresh_maintenance_fails_with_that_error_and_keeps_the_session() -> void:
	await _login()
	# The second answers the frame refresh that follows, since the token is still within the margin.
	Env.respond_error("core/RefreshToken", CoreContract.CoreError.CORE_ERROR_MAINTENANCE)
	Env.respond_error("core/RefreshToken", CoreContract.CoreError.CORE_ERROR_MAINTENANCE)
	AuthCoreDev.expire_access_token()
	var result: GetAccessTokenResult = await AuthCore.get_access_token()
	assert_false(result.ok)
	assert_eq(result.failure.kind, NetworkCore.FailureKind.SERVER_ERROR)
	assert_eq(result.failure.error_code, CoreContract.CoreError.CORE_ERROR_MAINTENANCE)
	await UnitTestCore.wait_frames(5)
	assert_eq(Env.request_count("core/RefreshToken"), 2)
	assert_true(AuthCore.is_logged_in())
	assert_eq(env.stored_token(), "token-a")
	assert_eq(env.recorder.session_ends.size(), 0)


func test_access_token_without_session_is_a_connection_failure() -> void:
	assert_true(await env.boot())
	var result: GetAccessTokenResult = await AuthCore.get_access_token()
	assert_false(result.ok)
	assert_eq(result.access_token, "")
	assert_eq(result.failure.kind, NetworkCore.FailureKind.CONNECTION_FAILED)
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 1)
