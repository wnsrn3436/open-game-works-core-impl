extends UnitTestCase
## The fake ads adapter with the server fake adapter: `FakeAdCallback`, the grant delta and `fake_delay_callback`.

const Env := preload("res://core/ad_core/tests/support/ad_test_env.gd")
const Flow := preload("res://core/ad_core/tests/support/ad_flow.gd")
const Fake := preload("res://core/ad_core/dev/adapters/fake_ads_adapter.gd")

var env: Env = null
var fake: Fake = null


func before_each() -> void:
	super()
	env = Env.new()
	fake = Fake.new()
	env.ads_adapter = fake


func _basic() -> int:
	return Env.id("[ad_rewarded_basic]")


func _gem() -> int:
	return Env.id("[ad_gem]")


func _boot_ready() -> void:
	assert_true(await env.boot())
	assert_true(await AdCore.start())
	AdCore.preload_ad(_basic())
	assert_eq(AdCore.get_ready_state(_basic()), AdCore.AdReadyState.READY)


static func _callback_notify_id(index: int) -> String:
	var request: CoreCheatContract.FakeAdCallbackRequest = CoreCheatContract.FakeAdCallbackRequest.new()
	if not request.decode(Env.request_body("core/cheat/FakeAdCallback", index)):
		return ""
	return request.notify_id


func test_rewarded_show_with_the_fake_adapters_completes_and_applies_the_grant() -> void:
	await _boot_ready()
	Env.respond_begin("notify-fake")
	Env.respond("core/cheat/FakeAdCallback", CoreCheatContract.FakeAdCallbackResponse.new())
	Env.respond_claim(_basic(), 1, 0, _gem(), 10)
	assert_eq(await AdCore.show(_basic()), AdCore.AdShowResult.COMPLETED)
	assert_eq(UserStateCore.get_item_balance(_gem()), 10)
	assert_eq(_callback_notify_id(0), "notify-fake")
	var names: PackedStringArray = Env.request_names()
	assert_lt(names.find("core/BeginAdReward"), names.find("core/cheat/FakeAdCallback"))
	assert_lt(names.find("core/cheat/FakeAdCallback"), names.find("core/ClaimAdReward"))


func test_delayed_callback_is_reward_pending_and_the_grant_comes_as_pending_delta() -> void:
	await _boot_ready()
	AdCoreDev.fake_delay_callback()
	Env.respond_begin("notify-late")
	Env.respond_error("core/ClaimAdReward", CoreContract.CoreError.CORE_ERROR_AD_REWARD_PENDING)
	Env.respond("core/cheat/FakeAdCallback", CoreCheatContract.FakeAdCallbackResponse.new())
	assert_eq(await AdCore.show(_basic()), AdCore.AdShowResult.REWARD_PENDING)
	await Env.settle()
	assert_eq(Env.request_count("core/cheat/FakeAdCallback"), 1)
	assert_eq(_callback_notify_id(0), "notify-late")
	var names: PackedStringArray = Env.request_names()
	assert_lt(names.find("core/ClaimAdReward"), names.find("core/cheat/FakeAdCallback"))
	assert_eq(AdCore.get_ready_state(_basic()), AdCore.AdReadyState.READY)
	assert_eq(UserStateCore.get_item_balance(_gem()), 0)
	var pending: CoreContract.UserStateDelta = Env.delta_of([Env.balance_entry(_gem(), 10)])
	var begin: CoreContract.BeginAdRewardResponse = CoreContract.BeginAdRewardResponse.new()
	begin.notify_id = "notify-next"
	Env.respond("core/BeginAdReward", begin, null, pending)
	Env.respond("core/cheat/FakeAdCallback", CoreCheatContract.FakeAdCallbackResponse.new())
	var counted: CoreContract.UserStateDelta = Env.delta_of([Env.reward_count_entry(_basic(), 2, 0)])
	Env.respond("core/ClaimAdReward", CoreContract.ClaimAdRewardResponse.new(), counted)
	assert_eq(await AdCore.show(_basic()), AdCore.AdShowResult.COMPLETED)
	assert_eq(UserStateCore.get_item_balance(_gem()), 10)
	assert_eq(_callback_notify_id(1), "notify-next")


func test_fake_present_results_and_failures() -> void:
	var plain: int = Env.id("[ad_interstitial_plain]")
	assert_true(await env.boot())
	assert_true(await AdCore.start())
	AdCore.preload_ad(plain)
	AdCoreDev.fake_set_next_present_result(AdCore.AdShowResult.FAILED)
	assert_eq(await AdCore.show(plain), AdCore.AdShowResult.FAILED)
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 1)
	assert_eq(await AdCore.show(plain), AdCore.AdShowResult.COMPLETED)
	AdCoreDev.fake_set_fail("load", true)
	AdCore.preload_ad(Env.id("[ad_interstitial_every3]"))
	assert_eq(AdCore.get_ready_state(Env.id("[ad_interstitial_every3]")), AdCore.AdReadyState.NOT_READY)
	assert_eq(UnitTestCore.check_logs("warn", "AdCore"), 1)
	AdCoreDev.fake_set_next_present_result(AdCore.AdShowResult.REWARD_PENDING)
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 1)


func test_dev_values_are_on_the_fake_adapter_and_release_clears_them() -> void:
	assert_true(await env.boot())
	AdCoreDev.fake_set_next_present_result(AdCore.AdShowResult.ABORTED)
	AdCoreDev.fake_set_fail("load", true)
	AdCoreDev.fake_skip_callback()
	AdCoreDev.fake_delay_callback()
	AdCoreDev.fake_set_ad_consent(true, true, true)
	assert_eq(fake.next_present, AdCore.AdShowResult.ABORTED)
	assert_true(fake.fails["load"])
	assert_true(fake.skip_callback)
	assert_true(fake.delay_callback)
	assert_true(fake.consent_required)
	assert_true(fake.consent_personalized)
	assert_true(fake.privacy_required)
	AdCore.release()
	assert_eq(fake.next_present, -1)
	assert_eq(fake.fails.size(), 0)
	assert_false(fake.skip_callback)
	assert_false(fake.delay_callback)
	assert_eq(fake.delayed_notify_id, "")
	assert_false(fake.consent_required)
	assert_false(fake.consent_personalized)
	assert_false(fake.privacy_required)


func test_dev_operations_change_nothing_on_another_ads_adapter() -> void:
	env.ads_adapter = env.adapter
	assert_true(await env.boot())
	AdCoreDev.fake_set_next_present_result(AdCore.AdShowResult.ABORTED)
	AdCoreDev.fake_set_fail("load", true)
	AdCoreDev.fake_set_ad_consent(true, true, true)
	assert_eq(fake.next_present, -1)
	assert_eq(fake.fails.size(), 0)
	assert_false(fake.consent_required)
	assert_true(await AdCore.start())
	AdCore.preload_ad(_basic())
	assert_eq(AdCore.get_ready_state(_basic()), AdCore.AdReadyState.READY)


func test_present_covers_the_screen_for_the_fake_present_ms_core_setting() -> void:
	await _boot_ready()
	assert_true(Env.settings({"AdCore.fakePresentMs": 200}))
	Env.respond_begin("notify-cover")
	Env.respond("core/cheat/FakeAdCallback", CoreCheatContract.FakeAdCallbackResponse.new())
	Env.respond_claim(_basic(), 1, 0, _gem(), 10)
	var root: Window = (Engine.get_main_loop() as SceneTree).root
	var flow: Flow = Flow.new()
	flow.show(_basic())
	await Env.settle()
	assert_not_null(root.get_node_or_null("FakeAd"))
	UnitTestCore.advance_clock(150, false)
	await Env.settle()
	assert_false(flow.finished)
	assert_not_null(root.get_node_or_null("FakeAd"))
	UnitTestCore.advance_clock(50, false)
	await flow.wait()
	assert_eq(flow.result, AdCore.AdShowResult.COMPLETED)
	assert_null(root.get_node_or_null("FakeAd"))
