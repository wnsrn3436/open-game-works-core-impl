extends UnitTestCase
## `init`, `release`, the state `release` leaves, `release` during `present` and `set_ads_adapter` after `init`.

const Env := preload("res://core/ad_core/tests/support/ad_test_env.gd")
const Flow := preload("res://core/ad_core/tests/support/ad_flow.gd")

var env: Env = null


func before_each() -> void:
	super()
	env = Env.new()


func _basic() -> int:
	return Env.id("[ad_rewarded_basic]")


func _assert_initial_state() -> void:
	assert_false(AdCore._is_initialized)
	assert_null(AdCore._adapter)
	assert_eq(AdCore._ad_units.size(), 0)
	assert_eq(AdCore._fake_present_ms, 0)
	assert_false(AdCore._start_called)
	assert_false(AdCore._started)
	assert_null(AdCore._start_call)
	assert_eq(AdCore._ready_states.size(), 0)
	assert_false(AdCore._showing)
	assert_false(AdCore._show_paused)
	assert_eq(AdCore._show_pause_token, 0)
	assert_eq(AdCore._banner_shown, 0)
	assert_eq(AdCore._banner_target, 0)
	assert_eq(AdCore._banner_seq, 0)
	assert_eq(AdCore._opportunity.size(), 0)
	assert_eq(AdCore._last_interstitial_at, 0)
	assert_eq(AdCore._calls.size(), 0)
	assert_eq(AdCore._fake_next_present, -1)
	assert_eq(AdCore._fake_fails.size(), 0)
	assert_false(AdCore._fake_skip_callback)
	assert_false(AdCore._fake_delay_callback)
	assert_eq(AdCore._fake_delayed_notify_id, "")
	assert_false(AdCore._fake_consent_required)
	assert_false(AdCore._fake_consent_personalized)
	assert_false(AdCore._fake_privacy_required)


func test_init_release_and_the_state_release_leaves() -> void:
	assert_false(AdCore.is_initialized())
	assert_true(await env.boot())
	assert_true(AdCore.is_initialized())
	var session: RefCounted = AdCore._session
	assert_true(await AdCore.start())
	AdCore.preload_ad(_basic())
	AdCore.show_banner(Env.id("[ad_banner_a]"))
	assert_eq(await AdCore.show(Env.id("[ad_interstitial_every3]")), AdCore.AdShowResult.PACED)
	AdCoreDev.fake_set_next_present_result(AdCore.AdShowResult.ABORTED)
	AdCoreDev.fake_set_fail("load", true)
	AdCoreDev.fake_skip_callback()
	AdCoreDev.fake_delay_callback()
	AdCoreDev.fake_set_ad_consent(true, true, true)
	AdCore.release()
	assert_false(AdCore.is_initialized())
	assert_ne(AdCore._session, session)
	_assert_initial_state()
	assert_null((Engine.get_main_loop() as SceneTree).root.get_node_or_null("AdCore"))
	assert_true(env.start_ad())
	assert_true(AdCore.is_initialized())
	assert_false(AdCore.init())
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 1)


func test_operations_after_release_fail_with_an_error() -> void:
	assert_true(await env.boot())
	AdCore.release()
	assert_false(await AdCore.start())
	assert_eq(await AdCore.show(_basic()), AdCore.AdShowResult.FAILED)
	assert_eq(AdCore.get_ready_state(_basic()), AdCore.AdReadyState.NOT_READY)
	assert_false(AdCore.can_show(_basic()))
	AdCore.preload_ad(_basic())
	AdCore.show_banner(_basic())
	AdCore.hide_banner()
	assert_false(AdCore.is_ad_privacy_options_required())
	assert_false(await AdCore.open_ad_privacy_options())
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 9)


func test_set_ads_adapter_after_init_is_ignored_with_an_error() -> void:
	env.ads_adapter = null
	assert_true(await env.boot())
	AdCore.set_ads_adapter(env.adapter, env.ad_units)
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 1)
	assert_null(AdCore._adapter)
	assert_eq(AdCore.get_ready_state(_basic()), AdCore.AdReadyState.UNSUPPORTED)


func test_release_during_present_fails_the_show_and_clears_everything() -> void:
	assert_true(await env.boot())
	assert_true(await AdCore.start())
	AdCore.show_banner(Env.id("[ad_banner_a]"))
	AdCore.preload_ad(_basic())
	Env.respond_begin("notify-1")
	env.adapter.hold("present")
	var flow: Flow = Flow.new()
	flow.show(_basic())
	await Env.settle()
	assert_eq(env.adapter.held_count("present"), 1)
	assert_eq(Env.ad_blocks(), 1)
	assert_true(await Env.holds_show_pause())
	AdCore.release()
	await flow.wait()
	assert_eq(flow.result, AdCore.AdShowResult.FAILED)
	assert_eq(Env.ad_blocks(), 0)
	assert_false(AdCore._show_paused)
	assert_true(await Env.no_sound_pause())
	assert_eq(env.adapter.count("close_banner"), 1)
	assert_eq(env.adapter.count("release"), 1)
	assert_true(env.adapter.finish("present", true, AdCore.AdShowResult.COMPLETED))
	await Env.settle()
	assert_eq(Env.request_count("core/ClaimAdReward"), 0)
	assert_eq(UnitTestCore.check_logs("error", "SoundCore"), 0)
	env.adapter.calls.clear()
	assert_true(env.start_ad())
	assert_eq(AdCore.get_ready_state(_basic()), AdCore.AdReadyState.NOT_READY)
	assert_eq(AdCore.get_ready_state(Env.id("[ad_interstitial_plain]")), AdCore.AdReadyState.NOT_READY)
	assert_true(await AdCore.start())
	assert_eq(env.adapter.count("initialize"), 1)
