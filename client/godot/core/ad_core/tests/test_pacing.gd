extends UnitTestCase
## Interstitial pacing: `every_n`, `min_interval`, `first_show_after`, `suppress_if_product`, `can_show` and the
## opportunity counts in the `user` file.

const Env := preload("res://core/ad_core/tests/support/ad_test_env.gd")

const KEY_OPPORTUNITY: String = "AdCore.opportunity_count"
const KEY_LAST: String = "AdCore.last_interstitial_at"

var env: Env = null


func before_each() -> void:
	super()
	env = Env.new()


func _margin() -> int:
	return CoreSettings.get_int("TimeCore.reachMarginMs")


func _boot_started() -> void:
	assert_true(await env.boot())
	assert_true(await AdCore.start())


func test_every_n_paces_the_first_two_shows_of_three() -> void:
	var every3: int = Env.id("[ad_interstitial_every3]")
	await _boot_started()
	AdCore.preload_ad(every3)
	assert_false(AdCore.can_show(every3))
	assert_eq(await AdCore.show(every3), AdCore.AdShowResult.PACED)
	assert_false(AdCore.can_show(every3))
	assert_eq(await AdCore.show(every3), AdCore.AdShowResult.PACED)
	assert_eq(env.adapter.count("present"), 0)
	assert_true(AdCore.can_show(every3))
	assert_eq(await AdCore.show(every3), AdCore.AdShowResult.COMPLETED)
	assert_eq(env.adapter.count("present"), 1)
	assert_false(AdCore.can_show(every3))
	assert_eq(UnitTestCore.check_logs("warn", "AdCore"), 0)


func test_can_show_before_start_reads_nothing() -> void:
	var every3: int = Env.id("[ad_interstitial_every3]")
	var interval: int = Env.id("[ad_interstitial_interval]")
	assert_true(await env.boot())
	var stored: PackedStringArray = ["%d=2" % every3]
	LocalDataCore.set_array_string(LocalDataCore.FileKind.USER, KEY_OPPORTUNITY, stored)
	LocalDataCore.set_value_int(LocalDataCore.FileKind.USER, KEY_LAST, Env.SERVER_TIME)
	assert_false(AdCore.can_show(every3))
	assert_true(AdCore.can_show(interval))
	assert_eq(UnitTestCore.check_logs("error", "LocalDataCore"), 0)
	assert_eq(LocalDataCore.get_array_string(LocalDataCore.FileKind.USER, KEY_OPPORTUNITY), stored)
	assert_eq(LocalDataCore.get_value_int(LocalDataCore.FileKind.USER, KEY_LAST, 0), Env.SERVER_TIME)
	assert_true(await AdCore.start())
	assert_true(AdCore.can_show(every3))
	assert_false(AdCore.can_show(interval))


func test_min_interval_paces_until_the_interval_ends() -> void:
	var interval: int = Env.id("[ad_interstitial_interval]")
	await _boot_started()
	AdCore.preload_ad(interval)
	assert_eq(await AdCore.show(interval), AdCore.AdShowResult.COMPLETED)
	var shown_at: int = TimeCore.get_server_time()
	assert_eq(LocalDataCore.get_value_int(LocalDataCore.FileKind.USER, KEY_LAST, 0), shown_at)
	assert_eq(await AdCore.show(interval), AdCore.AdShowResult.PACED)
	UnitTestCore.advance_clock(30000 + _margin() - 1, false)
	assert_eq(await AdCore.show(interval), AdCore.AdShowResult.PACED)
	UnitTestCore.advance_clock(1, false)
	assert_true(AdCore.can_show(interval))
	assert_eq(await AdCore.show(interval), AdCore.AdShowResult.COMPLETED)
	assert_eq(env.adapter.count("present"), 2)


func test_first_show_after_paces_until_after_user_creation() -> void:
	var first: int = Env.id("[ad_interstitial_first]")
	await _boot_started()
	AdCore.preload_ad(first)
	var until: int = Env.CREATED_AT + 3600000 + _margin()
	UnitTestCore.advance_clock(until - TimeCore.get_server_time() - 1, false)
	assert_eq(await AdCore.show(first), AdCore.AdShowResult.PACED)
	assert_eq(env.adapter.count("present"), 0)
	UnitTestCore.advance_clock(1, false)
	assert_eq(await AdCore.show(first), AdCore.AdShowResult.COMPLETED)


func test_owned_second_product_suppresses_interstitial_and_banner() -> void:
	var suppress: int = Env.id("[ad_interstitial_suppress]")
	var banner: int = Env.id("[ad_banner_suppress]")
	env.payment = true
	env.login_delta = Env.delta_of([Env.iap_purchase_entry(Env.id("[iap_no_ads]"), 1)])
	await _boot_started()
	assert_false(PaymentCore.is_owned(Env.id("[iap_vip]")))
	assert_true(PaymentCore.is_owned(Env.id("[iap_no_ads]")))
	AdCore.preload_ad(suppress)
	assert_false(AdCore.can_show(suppress))
	assert_eq(await AdCore.show(suppress), AdCore.AdShowResult.PACED)
	AdCore.show_banner(banner)
	assert_eq(env.adapter.count("present"), 0)
	assert_eq(env.adapter.count("open_banner"), 0)


## Makes `[iap_no_ads]` owned, as a purchase response does.
func _own_no_ads() -> void:
	assert_true(UserStateCoreDev.apply_test_delta(Env.delta_of([Env.iap_purchase_entry(Env.id("[iap_no_ads]"), 1)])))
	assert_true(PaymentCore.is_owned(Env.id("[iap_no_ads]")))


func test_show_banner_of_a_suppressed_placement_closes_its_open_banner() -> void:
	var banner: int = Env.id("[ad_banner_suppress]")
	env.payment = true
	await _boot_started()
	AdCore.show_banner(banner)
	assert_eq(env.adapter.count("open_banner"), 1)
	assert_eq(AdCore._banner_shown, banner)
	_own_no_ads()
	AdCore.show_banner(banner)
	assert_eq(env.adapter.count("close_banner"), 1)
	assert_eq(AdCore._banner_shown, 0)
	assert_eq(env.adapter.count("open_banner"), 1)
	AdCore.hide_banner()
	assert_eq(env.adapter.count("close_banner"), 1)


func test_late_success_of_a_banner_suppressed_while_opening_closes_it() -> void:
	var banner: int = Env.id("[ad_banner_suppress]")
	env.payment = true
	await _boot_started()
	env.adapter.hold("open_banner")
	AdCore.show_banner(banner)
	assert_eq(env.adapter.held_count("open_banner"), 1)
	_own_no_ads()
	AdCore.show_banner(banner)
	assert_eq(env.adapter.count("close_banner"), 0)
	assert_true(env.adapter.finish("open_banner", true))
	assert_eq(env.adapter.names().slice(-2), PackedStringArray(["open_banner", "close_banner"]))
	assert_eq(AdCore._banner_shown, 0)
	assert_eq(AdCore._banner_target, 0)
	assert_eq(UnitTestCore.check_logs("warn", "AdCore"), 0)


func test_products_not_owned_do_not_suppress() -> void:
	var suppress: int = Env.id("[ad_interstitial_suppress]")
	var banner: int = Env.id("[ad_banner_suppress]")
	env.payment = true
	await _boot_started()
	AdCore.preload_ad(suppress)
	assert_true(AdCore.can_show(suppress))
	assert_eq(await AdCore.show(suppress), AdCore.AdShowResult.COMPLETED)
	AdCore.show_banner(banner)
	assert_eq(env.adapter.count("open_banner"), 1)


func test_no_payment_core_in_the_module_list_does_not_suppress() -> void:
	var suppress: int = Env.id("[ad_interstitial_suppress]")
	var banner: int = Env.id("[ad_banner_suppress]")
	env.login_delta = Env.delta_of([Env.iap_purchase_entry(Env.id("[iap_no_ads]"), 1)])
	await _boot_started()
	assert_false(PaymentCore.is_initialized())
	AdCore.preload_ad(suppress)
	assert_eq(await AdCore.show(suppress), AdCore.AdShowResult.COMPLETED)
	AdCore.show_banner(banner)
	assert_eq(env.adapter.count("open_banner"), 1)


func test_pacing_state_lasts_over_release_and_init() -> void:
	var every3: int = Env.id("[ad_interstitial_every3]")
	var plain: int = Env.id("[ad_interstitial_plain]")
	await _boot_started()
	AdCore.preload_ad(plain)
	assert_eq(await AdCore.show(plain), AdCore.AdShowResult.COMPLETED)
	var shown_at: int = TimeCore.get_server_time()
	assert_eq(await AdCore.show(every3), AdCore.AdShowResult.PACED)
	assert_eq(await AdCore.show(every3), AdCore.AdShowResult.PACED)
	AdCore.release()
	assert_true(env.start_ad())
	assert_true(await AdCore.start())
	assert_eq(AdCore._opportunity_of(every3), 2)
	assert_eq(AdCore._last_interstitial_at, shown_at)
	assert_true(AdCore.can_show(every3))


func test_malformed_opportunity_elements_are_dropped_with_warn_logs() -> void:
	assert_true(await env.boot())
	LocalDataCore.set_array_string(LocalDataCore.FileKind.USER, KEY_OPPORTUNITY, PackedStringArray(["5=2", "5=7", "x", "6=-1"]))
	assert_true(await AdCore.start())
	assert_eq(AdCore._opportunity_of(5), 2)
	assert_eq(AdCore._opportunity_of(6), 0)
	assert_eq(UnitTestCore.check_logs("warn", "AdCore"), 3)
