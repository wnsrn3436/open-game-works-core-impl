extends UnitTestCase
## `show`: block and pause, `present` results, the ready state, `BeginAdReward` and `ClaimAdReward`.

const Env := preload("res://core/ad_core/tests/support/ad_test_env.gd")
const Flow := preload("res://core/ad_core/tests/support/ad_flow.gd")
const TestAdapter := preload("res://core/ad_core/tests/support/recording_ads_adapter.gd")

var env: Env = null


func before_each() -> void:
	super()
	env = Env.new()


func _basic() -> int:
	return Env.id("[ad_rewarded_basic]")


func _plain() -> int:
	return Env.id("[ad_interstitial_plain]")


func _gem() -> int:
	return Env.id("[ad_gem]")


## Boots, starts and preloads `placement_id` to `READY`.
func _ready_placement(placement_id: int) -> void:
	assert_true(await env.boot())
	assert_true(await AdCore.start())
	AdCore.preload_ad(placement_id)
	assert_eq(AdCore.get_ready_state(placement_id), AdCore.AdReadyState.READY)


func test_present_holds_one_ad_block_and_one_pause() -> void:
	await _ready_placement(_basic())
	Env.respond_begin("notify-1")
	Env.respond_claim(_basic(), 1, 0, _gem(), 10)
	env.adapter.hold("present")
	var flow: Flow = Flow.new()
	flow.show(_basic())
	await Env.settle()
	assert_eq(env.adapter.held_count("present"), 1)
	assert_eq(Env.ad_blocks(), 1)
	assert_true(AdCore._show_paused)
	assert_true(await Env.holds_show_pause())
	assert_true(env.adapter.finish("present", true, AdCore.AdShowResult.COMPLETED))
	await flow.wait()
	assert_eq(flow.result, AdCore.AdShowResult.COMPLETED)
	assert_eq(Env.ad_blocks(), 0)
	assert_false(AdCore._show_paused)
	assert_true(await Env.no_sound_pause())


func test_interstitial_show_returns_the_present_result() -> void:
	await _ready_placement(_plain())
	env.adapter.present_results = [AdCore.AdShowResult.COMPLETED, AdCore.AdShowResult.FAILED, AdCore.AdShowResult.ABORTED]
	assert_eq(await AdCore.show(_plain()), AdCore.AdShowResult.COMPLETED)
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 0)
	assert_eq(await AdCore.show(_plain()), AdCore.AdShowResult.FAILED)
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 1)
	assert_eq(await AdCore.show(_plain()), AdCore.AdShowResult.COMPLETED)
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 1)


func test_rewarded_present_aborted_is_aborted() -> void:
	await _ready_placement(_basic())
	Env.respond_begin("notify-1")
	env.adapter.present_results = [AdCore.AdShowResult.ABORTED]
	assert_eq(await AdCore.show(_basic()), AdCore.AdShowResult.ABORTED)
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 0)


func test_show_of_a_placement_that_is_not_ready_is_not_ready() -> void:
	assert_true(await env.boot())
	assert_true(await AdCore.start())
	assert_eq(await AdCore.show(_basic()), AdCore.AdShowResult.NOT_READY)
	env.adapter.hold("load")
	AdCore.preload_ad(_plain())
	assert_eq(AdCore.get_ready_state(_plain()), AdCore.AdReadyState.LOADING)
	assert_eq(await AdCore.show(_plain()), AdCore.AdShowResult.NOT_READY)
	assert_eq(UnitTestCore.check_logs("warn", "AdCore"), 2)
	assert_eq(env.adapter.count("present"), 0)
	assert_eq(Env.request_count("core/BeginAdReward"), 0)
	assert_eq(Env.ad_blocks(), 0)
	assert_false(AdCore._show_paused)
	assert_eq(AdCore._show_pause_token, SoundCore.INVALID_PAUSE_TOKEN)
	assert_true(await Env.no_sound_pause())
	assert_true(env.adapter.finish("load", true))


func test_show_leaves_the_placement_loading() -> void:
	await _ready_placement(_plain())
	env.adapter.hold("load")
	assert_eq(await AdCore.show(_plain()), AdCore.AdShowResult.COMPLETED)
	assert_eq(AdCore.get_ready_state(_plain()), AdCore.AdReadyState.LOADING)
	assert_true(env.adapter.finish("load", true))
	assert_eq(AdCore.get_ready_state(_plain()), AdCore.AdReadyState.READY)


func test_rewarded_show_loads_after_claim() -> void:
	await _ready_placement(_basic())
	Env.respond_begin("notify-1")
	UnitTestCore.add_pending("core/ClaimAdReward")
	env.adapter.hold("load")
	var flow: Flow = Flow.new()
	flow.show(_basic())
	await Env.settle()
	assert_eq(env.adapter.count("present"), 1)
	assert_eq(env.adapter.count("load"), 1)
	assert_false(flow.finished)
	var delta: CoreContract.UserStateDelta = Env.delta_of([Env.reward_count_entry(_basic(), 1, 0), Env.balance_entry(_gem(), 10)])
	var body: PackedByteArray = Env.envelope(CoreContract.ClaimAdRewardResponse.new(), 0, delta)
	assert_true(UnitTestCore.release_pending("core/ClaimAdReward", NetworkCore.TransferResult.DONE, 200, body))
	await flow.wait()
	assert_eq(flow.result, AdCore.AdShowResult.COMPLETED)
	assert_eq(env.adapter.count("load"), 2)
	assert_eq(AdCore.get_ready_state(_basic()), AdCore.AdReadyState.LOADING)
	assert_true(env.adapter.finish("load", true))


func test_claim_that_reaches_the_limit_leaves_limit_reached() -> void:
	var once: int = Env.id("[ad_rewarded_once]")
	await _ready_placement(once)
	Env.respond_begin("notify-1")
	var reset_at: int = Env.SERVER_TIME + 86400000
	Env.respond_claim(once, 1, reset_at, _gem(), 5)
	assert_eq(await AdCore.show(once), AdCore.AdShowResult.COMPLETED)
	assert_eq(AdCore.get_ready_state(once), AdCore.AdReadyState.LIMIT_REACHED)
	assert_eq(env.adapter.count("load"), 1)


func test_rewarded_show_sends_begin_before_present_with_the_verification_value() -> void:
	await _ready_placement(_basic())
	UnitTestCore.add_pending("core/BeginAdReward")
	Env.respond_claim(_basic(), 1, 0, _gem(), 10)
	var flow: Flow = Flow.new()
	flow.show(_basic())
	await Env.settle()
	assert_eq(Env.request_count("core/BeginAdReward"), 1)
	assert_eq(env.adapter.count("present"), 0)
	assert_eq(Env.ad_blocks(), 1)
	assert_true(AdCore._show_paused)
	assert_true(await Env.holds_show_pause())
	var response: CoreContract.BeginAdRewardResponse = CoreContract.BeginAdRewardResponse.new()
	response.notify_id = "notify-7"
	assert_true(UnitTestCore.release_pending("core/BeginAdReward", NetworkCore.TransferResult.DONE, 200, Env.envelope(response)))
	await flow.wait()
	assert_eq(flow.result, AdCore.AdShowResult.COMPLETED)
	var begin: CoreContract.BeginAdRewardRequest = CoreContract.BeginAdRewardRequest.new()
	assert_true(begin.decode(Env.request_body("core/BeginAdReward")))
	assert_eq(begin.placement_id, _basic())
	var present: TestAdapter.Call = env.adapter.last("present")
	assert_not_null(present.verification)
	assert_eq(present.verification.user_id, Env.USER_ID)
	assert_eq(present.verification.notify_id, "notify-7")


func test_interstitial_show_sends_no_request_and_no_verification() -> void:
	await _ready_placement(_plain())
	var before: int = UnitTestCore.received_requests().size()
	assert_eq(await AdCore.show(_plain()), AdCore.AdShowResult.COMPLETED)
	assert_eq(UnitTestCore.received_requests().size(), before)
	assert_null(env.adapter.last("present").verification)


func test_preload_sends_no_request() -> void:
	assert_true(await env.boot())
	assert_true(await AdCore.start())
	var before: int = UnitTestCore.received_requests().size()
	AdCore.preload_ad(_basic())
	AdCore.preload_ad(_plain())
	await Env.settle()
	assert_eq(UnitTestCore.received_requests().size(), before)


func test_begin_limit_reached_is_not_ready_without_present() -> void:
	await _ready_placement(_basic())
	Env.respond_error("core/BeginAdReward", CoreContract.CoreError.CORE_ERROR_AD_LIMIT_REACHED)
	assert_eq(await AdCore.show(_basic()), AdCore.AdShowResult.NOT_READY)
	assert_eq(AdCore.get_ready_state(_basic()), AdCore.AdReadyState.LIMIT_REACHED)
	assert_eq(env.adapter.count("present"), 0)
	assert_eq(Env.ad_blocks(), 0)
	assert_false(AdCore._show_paused)
	assert_true(await Env.no_sound_pause())
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 0)


func test_begin_other_failure_is_failed_and_keeps_ready() -> void:
	await _ready_placement(_basic())
	Env.respond_error("core/BeginAdReward", CoreContract.CoreError.CORE_ERROR_FEATURE_DISABLED)
	assert_eq(await AdCore.show(_basic()), AdCore.AdShowResult.FAILED)
	assert_eq(AdCore.get_ready_state(_basic()), AdCore.AdReadyState.READY)
	assert_eq(env.adapter.count("present"), 0)
	assert_eq(Env.ad_blocks(), 0)
	assert_false(AdCore._show_paused)
	assert_true(await Env.no_sound_pause())
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 0)


func test_completed_rewarded_show_claims_with_the_begin_notify_id() -> void:
	await _ready_placement(_basic())
	Env.respond_begin("notify-9")
	Env.respond_claim(_basic(), 1, 0, _gem(), 10)
	assert_eq(await AdCore.show(_basic()), AdCore.AdShowResult.COMPLETED)
	assert_eq(Env.request_count("core/ClaimAdReward"), 1)
	var claim: CoreContract.ClaimAdRewardRequest = CoreContract.ClaimAdRewardRequest.new()
	assert_true(claim.decode(Env.request_body("core/ClaimAdReward")))
	assert_eq(claim.notify_id, "notify-9")
	assert_eq(UserStateCore.get_item_balance(_gem()), 10)
	var names: PackedStringArray = Env.request_names()
	assert_lt(names.find("core/BeginAdReward"), names.find("core/ClaimAdReward"))


func test_claim_reward_pending_is_reward_pending() -> void:
	await _ready_placement(_basic())
	Env.respond_begin("notify-1")
	Env.respond_error("core/ClaimAdReward", CoreContract.CoreError.CORE_ERROR_AD_REWARD_PENDING)
	assert_eq(await AdCore.show(_basic()), AdCore.AdShowResult.REWARD_PENDING)


func test_claim_communication_failure_is_reward_pending() -> void:
	assert_true(Env.settings({"NetworkCore.retryDelayMs": 0, "NetworkCore.retryDelayMaxMs": 0}))
	await _ready_placement(_basic())
	Env.respond_begin("notify-1")
	Env.respond_offline("core/ClaimAdReward")
	assert_eq(await AdCore.show(_basic()), AdCore.AdShowResult.REWARD_PENDING)
	UnitTestCore.check_logs("error", "NetworkCore")
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 0)


func test_claim_with_a_rejected_delta_is_reward_pending() -> void:
	await _ready_placement(_basic())
	Env.respond_begin("notify-1")
	var delta: CoreContract.UserStateDelta = CoreContract.UserStateDelta.new()
	delta.entries.append(Env.balance_entry(_gem(), 10))
	delta.entries.append(Env.balance_entry(_gem(), 20))
	Env.respond("core/ClaimAdReward", CoreContract.ClaimAdRewardResponse.new(), delta)
	assert_eq(await AdCore.show(_basic()), AdCore.AdShowResult.REWARD_PENDING)
	assert_eq(Env.request_count("core/ClaimAdReward"), 1)
	assert_eq(UserStateCore.get_item_balance(_gem()), 0)
	assert_eq(UnitTestCore.check_logs("error", "UserStateCore"), 1)
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 0)


func test_claim_other_error_is_failed() -> void:
	await _ready_placement(_basic())
	Env.respond_begin("notify-1")
	Env.respond_error("core/ClaimAdReward", CoreContract.CoreError.CORE_ERROR_AD_REWARD_NOT_FOUND)
	assert_eq(await AdCore.show(_basic()), AdCore.AdShowResult.FAILED)
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 0)


func test_no_claim_for_interstitial_aborted_rewarded_and_banner() -> void:
	await _ready_placement(_plain())
	assert_eq(await AdCore.show(_plain()), AdCore.AdShowResult.COMPLETED)
	AdCore.preload_ad(_basic())
	Env.respond_begin("notify-1")
	env.adapter.present_results = [AdCore.AdShowResult.ABORTED]
	assert_eq(await AdCore.show(_basic()), AdCore.AdShowResult.ABORTED)
	Env.respond_begin("notify-2")
	env.adapter.present_results = [AdCore.AdShowResult.FAILED]
	assert_eq(await AdCore.show(_basic()), AdCore.AdShowResult.FAILED)
	UnitTestCore.check_logs("error", "AdCore")
	AdCore.show_banner(Env.id("[ad_banner_a]"))
	await Env.settle()
	assert_eq(env.adapter.count("open_banner"), 1)
	assert_eq(Env.request_count("core/ClaimAdReward"), 0)
	assert_eq(Env.request_count("core/BeginAdReward"), 2)
