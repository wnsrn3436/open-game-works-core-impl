class_name AdCoreDev
extends RefCounted
## DEV operations of AdCore: the results and the failures of the fake ads adapter. The values last until `release`.

const _TAG: String = "AdCore"
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
	AdCore._fake_next_present = result


## Makes the fake adapter operation `operation` (the spec adapter operation name) fail while `fail` is true.
static func fake_set_fail(operation: String, fail: bool) -> void:
	if not _check("fake_set_fail"):
		return
	if not _OPERATIONS.has(operation):
		LogCore.log_error(_TAG, "fake_set_fail: %s is not an adapter operation" % operation)
		return
	AdCore._fake_fails[operation] = fail


## The next rewarded `present` sends no `FakeAdCallback`.
static func fake_skip_callback() -> void:
	if not _check("fake_skip_callback"):
		return
	AdCore._fake_skip_callback = true


## The next rewarded `present` sends no `FakeAdCallback`; the first rewarded load after it sends the one of that
## `present` and waits for its result.
static func fake_delay_callback() -> void:
	if not _check("fake_delay_callback"):
		return
	AdCore._fake_delay_callback = true


## What the fake `request_ad_consent` and `is_privacy_options_required` return.
static func fake_set_ad_consent(required: bool, personalized: bool, privacy_options_required: bool) -> void:
	if not _check("fake_set_ad_consent"):
		return
	AdCore._fake_consent_required = required
	AdCore._fake_consent_personalized = personalized
	AdCore._fake_privacy_required = privacy_options_required


static func _check(operation: String) -> bool:
	if not AdCore.is_initialized():
		LogCore.log_error(_TAG, "%s: not initialized" % operation)
		return false
	return true
