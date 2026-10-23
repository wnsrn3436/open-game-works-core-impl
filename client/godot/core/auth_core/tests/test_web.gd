extends UnitTestCase
## Web guest: the persistent storage request and the link prompt.

const Env := preload("res://core/auth_core/tests/support/auth_test_env.gd")
const Flow := preload("res://core/auth_core/tests/support/flow.gd")

var env: Env = null


func before_each() -> void:
	super()
	env = Env.new()


func after_each() -> void:
	env.finish()
	super()


func _guest_logins() -> int:
	return LocalDataCore.get_value_int(LocalDataCore.FileKind.DEVICE, "AuthCore.web_guest_logins", 0)


## `boot_login` again after `release` and `init`: an auto login of the stored token.
func _boot_again(user_id: int, linked: PackedInt32Array = PackedInt32Array()) -> LoginResult:
	AuthCore.release()
	assert_true(env.start_auth())
	Env.respond_terms()
	var response: CoreContract.AutoLoginResponse = CoreContract.AutoLoginResponse.new()
	response.result = Env.auth_result(user_id, "token-%d" % user_id)
	response.result.linked_providers = linked
	Env.respond("core/AutoLogin", response)
	return await AuthCore.boot_login()


func _start_boot_again(user_id: int) -> Flow:
	AuthCore.release()
	assert_true(env.start_auth())
	Env.respond_terms()
	Env.respond_auto_login(user_id, "token-%d" % user_id)
	var flow: Flow = Flow.new()
	flow.start(func(f: Flow) -> void:
		f.result = await AuthCore.boot_login()
		f.finish())
	await UnitTestCore.wait_frames(8)
	return flow


func test_each_web_boot_login_requests_persistent_storage_once() -> void:
	env.platform = "web"
	assert_true(await env.boot())
	var result_1: LoginResult = await env.boot_guest(501, "token-501")
	assert_eq(result_1.status, AuthCore.LoginStatus.SUCCESS)
	assert_eq(env.persist_requests, 1)
	env.persist_possible = false
	var result_2: LoginResult = await _boot_again(501)
	assert_eq(result_2.status, AuthCore.LoginStatus.SUCCESS)
	assert_eq(env.persist_requests, 2)


func test_other_platforms_make_no_persistent_storage_request() -> void:
	assert_true(await env.boot())
	var result_3: LoginResult = await env.boot_guest(502, "token-502")
	assert_eq(result_3.status, AuthCore.LoginStatus.SUCCESS)
	assert_eq(env.persist_requests, 0)


func test_link_prompt_opens_on_multiples_of_the_setting() -> void:
	env.platform = "web"
	assert_true(UnitTestCore.set_test_settings("AuthCore.webLinkPromptLogins", 2))
	assert_true(await env.boot())
	var result_4: LoginResult = await env.boot_guest(503, "token-503")
	assert_eq(result_4.status, AuthCore.LoginStatus.SUCCESS)
	assert_eq(_guest_logins(), 1)
	var flow: Flow = await _start_boot_again(503)
	assert_eq(_guest_logins(), 2)
	assert_true(Env.shows(ReservedString.auth_web_link_body()))
	assert_true(await Env.press(ReservedString.auth_web_link_later()))
	await flow.wait()
	assert_eq((flow.result as LoginResult).status, AuthCore.LoginStatus.SUCCESS)
	assert_eq(Env.request_count("core/LinkAccount"), 0)
	var result_5: LoginResult = await _boot_again(503)
	assert_eq(result_5.status, AuthCore.LoginStatus.SUCCESS)
	assert_eq(_guest_logins(), 3)
	assert_eq(UICore.get_open_popup_count(), 0)


func test_linked_guest_and_other_platforms_keep_the_count() -> void:
	env.platform = "web"
	assert_true(UnitTestCore.set_test_settings("AuthCore.webLinkPromptLogins", 1))
	assert_true(await env.boot())
	Env.mark_installed()
	Env.agree_terms()
	env.store("token-old")
	var linked: PackedInt32Array = [CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE]
	var result_6: LoginResult = await _boot_again(504, linked)
	assert_eq(result_6.status, AuthCore.LoginStatus.SUCCESS)
	assert_eq(_guest_logins(), 0)
	assert_eq(UICore.get_open_popup_count(), 0)
	CoreBuildInfo.platform = "android"
	var result_7: LoginResult = await _boot_again(504)
	assert_eq(result_7.status, AuthCore.LoginStatus.SUCCESS)
	assert_eq(_guest_logins(), 0)
	assert_eq(UICore.get_open_popup_count(), 0)


func test_link_prompt_google_button_links_and_already_linked_toasts() -> void:
	env.platform = "web"
	assert_true(UnitTestCore.set_test_settings("AuthCore.webLinkPromptLogins", 1))
	assert_true(await env.boot())
	Env.agree_terms()
	Env.respond_terms()
	Env.respond_login(505, "token-505")
	Env.respond_error("core/LinkAccount", CoreContract.CoreError.CORE_ERROR_ALREADY_LINKED)
	var flow: Flow = Flow.new()
	flow.start(func(f: Flow) -> void:
		f.result = await AuthCore.boot_login()
		f.finish())
	await UnitTestCore.wait_frames(8)
	assert_true(await Env.press(ReservedString.auth_web_link_google()))
	await flow.wait()
	assert_eq((flow.result as LoginResult).status, AuthCore.LoginStatus.SUCCESS)
	assert_eq(Env.request_count("core/LinkAccount"), 1)
	var failed: String = LocalizationCore.get_text(ReservedString.auth_web_link_failed())
	assert_true(Env._has_text(UICore.get_layer(UICore.UILayer.MESSAGE), failed))


func test_link_prompt_back_input_closes_without_request() -> void:
	env.platform = "web"
	assert_true(UnitTestCore.set_test_settings("AuthCore.webLinkPromptLogins", 1))
	assert_true(await env.boot())
	Env.agree_terms()
	Env.respond_terms()
	Env.respond_login(506, "token-506")
	var flow: Flow = Flow.new()
	flow.start(func(f: Flow) -> void:
		f.result = await AuthCore.boot_login()
		f.finish())
	await UnitTestCore.wait_frames(8)
	assert_true(Env.shows(ReservedString.auth_web_link_body()))
	await Env.back()
	await flow.wait()
	assert_eq((flow.result as LoginResult).status, AuthCore.LoginStatus.SUCCESS)
	assert_eq(Env.request_count("core/LinkAccount"), 0)
