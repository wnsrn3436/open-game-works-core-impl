extends UnitTestCase
## `logout`, `withdraw`, `switch_account`, `link_account` and `issue_deletion_code`.

const Env := preload("res://core/auth_core/tests/support/auth_test_env.gd")
const Flow := preload("res://core/auth_core/tests/support/flow.gd")
const Storage := preload("res://core/auth_core/adapters/token_storage.gd")

var env: Env = null


func before_each() -> void:
	super()
	env = Env.new()


func after_each() -> void:
	env.finish()
	super()


func _login(user_id: int = 301, token: String = "token-a") -> void:
	assert_true(await env.boot())
	var result: LoginResult = await env.boot_guest(user_id, token)
	assert_eq(result.status, AuthCore.LoginStatus.SUCCESS)


func _terms_version() -> int:
	return LocalDataCore.get_value_int(LocalDataCore.FileKind.DEVICE, "AuthCore.terms_version", 0)


func _privacy_terms_version() -> int:
	return LocalDataCore.get_value_int(LocalDataCore.FileKind.DEVICE, "AuthCore.privacy_terms_version", 0)


func test_logout_removes_item_and_restarts_whatever_the_request_result() -> void:
	await _login()
	Env.respond_error("core/Logout", CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST)
	await AuthCore.logout()
	assert_eq(env.stored_text(), "")
	assert_false(AuthCore.is_logged_in())
	assert_eq(env.recorder.session_ends, PackedInt32Array([AuthCore.SessionEndReason.LOGOUT]))
	assert_eq(env.recorder.restarts, 1)
	assert_eq(_terms_version(), 1)
	assert_eq(_privacy_terms_version(), 1)


func test_withdraw_success_removes_versions_and_restarts() -> void:
	await _login()
	Env.respond("core/Withdraw", CoreContract.WithdrawResponse.new())
	assert_true(await AuthCore.withdraw())
	assert_eq(env.stored_text(), "")
	assert_eq(_terms_version(), 0)
	assert_eq(_privacy_terms_version(), 0)
	assert_eq(env.recorder.session_ends, PackedInt32Array([AuthCore.SessionEndReason.WITHDRAW]))
	assert_eq(env.recorder.restarts, 1)
	AuthCore.release()
	assert_true(env.start_auth())
	Env.respond_terms()
	var flow: Flow = Flow.new()
	flow.start(func(f: Flow) -> void:
		f.status = await AuthCore.prepare_terms()
		f.finish())
	assert_true(await Env.wait_popup("auth_test_terms"))
	UICore.close_all_popups()
	await flow.wait()
	assert_eq(flow.status, AuthCore.TermsStatus.REFUSED)


func test_withdraw_failure_changes_nothing() -> void:
	await _login()
	Env.respond_error("core/Withdraw", CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST)
	assert_false(await AuthCore.withdraw())
	assert_eq(AuthCore.get_user_id(), 301)
	assert_eq(env.stored_token(), "token-a")
	assert_eq(_terms_version(), 1)
	assert_eq(_privacy_terms_version(), 1)
	assert_eq(env.recorder.restarts, 0)


func test_switch_account_cancel_and_login_failure_change_nothing() -> void:
	await _login()
	env.google.scripted = [SocialAdapter.SignInStatus.CANCELLED]
	var cancelled: LoginResult = await AuthCore.switch_account(CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE)
	assert_eq(cancelled.status, AuthCore.LoginStatus.CANCELLED)
	Env.respond_error("core/Login", CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST)
	var failed: LoginResult = await AuthCore.switch_account(CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE)
	assert_eq(failed.status, AuthCore.LoginStatus.FAILED)
	assert_eq(AuthCore.get_user_id(), 301)
	assert_eq(env.stored_token(), "token-a")
	assert_eq(env.recorder.restarts, 0)
	assert_eq(env.recorder.session_ends.size(), 0)


func test_switch_account_success_restarts_then_returns_new_user_while_session_is_old() -> void:
	await _login()
	Env.respond_login(302, "token-b")
	var result: LoginResult = await AuthCore.switch_account(CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE)
	assert_eq(result.status, AuthCore.LoginStatus.SUCCESS)
	assert_eq(result.user_id, 302)
	assert_eq(result.public_code, Env.public_code(302))
	assert_eq(AuthCore.get_public_code(), Env.public_code(301))
	assert_eq(env.recorder.order.slice(-2), PackedStringArray(["SessionEnded", "RestartRequested"]))
	assert_eq(env.recorder.session_ends, PackedInt32Array([AuthCore.SessionEndReason.SWITCH]))
	assert_eq(env.recorder.restarts, 1)
	assert_eq(AuthCore.get_user_id(), 301)
	assert_eq(env.stored_token(), "token-b")
	Env.respond_refresh("access-x")
	var refreshed: GetAccessTokenResult = await AuthCore.refresh_access_token()
	assert_true(refreshed.ok)
	assert_eq(Env.request_header("core/RefreshToken", "Authorization"), "Bearer token-a")


func test_switch_account_write_failure_fails_and_restart_auto_logs_in_previous_account() -> void:
	await _login()
	env.storage.script("write", Storage.Status.FAILED)
	Env.respond_login(303, "token-b")
	var result: LoginResult = await AuthCore.switch_account(CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE)
	assert_eq(result.status, AuthCore.LoginStatus.FAILED)
	assert_eq(env.stored_token(), "token-a")
	assert_eq(env.recorder.session_ends, PackedInt32Array([AuthCore.SessionEndReason.SWITCH]))
	assert_eq(env.recorder.restarts, 1)
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 1)
	AuthCore.release()
	assert_true(env.start_auth())
	Env.respond_terms()
	Env.respond_auto_login(301, "token-c")
	var again: LoginResult = await AuthCore.boot_login()
	assert_eq(again.user_id, 301)
	assert_eq(Env.request_header("core/AutoLogin", "Authorization"), "Bearer token-a")


func test_link_account_already_linked_keeps_providers() -> void:
	assert_true(await env.boot())
	Env.agree_terms()
	Env.respond_terms()
	var login: CoreContract.LoginResponse = CoreContract.LoginResponse.new()
	login.result = Env.auth_result(301, "token-a")
	login.result.linked_providers = PackedInt32Array([CoreContract.LoginProvider.LOGIN_PROVIDER_APPLE])
	Env.respond("core/Login", login)
	var result: LoginResult = await AuthCore.boot_login()
	assert_eq(result.status, AuthCore.LoginStatus.SUCCESS)
	assert_eq(env.stored_linked(), "[\"LOGIN_PROVIDER_APPLE\"]")
	var writes: int = env.storage.count("write")
	Env.respond_error("core/LinkAccount", CoreContract.CoreError.CORE_ERROR_ALREADY_LINKED)
	var status: AuthCore.LinkStatus = await AuthCore.link_account(CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE)
	assert_eq(status, AuthCore.LinkStatus.ALREADY_LINKED)
	var buffer: PackedInt32Array = PackedInt32Array([0, 0, 0])
	assert_eq(AuthCore.list_linked_providers(buffer), 1)
	assert_eq(buffer[0], CoreContract.LoginProvider.LOGIN_PROVIDER_APPLE)
	assert_eq(env.storage.count("write"), writes)
	assert_eq(env.stored_linked(), "[\"LOGIN_PROVIDER_APPLE\"]")
	assert_eq(UICore.get_open_popup_count(), 0)


func test_link_account_success_writes_linked_providers() -> void:
	await _login()
	var response: CoreContract.LinkAccountResponse = CoreContract.LinkAccountResponse.new()
	response.linked_providers = PackedInt32Array([CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE])
	Env.respond("core/LinkAccount", response)
	var status: AuthCore.LinkStatus = await AuthCore.link_account(CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE)
	assert_eq(status, AuthCore.LinkStatus.SUCCESS)
	assert_eq(env.stored_linked(), "[\"LOGIN_PROVIDER_GOOGLE\"]")
	var buffer: PackedInt32Array = PackedInt32Array([0, 0])
	assert_eq(AuthCore.list_linked_providers(buffer), 1)
	assert_eq(buffer[0], CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE)


func test_list_linked_providers_fills_the_buffer_from_0_without_resizing_it() -> void:
	assert_true(await env.boot())
	Env.agree_terms()
	Env.respond_terms()
	var login: CoreContract.LoginResponse = CoreContract.LoginResponse.new()
	login.result = Env.auth_result(301, "token-a")
	login.result.linked_providers = PackedInt32Array(
		[CoreContract.LoginProvider.LOGIN_PROVIDER_APPLE, CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE]
	)
	Env.respond("core/Login", login)
	var result: LoginResult = await AuthCore.boot_login()
	assert_eq(result.status, AuthCore.LoginStatus.SUCCESS)
	var buffer: PackedInt32Array = PackedInt32Array([-1, -1, -1])
	assert_eq(AuthCore.list_linked_providers(buffer), 2)
	assert_eq(
		buffer,
		PackedInt32Array(
			[CoreContract.LoginProvider.LOGIN_PROVIDER_APPLE, CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE, -1]
		)
	)
	var small: PackedInt32Array = PackedInt32Array([-1])
	assert_eq(AuthCore.list_linked_providers(small), 1)
	assert_eq(small, PackedInt32Array([CoreContract.LoginProvider.LOGIN_PROVIDER_APPLE]))
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 1, "the buffer is too small")
	var empty: PackedInt32Array = PackedInt32Array()
	assert_eq(AuthCore.list_linked_providers(empty), 0)
	assert_eq(empty.size(), 0)
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 1, "the buffer is too small")


func test_pending_token_is_written_with_the_providers_link_account_changed() -> void:
	assert_true(await env.boot())
	env.storage.script("write", Storage.Status.FAILED)
	var result: LoginResult = await env.boot_auto(304, "token-old", "token-new")
	assert_eq(result.status, AuthCore.LoginStatus.SUCCESS)
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 1)
	var response: CoreContract.LinkAccountResponse = CoreContract.LinkAccountResponse.new()
	response.linked_providers = PackedInt32Array([CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE])
	Env.respond("core/LinkAccount", response)
	env.storage.script("write", Storage.Status.FAILED)
	var status: AuthCore.LinkStatus = await AuthCore.link_account(CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE)
	assert_eq(status, AuthCore.LinkStatus.SUCCESS)
	# The failed write and the failed rewrite of `link_account`.
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 2)
	assert_eq(env.stored_token(), "token-old")
	EventCore.publish(EventCore.acquire(AppBackgroundEnteredEvent))
	await UnitTestCore.wait_frames(3)
	assert_eq(env.stored_token(), "token-new")
	assert_eq(env.stored_linked(), "[\"LOGIN_PROVIDER_GOOGLE\"]")


func test_guest_link_and_switch_fail_without_request() -> void:
	await _login()
	var link: AuthCore.LinkStatus = await AuthCore.link_account(CoreContract.LoginProvider.LOGIN_PROVIDER_GUEST)
	var switched: LoginResult = await AuthCore.switch_account(CoreContract.LoginProvider.LOGIN_PROVIDER_GUEST)
	assert_eq(link, AuthCore.LinkStatus.FAILED)
	assert_eq(switched.status, AuthCore.LoginStatus.FAILED)
	assert_eq(Env.request_count("core/LinkAccount"), 0)
	assert_eq(Env.request_count("core/Login"), 1)
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 2)


func test_issue_deletion_code_returns_the_response() -> void:
	await _login()
	var response: CoreContract.IssueDeletionCodeResponse = CoreContract.IssueDeletionCodeResponse.new()
	response.code = "ABCDE12345"
	response.expires_at = Env.SERVER_TIME + 3600000
	response.url = "https://example.com/account/deletion"
	Env.respond("core/IssueDeletionCode", response)
	var result: DeletionCodeResult = await AuthCore.issue_deletion_code()
	assert_true(result.ok)
	assert_eq(result.code, "ABCDE12345")
	assert_eq(result.expires_at, Env.SERVER_TIME + 3600000)
	assert_eq(result.url, "https://example.com/account/deletion")
	assert_eq(Env.request_count("core/IssueDeletionCode"), 1)
	Env.respond_error("core/IssueDeletionCode", CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST)
	var failed: DeletionCodeResult = await AuthCore.issue_deletion_code()
	assert_false(failed.ok)
	assert_eq(failed.code, "")
	assert_eq(failed.expires_at, 0)


func test_issue_deletion_code_without_session_fails_without_request() -> void:
	assert_true(await env.boot())
	var result: DeletionCodeResult = await AuthCore.issue_deletion_code()
	assert_false(result.ok)
	assert_eq(Env.request_count("core/IssueDeletionCode"), 0)
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 1)


func test_ban_session_signs_the_deletion_code_request_and_ends_at_login_and_release() -> void:
	assert_true(await env.boot())
	var ban: CoreContract.BanDetail = CoreContract.BanDetail.new()
	ban.user_id = 311
	ban.access_token = "ban-access"
	ban.session_signing_key = "ban-key"
	Env.mark_installed()
	Env.agree_terms()
	env.store("token-a")
	Env.respond_terms()
	Env.respond_error("core/AutoLogin", CoreContract.CoreError.CORE_ERROR_BANNED, ban)
	var result: LoginResult = await AuthCore.boot_login()
	assert_eq(result.status, AuthCore.LoginStatus.BANNED)
	assert_false(AuthCore.is_logged_in())
	var response: CoreContract.IssueDeletionCodeResponse = CoreContract.IssueDeletionCodeResponse.new()
	response.code = "CODE"
	Env.respond("core/IssueDeletionCode", response)
	var code: DeletionCodeResult = await AuthCore.issue_deletion_code()
	assert_true(code.ok)
	assert_eq(Env.request_count("core/IssueDeletionCode"), 1)
	assert_eq(Env.request_header("core/IssueDeletionCode", "Authorization"), "Bearer ban-access")
	assert_ne(Env.request_header("core/IssueDeletionCode", "X-Ogw-Signature"), "")
	assert_eq(
		Env.request_header("core/IssueDeletionCode", "X-Ogw-Signature"),
		Env.expected_signature("ban-key", "core/IssueDeletionCode")
	)
	AuthCore.release()
	assert_true(env.start_auth())
	var after_release: DeletionCodeResult = await AuthCore.issue_deletion_code()
	assert_false(after_release.ok)
	assert_eq(Env.request_count("core/IssueDeletionCode"), 1)
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 1)


func test_ban_session_ends_at_login_success() -> void:
	assert_true(await env.boot())
	var ban: CoreContract.BanDetail = CoreContract.BanDetail.new()
	ban.user_id = 312
	ban.access_token = "ban-access"
	ban.session_signing_key = "ban-key"
	Env.agree_terms()
	Env.respond_terms()
	assert_eq(await AuthCore.prepare_terms(), AuthCore.TermsStatus.AGREED)
	Env.respond_error("core/Login", CoreContract.CoreError.CORE_ERROR_BANNED, ban)
	var banned: LoginResult = await AuthCore.login(CoreContract.LoginProvider.LOGIN_PROVIDER_GUEST)
	assert_eq(banned.status, AuthCore.LoginStatus.BANNED)
	Env.respond_login(313, "token-a")
	var result: LoginResult = await AuthCore.login(CoreContract.LoginProvider.LOGIN_PROVIDER_GUEST)
	assert_eq(result.status, AuthCore.LoginStatus.SUCCESS)
	assert_null(AuthCore._ban_session)
