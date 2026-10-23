extends UnitTestCase
## `boot_login`, `login`, auto login, account recovery, the install marker and the login success order.

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


func _start_boot_login() -> Flow:
	var flow: Flow = Flow.new()
	flow.start(func(f: Flow) -> void:
		f.result = await AuthCore.boot_login()
		f.finish())
	await UnitTestCore.wait_frames(5)
	return flow


func _status(flow: Flow) -> AuthCore.LoginStatus:
	var result: LoginResult = flow.result as LoginResult
	return result.status if result != null else AuthCore.LoginStatus.FAILED


func test_boot_login_without_storage_item_logs_in_as_new_guest() -> void:
	assert_true(await env.boot())
	Env.mark_installed()
	var result: LoginResult = await env.boot_guest(21, "token-a")
	assert_eq(result.status, AuthCore.LoginStatus.SUCCESS)
	assert_eq(result.user_id, 21)
	assert_eq(Env.request_count("core/AutoLogin"), 0)
	var request: CoreContract.LoginRequest = CoreContract.LoginRequest.new()
	assert_true(request.decode(Env.request_body("core/Login")))
	assert_eq(request.provider, CoreContract.LoginProvider.LOGIN_PROVIDER_GUEST)
	assert_eq(request.credential, "")
	assert_eq(env.stored_token(), "token-a")


func test_storage_denied_fails_without_request() -> void:
	await _assert_storage_read_failure(Storage.Status.DENIED)


func test_storage_failed_fails_without_request() -> void:
	await _assert_storage_read_failure(Storage.Status.FAILED)


func _assert_storage_read_failure(status: Storage.Status) -> void:
	assert_true(await env.boot())
	Env.mark_installed()
	Env.agree_terms()
	Env.respond_terms()
	env.storage.script("read", status)
	var result: LoginResult = await AuthCore.boot_login()
	assert_eq(result.status, AuthCore.LoginStatus.FAILED)
	assert_eq(Env.request_count("core/AutoLogin"), 0)
	assert_eq(Env.request_count("core/Login"), 0)
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 1)


func test_rejected_auto_login_keeps_item_and_opens_recovery_with_linked_provider() -> void:
	assert_true(await env.boot())
	Env.mark_installed()
	Env.agree_terms()
	env.store("token-old", PackedStringArray(["LOGIN_PROVIDER_GOOGLE"]))
	Env.respond_terms()
	Env.respond_error("core/AutoLogin", CoreContract.CoreError.CORE_ERROR_UNAUTHORIZED)
	var flow: Flow = await _start_boot_login()
	assert_false(flow.finished)
	assert_eq(env.stored_token(), "token-old")
	assert_eq(Env.request_count("core/Login"), 0)
	assert_true(Env.shows(ReservedString.auth_recover_linked()))
	assert_not_null(Env.find_button(ReservedString.auth_recover_login_google()))
	assert_not_null(Env.find_button(ReservedString.auth_recover_new()))
	Env.respond_login(31, "token-new")
	assert_true(await Env.press(ReservedString.auth_recover_login_google()))
	await flow.wait()
	assert_eq(_status(flow), AuthCore.LoginStatus.SUCCESS)
	assert_eq(env.google.sign_in_count, 1)


func test_rejected_auto_login_without_usable_provider_shows_only_new_start() -> void:
	env.adapters.erase(CoreContract.LoginProvider.LOGIN_PROVIDER_APPLE)
	assert_true(await env.boot())
	Env.mark_installed()
	Env.agree_terms()
	env.store("token-old", PackedStringArray(["LOGIN_PROVIDER_APPLE"]))
	Env.respond_terms()
	Env.respond_error("core/AutoLogin", CoreContract.CoreError.CORE_ERROR_UNAUTHORIZED)
	var flow: Flow = await _start_boot_login()
	assert_true(Env.shows(ReservedString.auth_recover_guest()))
	assert_null(Env.find_button(ReservedString.auth_recover_login_apple()))
	assert_not_null(Env.find_button(ReservedString.auth_recover_new()))
	UICore.close_all_popups()
	await UnitTestCore.wait_frames(5)
	assert_false(flow.finished)
	assert_eq(env.storage.count("remove"), 0)
	AuthCore.release()
	await flow.wait()


func test_unreadable_item_opens_recovery_without_auto_login() -> void:
	assert_true(await env.boot())
	Env.mark_installed()
	Env.agree_terms()
	env.storage.items[Env.SCOPE] = "not json"
	Env.respond_terms()
	var flow: Flow = await _start_boot_login()
	assert_eq(Env.request_count("core/AutoLogin"), 0)
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 1)
	assert_true(Env.shows(ReservedString.auth_recover_guest()))
	assert_eq(env.stored_text(), "not json")
	assert_true(await Env.press(ReservedString.auth_recover_new()))
	assert_eq(env.stored_text(), "not json")
	Env.respond_login(41, "token-new")
	assert_true(await Env.press(ReservedString.auth_recover_new_ok()))
	await flow.wait()
	assert_eq(_status(flow), AuthCore.LoginStatus.SUCCESS)
	assert_eq(env.stored_token(), "token-new")


func test_item_without_token_and_bad_linked_element_offers_google_with_one_warn() -> void:
	env.platform = "android"
	assert_true(await env.boot())
	Env.mark_installed()
	Env.agree_terms()
	env.storage.items[Env.SCOPE] = "{\"linked_providers\":[\"LOGIN_PROVIDER_GOOGLE\",7]}"
	Env.respond_terms()
	var flow: Flow = await _start_boot_login()
	assert_true(AuthCore.is_provider_supported(CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE))
	assert_not_null(Env.find_button(ReservedString.auth_recover_login_google()))
	assert_eq(UnitTestCore.check_logs("warn", "AuthCore"), 1)
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 1)
	assert_false(flow.finished)
	AuthCore.release()
	await flow.wait()


func test_new_start_only_after_ok_and_back_or_cancel_reopen_recovery() -> void:
	assert_true(await env.boot())
	Env.mark_installed()
	Env.agree_terms()
	env.store("token-old", PackedStringArray(["LOGIN_PROVIDER_GOOGLE"]))
	Env.respond_terms()
	Env.respond_error("core/AutoLogin", CoreContract.CoreError.CORE_ERROR_TOKEN_EXPIRED)
	var flow: Flow = await _start_boot_login()
	assert_true(await Env.press(ReservedString.auth_recover_new()))
	assert_true(Env.shows(ReservedString.auth_recover_new_confirm()))
	assert_true(await Env.press(ReservedString.auth_recover_back()))
	assert_true(Env.shows(ReservedString.auth_recover_linked()))
	env.google.scripted = [SocialAdapter.SignInStatus.CANCELLED]
	assert_true(await Env.press(ReservedString.auth_recover_login_google()))
	await UnitTestCore.wait_frames(3)
	assert_true(Env.shows(ReservedString.auth_recover_linked()))
	assert_eq(Env.request_count("core/Login"), 0)
	assert_eq(env.stored_token(), "token-old")
	assert_true(await Env.press(ReservedString.auth_recover_new()))
	Env.respond_login(51, "token-new")
	assert_true(await Env.press(ReservedString.auth_recover_new_ok()))
	await flow.wait()
	assert_eq(_status(flow), AuthCore.LoginStatus.SUCCESS)
	assert_eq(env.storage.count("remove"), 1)
	var request: CoreContract.LoginRequest = CoreContract.LoginRequest.new()
	assert_true(request.decode(Env.request_body("core/Login")))
	assert_eq(request.provider, CoreContract.LoginProvider.LOGIN_PROVIDER_GUEST)


func test_recovery_popups_closed_by_close_all_popups_open_again() -> void:
	assert_true(await env.boot())
	Env.mark_installed()
	Env.agree_terms()
	env.store("token-old")
	Env.respond_terms()
	Env.respond_error("core/AutoLogin", CoreContract.CoreError.CORE_ERROR_UNAUTHORIZED)
	var flow: Flow = await _start_boot_login()
	UICore.close_all_popups()
	await UnitTestCore.wait_frames(5)
	assert_true(Env.shows(ReservedString.auth_recover_guest()))
	assert_true(await Env.press(ReservedString.auth_recover_new()))
	UICore.close_all_popups()
	await UnitTestCore.wait_frames(5)
	assert_true(Env.shows(ReservedString.auth_recover_guest()))
	assert_eq(env.storage.count("remove"), 0)
	assert_false(flow.finished)
	AuthCore.release()
	await flow.wait()
	assert_eq(_status(flow), AuthCore.LoginStatus.FAILED)


func test_missing_install_marker_removes_item_and_writes_marker() -> void:
	assert_true(await env.boot())
	env.store("token-old")
	var result: LoginResult = await env.boot_guest(61, "token-new")
	assert_eq(result.status, AuthCore.LoginStatus.SUCCESS)
	assert_eq(env.storage.count("remove"), 1)
	assert_eq(Env.request_count("core/AutoLogin"), 0)
	assert_true(LocalDataCore.read_file("auth/installed", 1).ok)


func test_install_marker_keeps_item() -> void:
	assert_true(await env.boot())
	var result: LoginResult = await env.boot_auto(62, "token-old", "token-new")
	assert_eq(result.status, AuthCore.LoginStatus.SUCCESS)
	assert_eq(env.storage.count("remove"), 0)
	assert_eq(Env.request_header("core/AutoLogin", "Authorization"), "Bearer token-old")


func test_install_marker_read_failure_keeps_item_and_fails() -> void:
	assert_true(await env.boot())
	assert_true(LocalDataCore.write_file("auth/installed", PackedByteArray([0x31, 0x31])).ok)
	env.store("token-old")
	Env.agree_terms()
	var result: LoginResult = await AuthCore.boot_login()
	assert_eq(result.status, AuthCore.LoginStatus.FAILED)
	assert_eq(env.storage.count("remove"), 0)
	assert_eq(env.stored_token(), "token-old")
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 1)


func test_refused_terms_popup_opens_again() -> void:
	assert_true(await env.boot())
	Env.mark_installed()
	Env.respond_terms(2)
	Env.respond_terms(2)
	var flow: Flow = await _start_boot_login()
	assert_true(await Env.wait_popup("auth_test_terms"))
	assert_true(await Env.tap("auth_test_terms_confirm"))
	await UnitTestCore.wait_frames(5)
	assert_eq(Env.request_count("core/GetTerms"), 2)
	assert_true(await Env.wait_popup("auth_test_terms"))
	assert_false(flow.finished)
	AuthCore.release()
	await flow.wait()
	assert_eq(_status(flow), AuthCore.LoginStatus.FAILED)
	assert_eq(Env.request_count("core/Login") + Env.request_count("core/AutoLogin"), 0)


func test_consent_required_twice_returns_consent_required() -> void:
	assert_true(await env.boot())
	Env.agree_terms()
	Env.respond_terms()
	Env.respond_error("core/Login", CoreContract.CoreError.CORE_ERROR_CONSENT_REQUIRED)
	Env.respond_terms()
	Env.respond_error("core/Login", CoreContract.CoreError.CORE_ERROR_CONSENT_REQUIRED)
	var result: LoginResult = await AuthCore.boot_login()
	assert_eq(result.status, AuthCore.LoginStatus.CONSENT_REQUIRED)
	assert_eq(Env.request_count("core/GetTerms"), 2)
	assert_eq(Env.request_count("core/Login"), 2)


func test_server_errors_map_to_login_status_and_ban_detail() -> void:
	assert_true(await env.boot())
	Env.agree_terms()
	Env.respond_terms()
	assert_eq(await AuthCore.prepare_terms(), AuthCore.TermsStatus.AGREED)
	Env.respond_error("core/Login", CoreContract.CoreError.CORE_ERROR_CONSENT_REQUIRED)
	var consent: LoginResult = await AuthCore.login(CoreContract.LoginProvider.LOGIN_PROVIDER_GUEST)
	assert_eq(consent.status, AuthCore.LoginStatus.CONSENT_REQUIRED)
	var ban: CoreContract.BanDetail = CoreContract.BanDetail.new()
	ban.user_id = 71
	ban.until_at = Env.SERVER_TIME + 5000
	ban.deletion_url = "https://example.com/account/deletion"
	Env.respond_error("core/Login", CoreContract.CoreError.CORE_ERROR_BANNED, ban)
	var banned: LoginResult = await AuthCore.login(CoreContract.LoginProvider.LOGIN_PROVIDER_GUEST)
	assert_eq(banned.status, AuthCore.LoginStatus.BANNED)
	assert_eq(banned.user_id, 71)
	assert_eq(banned.ban_until_at, Env.SERVER_TIME + 5000)
	assert_eq(banned.deletion_url, "https://example.com/account/deletion")
	Env.respond_error("core/Login", CoreContract.CoreError.CORE_ERROR_AGE_BELOW_MINIMUM)
	var age: LoginResult = await AuthCore.login(CoreContract.LoginProvider.LOGIN_PROVIDER_GUEST)
	assert_eq(age.status, AuthCore.LoginStatus.AGE_BLOCKED)
	Env.respond_error("core/Login", CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST)
	var other: LoginResult = await AuthCore.login(CoreContract.LoginProvider.LOGIN_PROVIDER_GUEST)
	assert_eq(other.status, AuthCore.LoginStatus.FAILED)
	assert_eq(other.error_code, CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST)


func test_social_sign_in_cancel_and_failure_send_nothing() -> void:
	assert_true(await env.boot())
	Env.agree_terms()
	Env.respond_terms()
	assert_eq(await AuthCore.prepare_terms(), AuthCore.TermsStatus.AGREED)
	env.google.scripted = [SocialAdapter.SignInStatus.CANCELLED, SocialAdapter.SignInStatus.FAILED]
	var cancelled: LoginResult = await AuthCore.login(CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE)
	var failed: LoginResult = await AuthCore.login(CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE)
	assert_eq(cancelled.status, AuthCore.LoginStatus.CANCELLED)
	assert_eq(failed.status, AuthCore.LoginStatus.FAILED)
	assert_eq(Env.request_count("core/Login"), 0)


func test_no_token_in_app_storage_files_after_login() -> void:
	assert_true(await env.boot())
	var result: LoginResult = await env.boot_guest(81, "token-secret-81")
	assert_eq(result.status, AuthCore.LoginStatus.SUCCESS)
	LocalDataCore.flush()
	# `list_log_files` writes the LogCore write buffer to the log file first.
	var logs: PackedStringArray = LogCoreDev.list_log_files()
	assert_gt(logs.size(), 0)
	var texts: Dictionary[String, String] = {}
	_read_files(CoreBuildInfo.storage_root, texts)
	for log_path: String in logs:
		assert_true(texts.has(CoreBuildInfo.storage_root.path_join(log_path)))
	for path: String in texts:
		assert_false(texts[path].contains("token-secret-81"))
		assert_false(texts[path].contains("access-81-token-secret-81"))


## Texts of the files under `folder` by path.
func _read_files(folder: String, out: Dictionary[String, String]) -> void:
	var dir: DirAccess = DirAccess.open(folder)
	if dir == null:
		return
	for file: String in dir.get_files():
		var path: String = folder.path_join(file)
		out[path] = FileAccess.get_file_as_bytes(path).get_string_from_ascii()
	for child: String in dir.get_directories():
		_read_files(folder.path_join(child), out)


func test_release_and_init_auto_login_the_same_user_without_popup() -> void:
	assert_true(await env.boot())
	var first: LoginResult = await env.boot_guest(91, "token-a")
	assert_eq(first.status, AuthCore.LoginStatus.SUCCESS)
	AuthCore.release()
	assert_true(env.start_auth())
	Env.respond_terms()
	Env.respond_auto_login(91, "token-b")
	var again: LoginResult = await AuthCore.boot_login()
	assert_eq(again.status, AuthCore.LoginStatus.SUCCESS)
	assert_eq(again.user_id, 91)
	assert_eq(Env.request_header("core/AutoLogin", "Authorization"), "Bearer token-a")
	assert_eq(UICore.get_open_popups().size(), 0)


func test_login_success_order() -> void:
	assert_true(await env.boot())
	Env.agree_terms()
	Env.respond_terms()
	assert_eq(await AuthCore.prepare_terms(), AuthCore.TermsStatus.AGREED)
	Env.respond_login(101, "token-a")
	Env.respond("core/Resync", CoreContract.ResyncResponse.new())
	env.storage.hold = true
	var flow: Flow = Flow.new()
	flow.start(func(f: Flow) -> void:
		f.result = await AuthCore.login(CoreContract.LoginProvider.LOGIN_PROVIDER_GUEST)
		f.finish())
	await UnitTestCore.wait_frames(5)
	assert_eq(env.storage.count("write"), 1)
	assert_false(AuthCore.is_logged_in())
	assert_eq(env.recorder.logins.size(), 0)
	env.recorder.on_login = func() -> void:
		NetworkCore.resync()
	env.storage.release_held()
	await flow.wait()
	assert_eq(_status(flow), AuthCore.LoginStatus.SUCCESS)
	assert_eq(env.recorder.logins, PackedInt64Array([101]))
	assert_true(env.recorder.logged_in_at_login)
	await UnitTestCore.wait_frames(5)
	assert_eq(Env.request_header("core/Resync", "Authorization"), "Bearer access-101-token-a")


func test_login_token_write_failure_keeps_previous_state() -> void:
	assert_true(await env.boot())
	Env.agree_terms()
	Env.respond_terms()
	assert_eq(await AuthCore.prepare_terms(), AuthCore.TermsStatus.AGREED)
	env.store("token-old")
	env.storage.script("write", Storage.Status.FAILED)
	Env.respond_login(111, "token-a")
	var result: LoginResult = await AuthCore.login(CoreContract.LoginProvider.LOGIN_PROVIDER_GUEST)
	assert_eq(result.status, AuthCore.LoginStatus.FAILED)
	assert_false(AuthCore.is_logged_in())
	assert_eq(env.stored_token(), "token-old")
	assert_eq(env.recorder.restarts, 0)
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 1)


func test_auto_login_write_failure_keeps_pending_token() -> void:
	assert_true(await env.boot())
	env.storage.script("write", Storage.Status.FAILED)
	var result: LoginResult = await env.boot_auto(121, "token-old", "token-new")
	assert_eq(result.status, AuthCore.LoginStatus.SUCCESS)
	assert_eq(env.stored_token(), "token-old")
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 1)
	Env.respond_refresh("access-2")
	var before: GetAccessTokenResult = await AuthCore.refresh_access_token()
	assert_true(before.ok)
	assert_eq(Env.request_header("core/RefreshToken", "Authorization", 0), "Bearer token-old")
	await UnitTestCore.wait_frames(3)
	assert_eq(env.stored_token(), "token-new")
	Env.respond_refresh("access-3")
	var after: GetAccessTokenResult = await AuthCore.refresh_access_token()
	assert_true(after.ok)
	assert_eq(Env.request_header("core/RefreshToken", "Authorization", 1), "Bearer token-new")


func test_pending_token_is_written_on_background() -> void:
	assert_true(await env.boot())
	env.storage.script("write", Storage.Status.FAILED)
	var result: LoginResult = await env.boot_auto(122, "token-old", "token-new")
	assert_eq(result.status, AuthCore.LoginStatus.SUCCESS)
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 1)
	assert_eq(env.stored_token(), "token-old")
	var writes: int = env.storage.count("write")
	EventCore.publish(EventCore.acquire(AppBackgroundEnteredEvent))
	await UnitTestCore.wait_frames(3)
	assert_eq(env.storage.count("write"), writes + 1)
	assert_eq(env.stored_token(), "token-new")
	assert_eq(AuthCore._pending_token, "")
	assert_eq(Env.request_count("core/RefreshToken"), 0)


func test_pending_token_is_written_on_foreground() -> void:
	assert_true(await env.boot())
	env.storage.script("write", Storage.Status.FAILED)
	env.storage.script("write", Storage.Status.FAILED)
	var result: LoginResult = await env.boot_auto(123, "token-old", "token-new")
	assert_eq(result.status, AuthCore.LoginStatus.SUCCESS)
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 1)
	var writes: int = env.storage.count("write")
	EventCore.publish(EventCore.acquire(AppBackgroundEnteredEvent))
	await UnitTestCore.wait_frames(3)
	assert_eq(env.storage.count("write"), writes + 1)
	assert_eq(env.stored_token(), "token-old")
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 1)
	# The foreground refresh fails, so only the foreground return writes the pending token.
	Env.respond_error("core/RefreshToken", CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST)
	Env.respond("core/Resync", CoreContract.ResyncResponse.new())
	EventCore.publish(EventCore.acquire(AppForegroundReturnedEvent))
	await UnitTestCore.wait_frames(5)
	assert_eq(Env.request_count("core/RefreshToken"), 1)
	assert_eq(env.storage.count("write"), writes + 2)
	assert_eq(env.stored_token(), "token-new")
	assert_eq(AuthCore._pending_token, "")
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 0)


func test_pending_token_survives_release_and_auto_login_uses_it() -> void:
	assert_true(await env.boot())
	env.storage.script("write", Storage.Status.FAILED)
	env.storage.script("write", Storage.Status.FAILED)
	var result: LoginResult = await env.boot_auto(131, "token-old", "token-new")
	assert_eq(result.status, AuthCore.LoginStatus.SUCCESS)
	AuthCore.release()
	await UnitTestCore.wait_frames(2)
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 1)
	assert_true(env.start_auth())
	Env.respond_terms()
	Env.respond_auto_login(131, "token-next")
	var again: LoginResult = await AuthCore.boot_login()
	assert_eq(again.status, AuthCore.LoginStatus.SUCCESS)
	assert_eq(Env.request_header("core/AutoLogin", "Authorization", 1), "Bearer token-new")


func test_login_with_session_fails_without_request() -> void:
	assert_true(await env.boot())
	var first: LoginResult = await env.boot_guest(141, "token-a")
	assert_eq(first.status, AuthCore.LoginStatus.SUCCESS)
	var again: LoginResult = await AuthCore.login(CoreContract.LoginProvider.LOGIN_PROVIDER_GUEST)
	assert_eq(again.status, AuthCore.LoginStatus.FAILED)
	assert_eq(Env.request_count("core/Login"), 1)
	assert_eq(AuthCore.get_user_id(), 141)
	assert_eq(env.stored_token(), "token-a")
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 1)
