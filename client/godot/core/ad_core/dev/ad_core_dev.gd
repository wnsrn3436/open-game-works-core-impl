class_name AdCoreDev
extends RefCounted
## DEV operations of AdCore: the results and the failures of the fake ads adapter AdCore holds. Nothing changes when
## AdCore holds another ads adapter. The values last until `release`.

const _TAG: String = "AdCore"
## Read through this constant and not the global class name (see `PushCoreDev`).
const _FAKE := preload("res://core/ad_core/dev/adapters/fake_ads_adapter.gd")
const _OPERATIONS: PackedStringArray = [
	"request_ad_consent",
	"is_privacy_options_required",
	"show_privacy_options",
	"initialize",
	"load",
	"present",
	"open_banner",
	"close_banner",
]


## The result of the next fake `present`: `COMPLETED`, `ABORTED` or `FAILED`.
static func fake_set_next_present_result(result: AdCore.AdShowResult) -> void:
	if not _check("fake_set_next_present_result"):
		return
	if result != AdCore.AdShowResult.COMPLETED and result != AdCore.AdShowResult.ABORTED and result != AdCore.AdShowResult.FAILED:
		LogCore.log_error(_TAG, "fake_set_next_present_result: %d is not Completed, Aborted or Failed" % result)
		return
	var fake: _FAKE = _fake()
	if fake != null:
		fake.next_present = result


## Makes the fake adapter operation `operation` (the spec adapter operation name) fail while `fail` is true.
static func fake_set_fail(operation: String, fail: bool) -> void:
	if not _check("fake_set_fail"):
		return
	if not _OPERATIONS.has(operation):
		LogCore.log_error(_TAG, "fake_set_fail: %s is not an adapter operation" % operation)
		return
	var fake: _FAKE = _fake()
	if fake != null:
		fake.fails[operation] = fail


## The next rewarded `present` sends no `FakeAdCallback`.
static func fake_skip_callback() -> void:
	if not _check("fake_skip_callback"):
		return
	var fake: _FAKE = _fake()
	if fake != null:
		fake.skip_callback = true


## The next rewarded `present` sends no `FakeAdCallback`; the first rewarded load after it sends the one of that
## `present` and waits for its result.
static func fake_delay_callback() -> void:
	if not _check("fake_delay_callback"):
		return
	var fake: _FAKE = _fake()
	if fake != null:
		fake.delay_callback = true


## What the fake `request_ad_consent` and `is_privacy_options_required` return.
static func fake_set_ad_consent(required: bool, personalized: bool, privacy_options_required: bool) -> void:
	if not _check("fake_set_ad_consent"):
		return
	var fake: _FAKE = _fake()
	if fake != null:
		fake.consent_required = required
		fake.consent_personalized = personalized
		fake.privacy_required = privacy_options_required


static func _check(operation: String) -> bool:
	if not AdCore.is_initialized():
		LogCore.log_error(_TAG, "%s: not initialized" % operation)
		return false
	return true


## The fake ads adapter AdCore holds, or `null`.
static func _fake() -> _FAKE:
	return AdCore._adapter as _FAKE
