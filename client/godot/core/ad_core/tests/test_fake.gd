extends UnitTestCase
## The fake ads adapter with the server fake adapter: `FakeAdCallback`, the grant delta and `fake_delay_callback`.

const Env := preload("res://core/ad_core/tests/support/ad_test_env.gd")
const Flow := preload("res://core/ad_core/tests/support/ad_flow.gd")

var env: Env = null


func before_each() -> void:
	super()
	env = Env.new()
	env.ads_adapter = FakeAdsAdapter.new()


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
