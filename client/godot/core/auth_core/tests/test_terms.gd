extends UnitTestCase
## `prepare_terms`, `open_terms_document` and the agreed versions in login requests.

const Env := preload("res://core/auth_core/tests/support/auth_test_env.gd")
const Flow := preload("res://core/auth_core/tests/support/flow.gd")

var env: Env = null


func before_each() -> void:
	super()
	env = Env.new()


func after_each() -> void:
	env.finish()
	super()


func _start_terms() -> Flow:
	var flow: Flow = Flow.new()
	flow.start(func(f: Flow) -> void:
		f.status = await AuthCore.prepare_terms()
		f.finish())
	return flow


func _stored_versions() -> PackedInt64Array:
	var terms: int = LocalDataCore.get_value_int(LocalDataCore.FileKind.DEVICE, "AuthCore.terms_version", 0)
	var privacy: int = LocalDataCore.get_value_int(LocalDataCore.FileKind.DEVICE, "AuthCore.privacy_terms_version", 0)
	return PackedInt64Array([terms, privacy])


func test_stored_version_same_as_current_agrees_without_popup() -> void:
	assert_true(await env.boot())
	Env.agree_terms(3)
	Env.respond_terms(3)
	var status: AuthCore.TermsStatus = await AuthCore.prepare_terms()
	assert_eq(status, AuthCore.TermsStatus.AGREED)
	assert_eq(UICore.get_open_popups().size(), 0)


func test_other_version_opens_popup_and_confirm_with_both_toggles_stores_version() -> void:
	assert_true(await env.boot())
	Env.agree_terms(1)
	Env.respond_terms(2)
	var flow: Flow = _start_terms()
	assert_true(await Env.wait_popup("auth_test_terms"))
	assert_true(await Env.tap("auth_test_terms_toggle"))
	assert_true(await Env.tap("auth_test_privacy_toggle"))
	assert_true(await Env.tap("auth_test_terms_confirm"))
	await flow.wait()
	assert_eq(flow.status, AuthCore.TermsStatus.AGREED)
	assert_eq(_stored_versions(), PackedInt64Array([2, 2]))


func test_confirm_with_one_toggle_refuses_and_keeps_stored_version() -> void:
	assert_true(await env.boot())
	Env.agree_terms(1)
	Env.respond_terms(2)
	var flow: Flow = _start_terms()
	assert_true(await Env.wait_popup("auth_test_terms"))
	assert_true(await Env.tap("auth_test_terms_toggle"))
	assert_true(await Env.tap("auth_test_terms_confirm"))
	await flow.wait()
	assert_eq(flow.status, AuthCore.TermsStatus.REFUSED)
	assert_eq(_stored_versions(), PackedInt64Array([1, 1]))


func test_close_without_confirm_refuses() -> void:
	assert_true(await env.boot())
	Env.respond_terms(2)
	var flow: Flow = _start_terms()
	assert_true(await Env.wait_popup("auth_test_terms"))
	assert_true(await Env.tap("auth_test_terms_toggle"))
	assert_true(await Env.tap("auth_test_privacy_toggle"))
	UICore.close_all_popups()
	await flow.wait()
	assert_eq(flow.status, AuthCore.TermsStatus.REFUSED)
	assert_eq(_stored_versions(), PackedInt64Array([0, 0]))


func test_get_terms_failure_fails_without_popup() -> void:
	assert_true(await env.boot())
	Env.respond_error("core/GetTerms", CoreContract.CoreError.CORE_ERROR_MAINTENANCE)
	assert_eq(await AuthCore.prepare_terms(), AuthCore.TermsStatus.FAILED)
	assert_eq(UICore.get_open_popups().size(), 0)
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 0)


func test_bad_document_urls_fail_without_popup() -> void:
	assert_true(await env.boot())
	var urls: PackedStringArray = ["https:///terms", "https://user@example.com/terms", "ftp://example.com/terms"]
	for url: String in urls:
		Env.respond_terms(2, url)
		assert_eq(await AuthCore.prepare_terms(), AuthCore.TermsStatus.FAILED, url)
		assert_eq(UICore.get_open_popups().size(), 0)
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), urls.size())


func test_http_url_fails_only_without_dev_code() -> void:
	assert_true(await env.boot())
	var has_dev_code: bool = CoreBuildInfo.has_dev_code
	CoreBuildInfo.has_dev_code = false
	Env.respond_terms(2, "http://example.com/terms")
	var status: AuthCore.TermsStatus = await AuthCore.prepare_terms()
	CoreBuildInfo.has_dev_code = has_dev_code
	assert_eq(status, AuthCore.TermsStatus.FAILED)
	assert_eq(UICore.get_open_popups().size(), 0)
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 1)
	CoreBuildInfo.has_dev_code = true
	Env.agree_terms(2)
	Env.respond_terms(2, "http://example.com/terms")
	status = await AuthCore.prepare_terms()
	CoreBuildInfo.has_dev_code = has_dev_code
	assert_eq(status, AuthCore.TermsStatus.AGREED)


func test_popup_that_cannot_open_fails() -> void:
	assert_true(await _boot_with_broken_terms_popup())
	Env.respond_terms(2)
	assert_eq(await AuthCore.prepare_terms(), AuthCore.TermsStatus.FAILED)
	assert_eq(UICore.get_open_popups().size(), 0)
	assert_gt(UnitTestCore.check_logs("error", "AuthCore"), 0)
	UnitTestCore.check_logs("error", "UICore")


## `env.boot`, then AuthCore again with a terms popup prefab that has no confirm button.
func _boot_with_broken_terms_popup() -> bool:
	assert_true(await env.boot())
	AuthCore.release()
	assert_true(UnitTestCore.set_test_settings("termsPopup", "auth_test_broken_terms"))
	return env.start_auth()


func test_login_before_prepare_terms_fails_without_request() -> void:
	assert_true(await env.boot())
	var result: LoginResult = await AuthCore.login(CoreContract.LoginProvider.LOGIN_PROVIDER_GUEST)
	assert_eq(result.status, AuthCore.LoginStatus.FAILED)
	assert_eq(Env.request_count("core/Login"), 0)
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 1)


func test_open_terms_document_opens_the_item_url_and_keeps_versions() -> void:
	assert_true(await env.boot())
	Env.agree_terms(1)
	Env.respond_terms(2)
	assert_true(await AuthCore.open_terms_document(CoreContract.TermsItem.TERMS_ITEM_PRIVACY))
	assert_eq(env.opened_urls, PackedStringArray([Env.PRIVACY_URL]))
	assert_eq(_stored_versions(), PackedInt64Array([1, 1]))


func test_open_terms_document_failures_open_nothing() -> void:
	assert_true(await env.boot())
	Env.respond_error("core/GetTerms", CoreContract.CoreError.CORE_ERROR_MAINTENANCE)
	assert_false(await AuthCore.open_terms_document(CoreContract.TermsItem.TERMS_ITEM_TERMS))
	Env.respond_terms(2, "https://user@example.com/terms")
	assert_false(await AuthCore.open_terms_document(CoreContract.TermsItem.TERMS_ITEM_TERMS))
	assert_eq(env.opened_urls.size(), 0)
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 1)


func test_login_request_holds_stored_versions() -> void:
	assert_true(await env.boot())
	Env.agree_terms(4)
	Env.respond_terms(4)
	assert_eq(await AuthCore.prepare_terms(), AuthCore.TermsStatus.AGREED)
	Env.respond_login(11, "token-a")
	var result: LoginResult = await AuthCore.login(CoreContract.LoginProvider.LOGIN_PROVIDER_GUEST)
	assert_eq(result.status, AuthCore.LoginStatus.SUCCESS)
	var request: CoreContract.LoginRequest = CoreContract.LoginRequest.new()
	assert_true(request.decode(Env.request_body("core/Login")))
	assert_eq(request.agreements.size(), 2)
	for agreement: CoreContract.TermsAgreement in request.agreements:
		assert_eq(agreement.version, 4)
