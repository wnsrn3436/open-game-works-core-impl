extends UnitTestCase
## Placement check, `preload` and its ready states, the limit judgment and the unit IDs the adapter gets.

const Env := preload("res://core/ad_core/tests/support/ad_test_env.gd")
const Flow := preload("res://core/ad_core/tests/support/ad_flow.gd")

const UNKNOWN_PLACEMENT: int = 2147483000

var env: Env = null


func before_each() -> void:
	super()
	env = Env.new()


func _basic() -> int:
	return Env.id("[ad_rewarded_basic]")


func _plain() -> int:
	return Env.id("[ad_interstitial_plain]")


func _banner_a() -> int:
	return Env.id("[ad_banner_a]")


func _assert_no_ad_calls() -> void:
	assert_eq(env.adapter.count("load"), 0)
	assert_eq(env.adapter.count("present"), 0)
	assert_eq(env.adapter.count("open_banner"), 0)


func test_operations_before_start_fail_with_an_error() -> void:
	assert_true(await env.boot())
	AdCore.preload_ad(_basic())
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 1)
	assert_eq(await AdCore.show(_plain()), AdCore.AdShowResult.FAILED)
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 1)
	AdCore.show_banner(_banner_a())
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 1)
	assert_eq(AdCore.get_ready_state(_basic()), AdCore.AdReadyState.NOT_READY)
	assert_true(AdCore.can_show(_plain()))
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 0)
	await Env.settle()
	_assert_no_ad_calls()


func test_placement_not_in_ad_placement_fails_with_an_error() -> void:
	assert_true(await env.boot())
	assert_true(await AdCore.start())
	AdCore.preload_ad(UNKNOWN_PLACEMENT)
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 1)
	assert_eq(AdCore.get_ready_state(UNKNOWN_PLACEMENT), AdCore.AdReadyState.NOT_READY)
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 1)
	assert_false(AdCore.can_show(UNKNOWN_PLACEMENT))
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 1)
	assert_eq(await AdCore.show(UNKNOWN_PLACEMENT), AdCore.AdShowResult.FAILED)
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 1)
	AdCore.show_banner(UNKNOWN_PLACEMENT)
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 1)
	await Env.settle()
	_assert_no_ad_calls()


func test_placement_of_another_ad_type_fails_with_an_error() -> void:
	assert_true(await env.boot())
	assert_true(await AdCore.start())
	AdCore.show_banner(_basic())
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 1)
	AdCore.preload_ad(_banner_a())
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 1)
	assert_eq(AdCore.get_ready_state(_banner_a()), AdCore.AdReadyState.NOT_READY)
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 1)
	assert_false(AdCore.can_show(_basic()))
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 1)
	assert_eq(await AdCore.show(_banner_a()), AdCore.AdShowResult.FAILED)
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 1)
	await Env.settle()
	_assert_no_ad_calls()


func test_placement_with_no_unit_id_fails_with_an_error() -> void:
	assert_true(await env.boot())
	AdCore.release()
	env.ad_units.erase(_plain())
	env.ad_units.erase(_banner_a())
	assert_true(env.start_ad())
	assert_true(await AdCore.start())
	AdCore.preload_ad(_plain())
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 1)
	assert_eq(await AdCore.show(_plain()), AdCore.AdShowResult.FAILED)
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 1)
	AdCore.show_banner(_banner_a())
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 1)
	await Env.settle()
	_assert_no_ad_calls()


func test_adapter_gets_the_unit_id_of_the_ad_unit_list() -> void:
	assert_true(await env.boot())
	assert_true(await AdCore.start())
	AdCore.preload_ad(_plain())
	assert_eq(await AdCore.show(_plain()), AdCore.AdShowResult.COMPLETED)
	AdCore.show_banner(_banner_a())
	await Env.settle()
	assert_eq(env.adapter.last("load").unit_id, "unit-%d" % _plain())
	assert_eq(env.adapter.last("present").unit_id, "unit-%d" % _plain())
	assert_eq(env.adapter.last("open_banner").unit_id, "unit-%d" % _banner_a())


func test_rewarded_show_before_login_fails_with_an_error() -> void:
	assert_true(await env.boot(false))
	# `start` runs at `AfterLogin`, after the `user` file load; the session is not logged in here.
	assert_true(LocalDataCore.load_user_file(Env.USER_ID))
	assert_true(await AdCore.start())
	assert_eq(await AdCore.show(_basic()), AdCore.AdShowResult.FAILED)
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 1)
	_assert_no_ad_calls()


func test_show_while_another_show_is_in_progress_fails_with_an_error() -> void:
	assert_true(await env.boot())
	assert_true(await AdCore.start())
	AdCore.preload_ad(_plain())
	AdCore.preload_ad(_basic())
	env.adapter.hold("present")
	var flow: Flow = Flow.new()
	flow.show(_plain())
	await Env.settle()
	assert_eq(await AdCore.show(_basic()), AdCore.AdShowResult.FAILED)
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 1)
	assert_eq(env.adapter.count("present"), 1)
	assert_eq(Env.request_count("core/BeginAdReward"), 0)
	assert_true(env.adapter.finish("present", true, AdCore.AdShowResult.COMPLETED))
	await flow.wait()
	assert_eq(flow.result, AdCore.AdShowResult.COMPLETED)


func test_preload_goes_loading_then_ready_or_not_ready() -> void:
	assert_true(await env.boot())
	assert_true(await AdCore.start())
	env.adapter.hold("load")
	env.adapter.hold("load")
	AdCore.preload_ad(_basic())
	assert_eq(AdCore.get_ready_state(_basic()), AdCore.AdReadyState.LOADING)
	AdCore.preload_ad(_basic())
	assert_eq(env.adapter.count("load"), 1)
	assert_true(env.adapter.finish("load", true))
	assert_eq(AdCore.get_ready_state(_basic()), AdCore.AdReadyState.READY)
	AdCore.preload_ad(_basic())
	assert_eq(env.adapter.count("load"), 1)
	AdCore.preload_ad(_plain())
	assert_eq(AdCore.get_ready_state(_plain()), AdCore.AdReadyState.LOADING)
	assert_true(env.adapter.finish("load", false))
	assert_eq(AdCore.get_ready_state(_plain()), AdCore.AdReadyState.NOT_READY)
	assert_eq(UnitTestCore.check_logs("warn", "AdCore"), 1)
	assert_eq(env.adapter.count("load"), 2)


func test_rewarded_preload_before_login_is_an_error_without_load() -> void:
	assert_true(await env.boot(false))
	# `start` runs at `AfterLogin`, after the `user` file load; the session is not logged in here.
	assert_true(LocalDataCore.load_user_file(Env.USER_ID))
	assert_true(await AdCore.start())
	AdCore.preload_ad(_basic())
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 1)
	assert_eq(AdCore.get_ready_state(_basic()), AdCore.AdReadyState.NOT_READY)
	await Env.settle()
	assert_eq(env.adapter.count("load"), 0)


func test_preload_at_the_limit_is_limit_reached_until_the_reset() -> void:
	var daily: int = Env.id("[ad_rewarded_daily]")
	var reset_at: int = Env.SERVER_TIME + 60000
	env.login_delta = Env.delta_of([Env.reward_count_entry(daily, 2, reset_at)])
	assert_true(await env.boot())
	assert_true(await AdCore.start())
	var requests: int = UnitTestCore.received_requests().size()
	AdCore.preload_ad(daily)
	assert_eq(AdCore.get_ready_state(daily), AdCore.AdReadyState.LIMIT_REACHED)
	await Env.settle()
	assert_eq(env.adapter.count("load"), 0)
	assert_eq(UnitTestCore.received_requests().size(), requests)
	var margin: int = CoreSettings.get_int("TimeCore.reachMarginMs")
	UnitTestCore.advance_clock(reset_at + margin - Env.SERVER_TIME - 1, false)
	AdCore.preload_ad(daily)
	assert_eq(AdCore.get_ready_state(daily), AdCore.AdReadyState.LIMIT_REACHED)
	assert_eq(env.adapter.count("load"), 0)
	UnitTestCore.advance_clock(1, false)
	AdCore.preload_ad(daily)
	assert_eq(env.adapter.count("load"), 1)
	assert_eq(AdCore.get_ready_state(daily), AdCore.AdReadyState.READY)
