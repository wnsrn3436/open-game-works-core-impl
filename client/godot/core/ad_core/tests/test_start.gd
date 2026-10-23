extends UnitTestCase
## `start`, the ads consent, the ad consent passed to the adapter, the privacy options and the build with no ads
## adapter.

const Env := preload("res://core/ad_core/tests/support/ad_test_env.gd")
const Flow := preload("res://core/ad_core/tests/support/ad_flow.gd")
const TestAdapter := preload("res://core/ad_core/tests/support/recording_ads_adapter.gd")

var env: Env = null


func before_each() -> void:
	super()
	env = Env.new()


func _basic() -> int:
	return Env.id("[ad_rewarded_basic]")


func _banner_a() -> int:
	return Env.id("[ad_banner_a]")


func test_no_ads_adapter_is_unsupported_without_logs() -> void:
	env.ads_adapter = null
	assert_true(await env.boot())
	assert_true(await AdCore.start())
	assert_eq(AdCore.get_ready_state(_basic()), AdCore.AdReadyState.UNSUPPORTED)
	assert_eq(await AdCore.show(_basic()), AdCore.AdShowResult.UNSUPPORTED)
	assert_false(AdCore.can_show(Env.id("[ad_interstitial_plain]")))
	AdCore.preload_ad(_basic())
	AdCore.show_banner(_banner_a())
	AdCore.hide_banner()
	assert_false(AdCore.is_ad_privacy_options_required())
	assert_false(await AdCore.open_ad_privacy_options())
	await Env.settle()
	assert_eq(env.adapter.calls.size(), 0)
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 0)
	assert_eq(UnitTestCore.check_logs("warn", "AdCore"), 0)


func test_two_starts_at_once_initialize_once_with_one_result() -> void:
	assert_true(await env.boot())
	env.adapter.hold("initialize")
	var first: Flow = Flow.new()
	var second: Flow = Flow.new()
	first.start()
	second.start()
	await Env.settle()
	assert_eq(env.adapter.count("initialize"), 1)
	assert_true(env.adapter.finish("initialize", true))
	await first.wait()
	await second.wait()
	assert_true(first.flag)
	assert_true(second.flag)
	assert_true(await AdCore.start())
	assert_eq(env.adapter.count("initialize"), 1)
	assert_eq(env.adapter.count("request_ad_consent"), 1)


func test_preload_and_show_banner_wait_for_the_start_in_progress() -> void:
	assert_true(await env.boot())
	env.adapter.hold("initialize")
	var flow: Flow = Flow.new()
	flow.start()
	AdCore.preload_ad(_basic())
	AdCore.show_banner(_banner_a())
	assert_eq(AdCore.get_ready_state(_basic()), AdCore.AdReadyState.LOADING)
	await Env.settle()
	assert_eq(env.adapter.count("load"), 0)
	assert_eq(env.adapter.count("open_banner"), 0)
	assert_true(env.adapter.finish("initialize", true))
	await flow.wait()
	assert_eq(env.adapter.count("load"), 1)
	assert_eq(env.adapter.count("open_banner"), 1)
	assert_eq(AdCore.get_ready_state(_basic()), AdCore.AdReadyState.READY)
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 0)


func test_preload_after_a_failed_initialize_starts_again() -> void:
	assert_true(await env.boot())
	env.adapter.results["initialize"] = false
	assert_false(await AdCore.start())
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 1)
	env.adapter.results["initialize"] = true
	AdCore.preload_ad(_basic())
	assert_eq(env.adapter.count("initialize"), 2)
	assert_eq(env.adapter.count("load"), 1)
	assert_eq(AdCore.get_ready_state(_basic()), AdCore.AdReadyState.READY)
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 0)


func test_preload_after_a_failed_initialize_that_fails_again_is_not_ready() -> void:
	assert_true(await env.boot())
	env.adapter.results["initialize"] = false
	assert_false(await AdCore.start())
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 1)
	AdCore.preload_ad(_basic())
	await Env.settle()
	assert_eq(env.adapter.count("initialize"), 2)
	assert_eq(env.adapter.count("load"), 0)
	assert_eq(AdCore.get_ready_state(_basic()), AdCore.AdReadyState.NOT_READY)
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 1)
	assert_eq(UnitTestCore.check_logs("warn", "AdCore"), 0)


func test_preload_before_start_is_an_error_and_does_not_initialize() -> void:
	assert_true(await env.boot())
	AdCore.preload_ad(_basic())
	await Env.settle()
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 1)
	assert_eq(env.adapter.count("initialize"), 0)
	assert_eq(env.adapter.count("load"), 0)


## Boots with a session consent, starts, preloads and opens a banner, then checks the ad consent of the three adapter
## calls against the expected values.
func _check_ad_consent(allowed: bool, child: bool, below_consent_age: bool) -> void:
	assert_true(await env.boot())
	assert_eq(AuthCore.get_consent().ad_personalization_allowed, allowed)
	assert_true(await AdCore.start())
	AdCore.preload_ad(_basic())
	AdCore.show_banner(_banner_a())
	await Env.settle()
	for operation: String in PackedStringArray(["initialize", "load", "open_banner"]):
		var call: TestAdapter.Call = env.adapter.last(operation)
		assert_not_null(call, operation)
		assert_eq(call.consent.ad_personalization_allowed, allowed, operation)
		assert_eq(call.consent.child, child, operation)
		assert_eq(call.consent.below_consent_age, below_consent_age, operation)


func test_adapter_gets_an_allowed_ad_personalization_of_an_adult() -> void:
	env.consent.ad_personalization = CoreContract.ConsentChoice.CONSENT_CHOICE_GRANTED
	env.consent.ad_personalization_allowed = true
	env.consent.tracking = CoreContract.TrackingStatus.TRACKING_STATUS_NOT_APPLICABLE
	env.consent.child = false
	env.consent.below_consent_age = false
	await _check_ad_consent(true, false, false)


func test_adapter_gets_a_denied_ad_personalization_of_a_child() -> void:
	env.consent.ad_personalization = CoreContract.ConsentChoice.CONSENT_CHOICE_DENIED
	env.consent.ad_personalization_allowed = false
	env.consent.child = true
	env.consent.below_consent_age = true
	await _check_ad_consent(false, true, true)


func test_start_asks_consent_first_and_reports_a_required_answer_once() -> void:
	assert_true(await env.boot())
	env.adapter.consent_required = true
	env.adapter.consent_personalized = false
	env.adapter.hold("initialize")
	Env.respond_update_consent(false)
	var flow: Flow = Flow.new()
	flow.start()
	await Env.settle()
	assert_eq(env.adapter.names()[0], "request_ad_consent")
	assert_eq(env.adapter.count("initialize"), 1)
	assert_eq(Env.request_count("core/UpdateConsent"), 1)
	var request: CoreContract.UpdateConsentRequest = CoreContract.UpdateConsentRequest.new()
	assert_true(request.decode(Env.request_body("core/UpdateConsent")))
	assert_eq(request.ad_personalization, CoreContract.ConsentChoice.CONSENT_CHOICE_DENIED)
	assert_true(env.adapter.finish("initialize", true))
	await flow.wait()
	assert_true(flow.flag)
	assert_eq(Env.request_count("core/UpdateConsent"), 1)


func test_start_does_not_report_when_consent_is_not_required() -> void:
	assert_true(await env.boot())
	env.adapter.consent_required = false
	env.adapter.consent_personalized = false
	assert_true(await AdCore.start())
	assert_eq(env.adapter.names(), PackedStringArray(["request_ad_consent", "initialize"]))
	assert_eq(Env.request_count("core/UpdateConsent"), 0)


func test_start_initializes_after_a_failed_consent_request() -> void:
	assert_true(await env.boot())
	env.adapter.consent_ok = false
	env.adapter.consent_required = true
	assert_true(await AdCore.start())
	assert_eq(env.adapter.names(), PackedStringArray(["request_ad_consent", "initialize"]))
	assert_eq(UnitTestCore.check_logs("warn", "AdCore"), 1)
	assert_eq(Env.request_count("core/UpdateConsent"), 0)


func test_open_privacy_options_asks_consent_again_and_reports() -> void:
	assert_true(await env.boot())
	assert_true(await AdCore.start())
	env.adapter.privacy_required = true
	assert_true(AdCore.is_ad_privacy_options_required())
	env.adapter.calls.clear()
	env.adapter.consent_required = true
	env.adapter.consent_personalized = false
	Env.respond_update_consent(false)
	assert_true(await AdCore.open_ad_privacy_options())
	assert_eq(env.adapter.names(), PackedStringArray(["show_privacy_options", "request_ad_consent"]))
	assert_eq(Env.request_count("core/UpdateConsent"), 1)


func test_open_privacy_options_that_did_not_open_asks_consent_again_and_is_false() -> void:
	assert_true(await env.boot())
	assert_true(await AdCore.start())
	env.adapter.calls.clear()
	env.adapter.results["show_privacy_options"] = false
	env.adapter.consent_required = true
	env.adapter.consent_personalized = false
	Env.respond_update_consent(false)
	assert_false(await AdCore.open_ad_privacy_options())
	assert_eq(env.adapter.names(), PackedStringArray(["show_privacy_options", "request_ad_consent"]))
	assert_eq(Env.request_count("core/UpdateConsent"), 1)


func test_privacy_options_before_start_do_not_call_the_adapter() -> void:
	assert_true(await env.boot())
	env.adapter.privacy_required = true
	assert_false(AdCore.is_ad_privacy_options_required())
	assert_false(await AdCore.open_ad_privacy_options())
	assert_eq(env.adapter.calls.size(), 0)
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 0)
