extends UnitTestCase
## Ad push consent: `get_push_consent` gives the `AuthCore.get_consent` values, and `set_push_consent` calls
## `AuthCore.update_push_consent` once and returns its result.

const Env := preload("res://core/push_core/tests/support/push_test_env.gd")


func after_each() -> void:
	super()
	Env.stop()


func _start() -> void:
	assert_true(UnitTestCore.set_test_settings("pushConsent.adPush", true))
	assert_true(await Env.start(null, null))
	assert_true(await Env.login())


func test_get_push_consent_is_the_two_values_of_get_consent() -> void:
	await _start()
	var info: PushConsentInfo = PushCore.get_push_consent()
	var consent: ConsentInfo = AuthCore.get_consent()
	assert_eq(info.push_ad, consent.push_ad)
	assert_eq(info.push_night, consent.push_night)
	assert_eq(info.push_ad, CoreContract.ConsentChoice.CONSENT_CHOICE_DENIED)
	assert_eq(info.push_night, CoreContract.ConsentChoice.CONSENT_CHOICE_GRANTED)


func test_get_push_consent_without_a_session_is_the_failure_value() -> void:
	assert_true(await Env.start(null, null))
	var info: PushConsentInfo = PushCore.get_push_consent()
	assert_eq(info.push_ad, CoreContract.ConsentChoice.CONSENT_CHOICE_UNSPECIFIED)
	assert_eq(info.push_night, CoreContract.ConsentChoice.CONSENT_CHOICE_UNSPECIFIED)
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 1, "AuthCore logs the failure")
	assert_eq(Env.errors(), 0)


func test_set_push_consent_calls_update_push_consent_once_and_returns_its_success() -> void:
	await _start()
	var response: CoreContract.UpdatePushConsentResponse = CoreContract.UpdatePushConsentResponse.new()
	response.consent = Env.consent_state()
	Env.respond(Env.UPDATE_PUSH_CONSENT, response)
	var ok: bool = await PushCore.set_push_consent(
		CoreContract.ConsentChoice.CONSENT_CHOICE_DENIED, CoreContract.ConsentChoice.CONSENT_CHOICE_GRANTED
	)
	assert_true(ok)
	assert_eq(Env.request_count(Env.UPDATE_PUSH_CONSENT), 1)
	var requests: Array[UnitTestRequest] = UnitTestCore.received_requests()
	var last: UnitTestRequest = requests[requests.size() - 1]
	assert_eq(last.name, Env.UPDATE_PUSH_CONSENT)
	var sent: CoreContract.UpdatePushConsentRequest = CoreContract.UpdatePushConsentRequest.new()
	assert_true(sent.decode(last.body))
	assert_eq(sent.push_ad, CoreContract.ConsentChoice.CONSENT_CHOICE_DENIED)
	assert_eq(sent.push_night, CoreContract.ConsentChoice.CONSENT_CHOICE_GRANTED)


func test_set_push_consent_returns_the_failure_of_update_push_consent() -> void:
	await _start()
	var ok: bool = await PushCore.set_push_consent(
		CoreContract.ConsentChoice.CONSENT_CHOICE_UNSPECIFIED, CoreContract.ConsentChoice.CONSENT_CHOICE_GRANTED
	)
	assert_false(ok)
	assert_eq(Env.request_count(Env.UPDATE_PUSH_CONSENT), 0)
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 1, "AuthCore logs the failure")
	assert_eq(Env.errors(), 0)
