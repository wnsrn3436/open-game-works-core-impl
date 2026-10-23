extends UnitTestCase
## Banner: one banner at a time, late `open_banner` results, no block and no pause.

const Env := preload("res://core/ad_core/tests/support/ad_test_env.gd")

var env: Env = null


func before_each() -> void:
	super()
	env = Env.new()


func _banner_a() -> int:
	return Env.id("[ad_banner_a]")


func _banner_b() -> int:
	return Env.id("[ad_banner_b]")


func _boot_started() -> void:
	assert_true(await env.boot())
	assert_true(await AdCore.start())
	env.adapter.calls.clear()


func test_show_banner_of_the_open_banner_does_nothing_and_another_one_replaces_it() -> void:
	await _boot_started()
	AdCore.show_banner(_banner_a())
	assert_eq(env.adapter.names(), PackedStringArray(["open_banner"]))
	AdCore.show_banner(_banner_a())
	assert_eq(env.adapter.names(), PackedStringArray(["open_banner"]))
	AdCore.show_banner(_banner_b())
	assert_eq(env.adapter.names(), PackedStringArray(["open_banner", "close_banner", "open_banner"]))
	assert_eq(env.adapter.last("open_banner").unit_id, "unit-%d" % _banner_b())
	assert_eq(Env.ad_blocks(), 0)
	assert_false(AdCore._show_paused)
	AdCore.hide_banner()
	assert_eq(env.adapter.count("close_banner"), 2)
	AdCore.hide_banner()
	assert_eq(env.adapter.count("close_banner"), 2)


func test_late_failure_of_a_replaced_banner_keeps_the_new_one() -> void:
	await _boot_started()
	env.adapter.hold("open_banner")
	AdCore.show_banner(_banner_a())
	AdCore.show_banner(_banner_b())
	assert_eq(env.adapter.count("open_banner"), 2)
	assert_eq(AdCore._banner_shown, _banner_b())
	assert_true(env.adapter.finish("open_banner", false))
	assert_eq(AdCore._banner_shown, _banner_b())
	assert_eq(env.adapter.count("close_banner"), 0)
	assert_eq(UnitTestCore.check_logs("warn", "AdCore"), 0)
	AdCore.hide_banner()
	assert_eq(env.adapter.count("close_banner"), 1)


func test_late_success_after_hide_banner_makes_no_banner() -> void:
	await _boot_started()
	env.adapter.hold("open_banner")
	AdCore.show_banner(_banner_a())
	AdCore.hide_banner()
	assert_eq(env.adapter.count("close_banner"), 0)
	assert_true(env.adapter.finish("open_banner", true))
	assert_eq(AdCore._banner_shown, 0)
	assert_eq(env.adapter.names(), PackedStringArray(["open_banner", "close_banner"]))


func test_failed_open_banner_leaves_no_banner_with_a_warn_log() -> void:
	await _boot_started()
	env.adapter.results["open_banner"] = false
	AdCore.show_banner(_banner_a())
	assert_eq(UnitTestCore.check_logs("warn", "AdCore"), 1)
	assert_eq(AdCore._banner_shown, 0)
	AdCore.hide_banner()
	assert_eq(env.adapter.count("close_banner"), 0)
