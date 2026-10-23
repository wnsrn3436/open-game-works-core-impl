extends UnitTestCase
## The `admob` adapter over a `ogw-ads-admob` plugin singleton that never answers. `initialize`, `load` and
## `open_banner` fail at `AdCore.sdkCallTimeoutMs`; `request_ad_consent` and `present` wait for the user with no time
## limit until `release`. When the adapter stops waiting it stops reading the plugin and tells it with `cancel`.

const Env := preload("res://core/ad_core/tests/support/ad_test_env.gd")
const Flow := preload("res://core/ad_core/tests/support/ad_flow.gd")
const SilentPlugin := preload("res://core/ad_core/tests/support/silent_admob_plugin.gd")

const _SINGLETON: String = "OgwAdsAdmob"
const _TIMEOUT_MS: int = 4000
const _OK: PackedStringArray = ["0"]
const _CONSENT_NOT_REQUIRED: PackedStringArray = ["0", "0", "0"]

var env: Env = null
var _plugin: SilentPlugin = null


func before_each() -> void:
	super()
	env = Env.new()
	# The ads SDK initialization of the adapter lasts for the process: each test starts with none.
	AdmobAdapter._sdk_ready = false


func after_each() -> void:
	super()
	AdmobAdapter._sdk_ready = false
	if Engine.has_singleton(_SINGLETON):
		Engine.unregister_singleton(_SINGLETON)
	if _plugin != null:
		_plugin.free()
		_plugin = null


func test_release_ends_a_consent_request_that_never_ends() -> void:
	_plugin = SilentPlugin.new()
	Engine.register_singleton(_SINGLETON, _plugin)
	env.ads_adapter = AdmobAdapter.new()
	assert_true(await env.boot())
	var flow: Flow = Flow.new()
	flow.start()
	await Env.settle()
	assert_eq(_plugin.started.size(), 1)
	var first: String = _plugin.started[1] if _plugin.started.has(1) else ""
	assert_eq(first, "request_consent")
	UnitTestCore.advance_clock(3600000, false)
	await Env.settle()
	assert_false(flow.finished, "the adapter operation waits with no time limit")
	assert_eq(_plugin.cancelled.size(), 0)
	AdCore.release()
	await flow.wait()
	assert_false(flow.flag, "release ends start with false")
	await UnitTestCore.wait_frames(2)
	assert_eq(_plugin.cancelled, PackedInt64Array([1]), "the plugin is told once")
	assert_eq(_plugin.discards, 1)
	var polls: int = _plugin.polls
	assert_gt(polls, 0)
	await UnitTestCore.wait_frames(4)
	assert_eq(_plugin.polls, polls, "the adapter stops reading the plugin")
	assert_eq(_plugin.started.size(), 1, "no initialize after release")


## Registers the plugin with `answers` and boots AdCore with the `admob` adapter.
func _boot_with(answers: Dictionary[String, PackedStringArray]) -> void:
	assert_true(Env.settings({"AdCore.sdkCallTimeoutMs": _TIMEOUT_MS}))
	_plugin = SilentPlugin.new()
	_plugin.answers = answers
	Engine.register_singleton(_SINGLETON, _plugin)
	env.ads_adapter = AdmobAdapter.new()
	assert_true(await env.boot())
	assert_eq(env.ads_adapter.call_timeout_ms, _TIMEOUT_MS, "init sets the adapter time limit")


## `take_result` calls stay the same over a few frames.
func _stopped_reading() -> bool:
	var polls: int = _plugin.polls
	await UnitTestCore.wait_frames(4)
	return polls > 0 and _plugin.polls == polls


func test_an_initialize_that_never_ends_fails_start_at_the_time_limit() -> void:
	await _boot_with({"request_consent": _CONSENT_NOT_REQUIRED})
	var flow: Flow = Flow.new()
	flow.start()
	await Env.settle()
	assert_eq(_plugin.id_of("initialize"), 2, "initialize after the consent request")
	UnitTestCore.advance_clock(_TIMEOUT_MS - 1, false)
	await Env.settle()
	assert_false(flow.finished, "not before the time limit")
	UnitTestCore.advance_clock(1, false)
	await flow.wait()
	assert_false(flow.flag, "start is false")
	assert_eq(_plugin.cancelled, PackedInt64Array([2]), "the plugin is told once")
	assert_true(await _stopped_reading(), "the adapter stops reading the plugin")
	assert_eq(UnitTestCore.check_logs("error", "AdCore"), 1, "start: initialize failed")


func test_a_load_that_never_ends_is_not_ready_at_the_time_limit() -> void:
	await _boot_with({"request_consent": _CONSENT_NOT_REQUIRED, "initialize": _OK})
	assert_true(await AdCore.start())
	var placement: int = Env.id("[ad_interstitial_plain]")
	AdCore.preload_ad(placement)
	await Env.settle()
	assert_eq(AdCore.get_ready_state(placement), AdCore.AdReadyState.LOADING)
	UnitTestCore.advance_clock(_TIMEOUT_MS - 1, false)
	await Env.settle()
	assert_eq(AdCore.get_ready_state(placement), AdCore.AdReadyState.LOADING, "not before the time limit")
	UnitTestCore.advance_clock(1, false)
	await Env.settle()
	assert_eq(AdCore.get_ready_state(placement), AdCore.AdReadyState.NOT_READY)
	assert_eq(_plugin.cancelled, PackedInt64Array([_plugin.id_of("load_ad")]), "the plugin is told once")
	assert_true(await _stopped_reading(), "the adapter stops reading the plugin")
	assert_eq(UnitTestCore.check_logs("warn", "AdCore"), 1, "load failed")


func test_an_open_banner_that_never_ends_fails_at_the_time_limit() -> void:
	await _boot_with({"request_consent": _CONSENT_NOT_REQUIRED, "initialize": _OK})
	assert_true(await AdCore.start())
	AdCore.show_banner(Env.id("[ad_banner_a]"))
	await Env.settle()
	assert_gt(_plugin.id_of("open_banner"), 0)
	UnitTestCore.advance_clock(_TIMEOUT_MS - 1, false)
	await Env.settle()
	assert_eq(_plugin.cancelled.size(), 0, "not before the time limit")
	UnitTestCore.advance_clock(1, false)
	await Env.settle()
	assert_eq(_plugin.cancelled, PackedInt64Array([_plugin.id_of("open_banner")]), "the plugin is told once")
	assert_true(await _stopped_reading(), "the adapter stops reading the plugin")
	assert_eq(AdCore._banner_shown, 0)
	assert_eq(UnitTestCore.check_logs("warn", "AdCore"), 1, "open_banner failed")


func test_a_present_that_never_ends_waits_with_no_time_limit_until_release() -> void:
	await _boot_with({"request_consent": _CONSENT_NOT_REQUIRED, "initialize": _OK, "load_ad": _OK})
	assert_true(await AdCore.start())
	var placement: int = Env.id("[ad_interstitial_plain]")
	AdCore.preload_ad(placement)
	await Env.settle()
	assert_eq(AdCore.get_ready_state(placement), AdCore.AdReadyState.READY)
	var flow: Flow = Flow.new()
	flow.show(placement)
	await Env.settle()
	assert_gt(_plugin.id_of("present"), 0)
	UnitTestCore.advance_clock(_TIMEOUT_MS * 10, false)
	await Env.settle()
	assert_false(flow.finished, "present waits for the user with no time limit")
	assert_eq(_plugin.cancelled.size(), 0)
	AdCore.release()
	await flow.wait()
	assert_eq(flow.result, AdCore.AdShowResult.FAILED, "release ends show with Failed")
	await UnitTestCore.wait_frames(2)
	assert_eq(_plugin.cancelled, PackedInt64Array([_plugin.id_of("present")]), "the plugin is told once")
	assert_true(await _stopped_reading(), "the adapter stops reading the plugin")
