extends UnitTestCase
## DEV operations: dev login, the fake social adapter, access token expiry and where DEV code lives.

const Env := preload("res://core/auth_core/tests/support/auth_test_env.gd")

var env: Env = null


func before_each() -> void:
	super()
	env = Env.new()


func after_each() -> void:
	env.finish()
	super()


func _respond_dev_login(user_id: int, token: String) -> void:
	var response: CoreCheatContract.DevLoginResponse = CoreCheatContract.DevLoginResponse.new()
	response.result = Env.auth_result(user_id, token)
	Env.respond("core/cheat/DevLogin", response)


func test_dev_login_does_not_touch_the_storage_item() -> void:
	assert_true(await env.boot())
	env.store("token-old")
	_respond_dev_login(601, "token-dev")
	var result: LoginResult = await AuthCoreDev.dev_login("alice")
	assert_eq(result.status, AuthCore.LoginStatus.SUCCESS)
	assert_eq(result.user_id, 601)
	assert_eq(env.storage.calls.size(), 0)
	assert_eq(env.stored_token(), "token-old")
	assert_eq(env.recorder.logins, PackedInt64Array([601]))
	var request: CoreCheatContract.DevLoginRequest = CoreCheatContract.DevLoginRequest.new()
	assert_true(request.decode(Env.request_body("core/cheat/DevLogin")))
	assert_eq(request.account_name, "alice")


func test_expired_dev_login_token_refreshes_with_the_dev_login_token() -> void:
	assert_true(await env.boot())
	_respond_dev_login(602, "token-dev")
	var login: LoginResult = await AuthCoreDev.dev_login("bob")
	assert_eq(login.status, AuthCore.LoginStatus.SUCCESS)
	AuthCoreDev.expire_access_token()
	Env.respond_refresh("access-refreshed")
	var token: GetAccessTokenResult = await AuthCore.get_access_token()
	assert_true(token.ok)
	assert_eq(token.access_token, "access-refreshed")
	assert_eq(Env.request_header("core/RefreshToken", "Authorization"), "Bearer token-dev")
	assert_eq(env.storage.count("read"), 0)


func _fake_credential() -> String:
	Env.respond_login(603, "token-a")
	var result: LoginResult = await AuthCore.login(CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE)
	assert_eq(result.status, AuthCore.LoginStatus.SUCCESS)
	var request: CoreContract.LoginRequest = CoreContract.LoginRequest.new()
	assert_true(request.decode(Env.request_body("core/Login", Env.request_count("core/Login") - 1)))
	return request.credential


func _restart_auth() -> void:
	AuthCore.release()
	assert_true(env.start_auth())
	Env.agree_terms()
	Env.respond_terms()
	assert_eq(await AuthCore.prepare_terms(), AuthCore.TermsStatus.AGREED)


func test_fake_account_name_gives_the_same_credential_after_release_and_init() -> void:
	env.adapters[CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE] = FakeSocialAdapter.new()
	assert_true(await env.boot())
	await _restart_auth()
	AuthCoreDev.set_fake_social_account("carol")
	var first: String = await _fake_credential()
	assert_eq(first, "fake:carol")
	await _restart_auth()
	AuthCoreDev.set_fake_social_account("carol")
	assert_eq(await _fake_credential(), first)


func test_default_fake_account_is_kept_per_app_storage() -> void:
	env.adapters[CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE] = FakeSocialAdapter.new()
	assert_true(await env.boot())
	await _restart_auth()
	var first: String = await _fake_credential()
	assert_true(first.begins_with("fake:"))
	assert_eq(first.length(), 5 + 36)
	await _restart_auth()
	var again: String = await _fake_credential()
	assert_eq(again, first)
	LocalDataCore.remove_value(LocalDataCore.FileKind.DEVICE, "AuthCore.fake_account")
	await _restart_auth()
	var other_storage: String = await _fake_credential()
	assert_ne(other_storage, first)


func test_dev_operations_and_fake_adapter_are_dev_code() -> void:
	var dev_scripts: Array[Script] = [AuthCoreDev, FakeSocialAdapter]
	for script: Script in dev_scripts:
		assert_true(script.resource_path.begins_with("res://core/auth_core/dev/"), script.resource_path)
	var source: String = FileAccess.get_file_as_string("res://core/auth_core/auth_core.gd")
	assert_false(source.contains("AuthCoreDev"))
	assert_false(source.contains("FakeSocialAdapter"))
	assert_false(source.contains("/dev/"))
