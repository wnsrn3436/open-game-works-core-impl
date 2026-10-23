extends AdsAdapter
## Ads adapter of the AdCore core tests. Records every call in order, returns the results the test sets, and holds
## the calls of an operation the test asked to hold until the test finishes them.


## One adapter call.
class Call extends RefCounted:
	var name: String = ""
	var ad_type: GameData.AdType = GameData.AdType.NONE
	var unit_id: String = ""
	## The ad consent the call got, or `null`.
	var consent: AdsAdapter.AdConsent = null
	## The verification value `present` got, or `null`.
	var verification: AdsAdapter.Verification = null


## A held call.
class Hold extends RefCounted:
	signal done
	var name: String = ""
	var flag: bool = false
	var number: int = 0


var calls: Array[Call] = []
## Result by operation name (`initialize`, `load`, `open_banner`, `show_privacy_options`). True when not set.
var results: Dictionary[String, bool] = {}
## Results of the next `present` calls, in order. `COMPLETED` when empty.
var present_results: Array[int] = []
var consent_ok: bool = true
var consent_required: bool = false
var consent_personalized: bool = false
var privacy_required: bool = false
## Number of the next calls to hold, by operation name.
var _hold_next: Dictionary[String, int] = {}
var _held: Array[Hold] = []


## Holds the next call of `operation` until `finish`.
func hold(operation: String) -> void:
	_hold_next[operation] = (_hold_next[operation] if _hold_next.has(operation) else 0) + 1


## Ends the oldest held call of `operation` with `flag` (bool result) or `number` (`present` result).
func finish(operation: String, flag: bool, number: int = AdCore.AdShowResult.COMPLETED) -> bool:
	for index: int in _held.size():
		var held: Hold = _held[index]
		if held.name == operation:
			_held.remove_at(index)
			held.flag = flag
			held.number = number
			held.done.emit()
			return true
	return false


func held_count(operation: String) -> int:
	var count: int = 0
	for held: Hold in _held:
		if held.name == operation:
			count += 1
	return count


func count(operation: String) -> int:
	var found: int = 0
	for call: Call in calls:
		if call.name == operation:
			found += 1
	return found


## The last call of `operation`, or `null`.
func last(operation: String) -> Call:
	for index: int in range(calls.size() - 1, -1, -1):
		if calls[index].name == operation:
			return calls[index]
	return null


func names() -> PackedStringArray:
	var out: PackedStringArray = []
	for call: Call in calls:
		out.append(call.name)
	return out


func request_ad_consent() -> ConsentResult:
	_record("request_ad_consent")
	var held: Hold = await _hold_of("request_ad_consent")
	var result: ConsentResult = ConsentResult.new()
	result.ok = held.flag if held != null else consent_ok
	result.required = consent_required
	result.personalized = consent_personalized
	return result


func is_privacy_options_required() -> bool:
	_record("is_privacy_options_required")
	return privacy_required


func show_privacy_options() -> bool:
	_record("show_privacy_options")
	var held: Hold = await _hold_of("show_privacy_options")
	return held.flag if held != null else _result("show_privacy_options")


func initialize(consent: AdConsent) -> bool:
	_record("initialize", GameData.AdType.NONE, "", consent)
	var held: Hold = await _hold_of("initialize")
	return held.flag if held != null else _result("initialize")


func load_ad(ad_type: GameData.AdType, unit_id: String, consent: AdConsent) -> bool:
	_record("load", ad_type, unit_id, consent)
	var held: Hold = await _hold_of("load")
	return held.flag if held != null else _result("load")


func present(ad_type: GameData.AdType, unit_id: String, verification: Verification) -> AdCore.AdShowResult:
	var call: Call = _record("present", ad_type, unit_id)
	call.verification = verification
	var held: Hold = await _hold_of("present")
	var result: int = AdCore.AdShowResult.COMPLETED
	if held != null:
		result = held.number
	elif not present_results.is_empty():
		result = present_results.pop_front()
	return result as AdCore.AdShowResult


func open_banner(unit_id: String, consent: AdConsent) -> bool:
	_record("open_banner", GameData.AdType.BANNER, unit_id, consent)
	var held: Hold = await _hold_of("open_banner")
	return held.flag if held != null else _result("open_banner")


func close_banner() -> void:
	_record("close_banner")


func release() -> void:
	_record("release")


func _record(operation: String, ad_type: GameData.AdType = GameData.AdType.NONE, unit_id: String = "", consent: AdConsent = null) -> Call:
	var call: Call = Call.new()
	call.name = operation
	call.ad_type = ad_type
	call.unit_id = unit_id
	call.consent = consent
	calls.append(call)
	return call


func _result(operation: String) -> bool:
	return results[operation] if results.has(operation) else true


## Waits for the test to finish the call when it is held; `null` at once when it is not.
func _hold_of(operation: String) -> Hold:
	var left: int = _hold_next[operation] if _hold_next.has(operation) else 0
	if left <= 0:
		return null
	_hold_next[operation] = left - 1
	var held: Hold = Hold.new()
	held.name = operation
	_held.append(held)
	await held.done
	return held
