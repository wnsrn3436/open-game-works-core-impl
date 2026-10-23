extends UnitTestCase
## Age confirmation, privacy choices, ad push consent, tracking permission and consent apply.

const Env := preload("res://core/auth_core/tests/support/auth_test_env.gd")
const Flow := preload("res://core/auth_core/tests/support/flow.gd")
const TestPushPopup := preload("res://core/auth_core/tests/support/fake_push_popup.gd")
const TestPrivacyPopup := preload("res://core/auth_core/tests/support/fake_privacy_popup.gd")

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
	return flow


func _boot_login_status() -> AuthCore.LoginStatus:
	var result: LoginResult = await AuthCore.boot_login()
	return result.status


func _status(flow: Flow) -> AuthCore.LoginStatus:
	var result: LoginResult = flow.result as LoginResult
	return result.status if result != null else AuthCore.LoginStatus.FAILED


## Guest `boot_login` setup whose login response has `consent`.
func _prepare_guest(consent: CoreContract.ConsentUserState, user_id: int = 401) -> void:
	Env.agree_terms()
	Env.respond_terms()
	Env.respond_login(user_id, "token-a", consent)


static func _unconfirmed() -> CoreContract.ConsentUserState:
	var consent: CoreContract.ConsentUserState = Env.consent_state()
	consent.age_confirmed_at = 0
	consent.analytics_allowed = false
	return consent


## Analytics events may be collected now: `LogCore.track_event` of a probe event. The fake network answers a
## `ReportAnalyticsEvents` the probe may cause.
static func _analytics_allowed() -> bool:
	var allowed: bool = LogCore.track_event("auth_core_probe", [])
	if allowed:
		Env.respond("core/ReportAnalyticsEvents", CoreContract.ReportAnalyticsEventsResponse.new())
	return allowed


func _popup_of(script: Script) -> UIPopup:
	return _find_popup(UICore.get_layer(UICore.UILayer.POPUP), script)


func _find_popup(node: Node, script: Script) -> UIPopup:
	if node is UIPopup and (node as UIPopup).get_script() == script:
		return node as UIPopup
	for child: Node in node.get_children():
		var found: UIPopup = _find_popup(child, script)
		if found != null:
			return found
	return null


func test_age_popup_opens_for_unconfirmed_age_and_sends_confirm_age() -> void:
	assert_true(env.settings({"consent.ageConfirmation": true}))
	assert_true(await env.boot())
	_prepare_guest(_unconfirmed())
	var confirmed: CoreContract.ConsentUserState = Env.consent_state()
	Env.respond_consent("core/ConfirmAge", confirmed)
	var flow: Flow = _start_boot_login()
	assert_true(await Env.wait_popup("auth_test_age"))
	Env.type_text(0, "1990")
	Env.type_text(1, "5")
	assert_true(await Env.tap("auth_test_age_confirm"))
	await flow.wait()
	assert_eq(_status(flow), AuthCore.LoginStatus.SUCCESS)
	var request: CoreContract.ConfirmAgeRequest = CoreContract.ConfirmAgeRequest.new()
	assert_true(request.decode(Env.request_body("core/ConfirmAge")))
	assert_eq(request.birth_year_month, 199005)


func test_confirmed_age_opens_no_age_popup() -> void:
	assert_true(env.settings({"consent.ageConfirmation": true}))
	assert_true(await env.boot())
	_prepare_guest(Env.consent_state())
	var result: LoginResult = await AuthCore.boot_login()
	assert_eq(result.status, AuthCore.LoginStatus.SUCCESS)
	assert_eq(Env.request_count("core/ConfirmAge"), 0)


func test_below_minimum_age_blocks_and_writes_the_marker() -> void:
	assert_true(env.settings({"consent.ageConfirmation": true}))
	assert_true(await env.boot())
	_prepare_guest(_unconfirmed())
	var blocked: CoreContract.ConsentUserState = Env.consent_state()
	blocked.below_minimum_age = true
	Env.respond_consent("core/ConfirmAge", blocked)
	var flow: Flow = _start_boot_login()
	assert_true(await Env.wait_popup("auth_test_age"))
	Env.type_text(0, "2015")
	Env.type_text(1, "1")
	assert_true(await Env.tap("auth_test_age_confirm"))
	await flow.wait()
	assert_eq(_status(flow), AuthCore.LoginStatus.AGE_BLOCKED)
	assert_false(AuthCore.is_logged_in())
	assert_eq(AuthCore._pending_token, "")
	assert_eq(env.stored_text(), "")
	assert_true(LocalDataCore.read_file("auth/age_blocked", 1).ok)
	assert_eq(env.recorder.session_ends, PackedInt32Array([AuthCore.SessionEndReason.AGE_BLOCKED]))
	var requests: int = Env.request_names().size()
	var again: LoginResult = await AuthCore.boot_login()
	assert_eq(again.status, AuthCore.LoginStatus.AGE_BLOCKED)
	assert_eq(Env.request_names().size(), requests)


func test_age_below_minimum_auto_login_is_age_blocked_without_marker() -> void:
	assert_true(await env.boot())
	Env.mark_installed()
	Env.agree_terms()
	env.store("token-a")
	Env.respond_terms()
	Env.respond_error("core/AutoLogin", CoreContract.CoreError.CORE_ERROR_AGE_BELOW_MINIMUM)
	var result: LoginResult = await AuthCore.boot_login()
	assert_eq(result.status, AuthCore.LoginStatus.AGE_BLOCKED)
	assert_eq(LocalDataCore.read_file("auth/age_blocked", 1).error, LocalDataCore.FileError.NOT_FOUND)


func test_invalid_age_input_keeps_the_popup_and_shows_invalid() -> void:
	assert_true(env.settings({"consent.ageConfirmation": true}))
	assert_true(await env.boot())
	_prepare_guest(_unconfirmed())
	var flow: Flow = _start_boot_login()
	assert_true(await Env.wait_popup("auth_test_age"))
	var inputs: Array[PackedStringArray] = [
		PackedStringArray(["199", "5"]),
		PackedStringArray(["1990", "13"]),
		PackedStringArray(["2030", "1"]),
		PackedStringArray(["1890", "1"]),
	]
	for input: PackedStringArray in inputs:
		Env.type_text(0, input[0])
		Env.type_text(1, input[1])
		assert_true(await Env.tap("auth_test_age_confirm"))
		assert_true(UICore.get_open_popups().has("auth_test_age"), input[0])
		assert_true(Env.shows(ReservedString.auth_age_invalid()), input[0])
	assert_eq(Env.request_count("core/ConfirmAge"), 0)
	AuthCore.release()
	await flow.wait()


func test_confirm_age_failure_fails_boot_login() -> void:
	assert_true(env.settings({"consent.ageConfirmation": true}))
	assert_true(await env.boot())
	_prepare_guest(_unconfirmed())
	Env.respond_error("core/ConfirmAge", CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST)
	var flow: Flow = _start_boot_login()
	assert_true(await Env.wait_popup("auth_test_age"))
	Env.type_text(0, "1990")
	Env.type_text(1, "5")
	assert_true(await Env.tap("auth_test_age_confirm"))
	await flow.wait()
	assert_eq(_status(flow), AuthCore.LoginStatus.FAILED)
	UnitTestCore.check_logs("error", "NetworkCore")
	UICore.close_all_popups()


func test_update_consent_failure_fails_boot_login() -> void:
	assert_true(env.settings({"consent.privacyChoices": true}))
	assert_true(await env.boot())
	var consent: CoreContract.ConsentUserState = Env.consent_state()
	consent.privacy_version = 0
	_prepare_guest(consent)
	Env.respond_error("core/UpdateConsent", CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST)
	var flow: Flow = _start_boot_login()
	assert_true(await Env.wait_popup("auth_test_privacy"))
	assert_true(await Env.tap("auth_test_privacy_confirm"))
	await flow.wait()
	assert_eq(_status(flow), AuthCore.LoginStatus.FAILED)
	UnitTestCore.check_logs("error", "NetworkCore")
	UICore.close_all_popups()


func test_push_consent_popup_opens_off_and_toasts_each_change() -> void:
	assert_true(await env.boot())
	var consent: CoreContract.ConsentUserState = Env.consent_state()
	consent.push_ad_at = 0
	consent.push_ad = CoreContract.ConsentChoice.CONSENT_CHOICE_UNSPECIFIED
	consent.push_night = CoreContract.ConsentChoice.CONSENT_CHOICE_DENIED
	_prepare_guest(consent)
	var after: CoreContract.ConsentUserState = Env.consent_state()
	after.push_ad = CoreContract.ConsentChoice.CONSENT_CHOICE_GRANTED
	after.push_ad_at = Env.SERVER_TIME + 10
	after.push_night = CoreContract.ConsentChoice.CONSENT_CHOICE_DENIED
	Env.respond_consent("core/UpdatePushConsent", after)
	var flow: Flow = _start_boot_login()
	assert_true(await Env.wait_popup("auth_test_push"))
	var popup: PushConsentPopup = _popup_of(TestPushPopup) as PushConsentPopup
	assert_not_null(popup)
	if popup != null:
		assert_false(popup.ad_push_toggle.button_pressed)
		assert_false(popup.night_push_toggle.button_pressed)
	assert_true(await Env.tap("auth_test_push_ad"))
	assert_true(await Env.tap("auth_test_push_confirm"))
	await flow.wait()
	assert_eq(_status(flow), AuthCore.LoginStatus.SUCCESS)
	var request: CoreContract.UpdatePushConsentRequest = CoreContract.UpdatePushConsentRequest.new()
	assert_true(request.decode(Env.request_body("core/UpdatePushConsent")))
	assert_eq(request.push_ad, CoreContract.ConsentChoice.CONSENT_CHOICE_GRANTED)
	assert_eq(request.push_night, CoreContract.ConsentChoice.CONSENT_CHOICE_DENIED)
	var args: FormatArgs = FormatArgs.new()
	args.set_int("date", Env.SERVER_TIME + 10)
	var text: String = LocalizationCore.format(ReservedString.auth_push_ad_granted(), args)
	assert_true(Env._has_text(UICore.get_layer(UICore.UILayer.MESSAGE), text))
	assert_false(Env._has_text(UICore.get_layer(UICore.UILayer.MESSAGE), LocalizationCore.get_text(ReservedString.auth_push_night_denied())))


func test_push_consent_popup_does_not_open_without_ad_push() -> void:
	assert_true(env.settings({"pushConsent.adPush": false}))
	assert_true(await env.boot())
	var consent: CoreContract.ConsentUserState = Env.consent_state()
	consent.push_ad_at = 0
	_prepare_guest(consent)
	var result: LoginResult = await AuthCore.boot_login()
	assert_eq(result.status, AuthCore.LoginStatus.SUCCESS)
	assert_eq(Env.request_count("core/UpdatePushConsent"), 0)


func test_report_ad_consent_sends_only_a_changed_ad_personalization() -> void:
	assert_true(await env.boot())
	var consent: CoreContract.ConsentUserState = Env.consent_state()
	consent.ad_personalization = CoreContract.ConsentChoice.CONSENT_CHOICE_DENIED
	_prepare_guest(consent)
	assert_eq(await _boot_login_status(), AuthCore.LoginStatus.SUCCESS)
	assert_true(await AuthCore.report_ad_consent(false))
	assert_eq(Env.request_count("core/UpdateConsent"), 0)
	var after: CoreContract.ConsentUserState = Env.consent_state()
	after.ad_personalization = CoreContract.ConsentChoice.CONSENT_CHOICE_GRANTED
	Env.respond_consent("core/UpdateConsent", after)
	assert_true(await AuthCore.report_ad_consent(true))
	var request: CoreContract.UpdateConsentRequest = CoreContract.UpdateConsentRequest.new()
	assert_true(request.decode(Env.request_body("core/UpdateConsent")))
	assert_eq(request.ad_personalization, CoreContract.ConsentChoice.CONSENT_CHOICE_GRANTED)
	assert_eq(request.analytics, CoreContract.ConsentChoice.CONSENT_CHOICE_UNSPECIFIED)
	assert_eq(request.privacy_version, 1)
	assert_eq(request.tracking, CoreContract.TrackingStatus.TRACKING_STATUS_NOT_APPLICABLE)


func test_report_ad_consent_failure_is_false_without_popup_or_toast() -> void:
	assert_true(await env.boot())
	_prepare_guest(Env.consent_state())
	assert_eq(await _boot_login_status(), AuthCore.LoginStatus.SUCCESS)
	Env.respond_offline("core/UpdateConsent", 2)
	assert_false(await AuthCore.report_ad_consent(true))
	Env.respond_error("core/UpdateConsent", CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST)
	assert_false(await AuthCore.report_ad_consent(true))
	assert_eq(UICore.get_open_popup_count(), 0)
	assert_false(Env._has_text(UICore.get_layer(UICore.UILayer.MESSAGE), LocalizationCore.get_text(ReservedString.network_error_general())))
	UnitTestCore.check_logs("error", "NetworkCore")


func test_privacy_popup_opens_off_for_a_new_version_and_a_close_denies_both() -> void:
	assert_true(env.settings({"consent.privacyChoices": true}))
	assert_true(await env.boot())
	var consent: CoreContract.ConsentUserState = Env.consent_state()
	consent.privacy_version = 0
	_prepare_guest(consent)
	Env.respond_consent("core/UpdateConsent", Env.consent_state())
	var flow: Flow = _start_boot_login()
	assert_true(await Env.wait_popup("auth_test_privacy"))
	var popup: PrivacyChoicesPopup = _popup_of(TestPrivacyPopup) as PrivacyChoicesPopup
	assert_not_null(popup)
	if popup != null:
		assert_false(popup.ad_personalization_toggle.button_pressed)
		assert_false(popup.analytics_toggle.button_pressed)
	assert_true(await Env.tap("auth_test_privacy_ad"))
	UICore.close_all_popups()
	await flow.wait()
	assert_eq(_status(flow), AuthCore.LoginStatus.SUCCESS)
	var request: CoreContract.UpdateConsentRequest = CoreContract.UpdateConsentRequest.new()
	assert_true(request.decode(Env.request_body("core/UpdateConsent")))
	assert_eq(request.ad_personalization, CoreContract.ConsentChoice.CONSENT_CHOICE_DENIED)
	assert_eq(request.analytics, CoreContract.ConsentChoice.CONSENT_CHOICE_DENIED)


func test_privacy_popup_does_not_open_for_the_same_version() -> void:
	assert_true(env.settings({"consent.privacyChoices": true}))
	assert_true(await env.boot())
	_prepare_guest(Env.consent_state())
	assert_eq(await _boot_login_status(), AuthCore.LoginStatus.SUCCESS)
	assert_eq(Env.request_count("core/UpdateConsent"), 0)


func test_ios_tracking_request_only_when_every_condition_holds() -> void:
	env.platform = "ios"
	env.tracking = Env.TestTracking.new()
	assert_true(env.settings({"consent.trackingRequest": true}))
	assert_true(await env.boot())
	var consent: CoreContract.ConsentUserState = Env.consent_state()
	consent.tracking = CoreContract.TrackingStatus.TRACKING_STATUS_NOT_DETERMINED
	_prepare_guest(consent)
	var after: CoreContract.ConsentUserState = Env.consent_state()
	after.tracking = CoreContract.TrackingStatus.TRACKING_STATUS_AUTHORIZED
	Env.respond_consent("core/UpdateConsent", after)
	assert_eq(await _boot_login_status(), AuthCore.LoginStatus.SUCCESS)
	assert_eq(env.tracking.request_count, 1)
	var request: CoreContract.UpdateConsentRequest = CoreContract.UpdateConsentRequest.new()
	assert_true(request.decode(Env.request_body("core/UpdateConsent")))
	assert_eq(request.tracking, CoreContract.TrackingStatus.TRACKING_STATUS_AUTHORIZED)


func test_ios_tracking_request_is_not_made_when_turned_off() -> void:
	env.platform = "ios"
	env.tracking = Env.TestTracking.new()
	assert_true(await env.boot())
	var consent: CoreContract.ConsentUserState = Env.consent_state()
	consent.tracking = CoreContract.TrackingStatus.TRACKING_STATUS_NOT_DETERMINED
	_prepare_guest(consent)
	assert_eq(await _boot_login_status(), AuthCore.LoginStatus.SUCCESS)
	assert_eq(env.tracking.request_count, 0)
	assert_eq(Env.request_count("core/UpdateConsent"), 0)


## `boot_login` on `platform` whose device tracking state is `device` and whose login response has `consent`.
func _boot_with_tracking(
	platform: String, request_on: bool, device: CoreContract.TrackingStatus, consent: CoreContract.ConsentUserState
) -> void:
	env.platform = platform
	env.tracking = Env.TestTracking.new()
	env.tracking.status = device
	assert_true(env.settings({"consent.trackingRequest": request_on}))
	assert_true(await env.boot())
	_prepare_guest(consent)
	assert_eq(await _boot_login_status(), AuthCore.LoginStatus.SUCCESS)


func test_ios_tracking_request_is_not_made_without_ad_personalization() -> void:
	var consent: CoreContract.ConsentUserState = Env.consent_state()
	consent.ad_personalization_allowed = false
	consent.tracking = CoreContract.TrackingStatus.TRACKING_STATUS_NOT_DETERMINED
	await _boot_with_tracking("ios", true, CoreContract.TrackingStatus.TRACKING_STATUS_NOT_DETERMINED, consent)
	assert_eq(env.tracking.request_count, 0)
	assert_eq(Env.request_count("core/UpdateConsent"), 0)


func test_ios_tracking_request_is_not_made_when_the_device_state_is_decided() -> void:
	var consent: CoreContract.ConsentUserState = Env.consent_state()
	consent.tracking = CoreContract.TrackingStatus.TRACKING_STATUS_DENIED
	await _boot_with_tracking("ios", true, CoreContract.TrackingStatus.TRACKING_STATUS_DENIED, consent)
	assert_eq(env.tracking.request_count, 0)
	assert_eq(Env.request_count("core/UpdateConsent"), 0)


func test_tracking_request_is_not_made_outside_ios() -> void:
	var consent: CoreContract.ConsentUserState = Env.consent_state()
	consent.tracking = CoreContract.TrackingStatus.TRACKING_STATUS_NOT_APPLICABLE
	await _boot_with_tracking("android", true, CoreContract.TrackingStatus.TRACKING_STATUS_NOT_DETERMINED, consent)
	assert_eq(env.tracking.request_count, 0)
	assert_eq(Env.request_count("core/UpdateConsent"), 0)


func test_tracking_answer_equal_to_the_stored_tracking_sends_no_update_consent() -> void:
	var consent: CoreContract.ConsentUserState = Env.consent_state()
	consent.tracking = CoreContract.TrackingStatus.TRACKING_STATUS_AUTHORIZED
	await _boot_with_tracking("ios", true, CoreContract.TrackingStatus.TRACKING_STATUS_NOT_DETERMINED, consent)
	assert_eq(env.tracking.request_count, 1)
	assert_eq(Env.request_count("core/UpdateConsent"), 0)


func test_denied_tracking_turns_off_ad_personalization() -> void:
	assert_true(await env.boot())
	_prepare_guest(Env.consent_state())
	assert_eq(await _boot_login_status(), AuthCore.LoginStatus.SUCCESS)
	assert_true(AuthCore.get_consent().ad_personalization_allowed)
	AuthCoreDev.set_fake_tracking_status(CoreContract.TrackingStatus.TRACKING_STATUS_DENIED)
	assert_false(AuthCore.get_consent().ad_personalization_allowed)


func test_get_consent_without_session_is_the_failure_value() -> void:
	assert_true(await env.boot())
	var info: ConsentInfo = AuthCore.get_consent()
	assert_false(info.age_confirmed)
	assert_eq(info.age_from, 0)
	assert_eq(info.age_to, 0)
	assert_true(info.child)
	assert_true(info.below_consent_age)
	assert_false(info.ad_personalization_allowed)
	assert_false(info.analytics_allowed)
	assert_eq(info.tracking, CoreContract.TrackingStatus.TRACKING_STATUS_UNSPECIFIED)
	assert_eq(info.push_ad, CoreContract.ConsentChoice.CONSENT_CHOICE_UNSPECIFIED)
	assert_eq(info.push_night, CoreContract.ConsentChoice.CONSENT_CHOICE_UNSPECIFIED)
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 1)


func test_analytics_consent_follows_login_update_logout_and_release() -> void:
	assert_true(env.settings({"consent.privacyChoices": true}))
	assert_true(await env.boot())
	var consent: CoreContract.ConsentUserState = Env.consent_state()
	consent.analytics_allowed = false
	_prepare_guest(consent)
	assert_eq(await _boot_login_status(), AuthCore.LoginStatus.SUCCESS)
	assert_false(_analytics_allowed())
	var after: CoreContract.ConsentUserState = Env.consent_state()
	Env.respond_consent("core/UpdateConsent", after)
	var flow: Flow = Flow.new()
	flow.start(func(f: Flow) -> void:
		f.flag = await AuthCore.open_privacy_choices()
		f.finish())
	assert_true(await Env.wait_popup("auth_test_privacy"))
	assert_true(await Env.tap("auth_test_privacy_confirm"))
	await flow.wait()
	assert_true(flow.flag)
	assert_true(_analytics_allowed())
	var last: ConsentInfo = env.recorder.consents.back()
	assert_true(last.analytics_allowed)
	Env.respond("core/Logout", CoreContract.LogoutResponse.new())
	await AuthCore.logout()
	assert_false(_analytics_allowed())
	AuthCore.release()
	assert_false(_analytics_allowed())


func test_analytics_consent_is_set_at_login_and_cleared_at_release() -> void:
	assert_true(await env.boot())
	assert_false(_analytics_allowed())
	_prepare_guest(Env.consent_state())
	assert_eq(await _boot_login_status(), AuthCore.LoginStatus.SUCCESS)
	assert_true(_analytics_allowed())
	AuthCore.release()
	assert_false(_analytics_allowed())


func test_unconfirmed_age_login_then_confirm_age_sets_analytics() -> void:
	assert_true(env.settings({"consent.ageConfirmation": true}))
	assert_true(await env.boot())
	_prepare_guest(_unconfirmed())
	Env.respond_consent("core/ConfirmAge", Env.consent_state())
	var flow: Flow = _start_boot_login()
	assert_true(await Env.wait_popup("auth_test_age"))
	assert_false(_analytics_allowed())
	Env.type_text(0, "1990")
	Env.type_text(1, "5")
	assert_true(await Env.tap("auth_test_age_confirm"))
	await flow.wait()
	assert_eq(_status(flow), AuthCore.LoginStatus.SUCCESS)
	assert_true(_analytics_allowed())


func test_privacy_and_ad_push_settings_are_returned() -> void:
	assert_true(env.settings({"consent.privacyChoices": true, "pushConsent.adPush": false}))
	assert_true(await env.boot())
	assert_true(AuthCore.is_privacy_choices_enabled())
	assert_false(AuthCore.is_ad_push_enabled())
	AuthCore.release()
	assert_true(env.settings({"consent.privacyChoices": false, "pushConsent.adPush": true}))
	assert_true(env.start_auth())
	assert_false(AuthCore.is_privacy_choices_enabled())
	assert_true(AuthCore.is_ad_push_enabled())
