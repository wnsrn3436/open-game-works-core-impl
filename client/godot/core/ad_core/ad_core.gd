class_name AdCore
extends RefCounted
## Shows rewarded, interstitial and banner ads through the ads adapter. The server `ads-reward` checks and grants the
## rewarded ad reward: AdCore gets a reward notify ID with `BeginAdReward` before the ad and the grant result with
## `ClaimAdReward` after it. Interstitial ads follow the pacing of their `ad_placement` row.

enum AdReadyState { NOT_READY, LOADING, READY, LIMIT_REACHED, UNSUPPORTED }
enum AdShowResult { COMPLETED, REWARD_PENDING, ABORTED, NOT_READY, PACED, UNSUPPORTED, FAILED }

const _TAG: String = "AdCore"
const _BLOCK_REASON: String = "ad"
const _KEY_LAST_INTERSTITIAL: String = "AdCore.last_interstitial_at"
const _KEY_OPPORTUNITY: String = "AdCore.opportunity_count"
const _SETTING_FAKE_PRESENT: String = "AdCore.fakePresentMs"
const _SETTING_SDK_CALL_TIMEOUT: String = "AdCore.sdkCallTimeoutMs"
const _SETTING_REACH_MARGIN: String = "TimeCore.reachMarginMs"
const _INT_SETTINGS: PackedStringArray = [_SETTING_FAKE_PRESENT, _SETTING_SDK_CALL_TIMEOUT, _SETTING_REACH_MARGIN]

const _CALL := preload("res://core/ad_core/ad_call.gd")
const _REQUEST := preload("res://core/ad_core/ad_request.gd")
const _SHOW_STEP := preload("res://core/ad_core/ad_show_step.gd")

## Placement check results.
const _CHECK_PASS: int = 0
const _CHECK_UNSUPPORTED: int = 1
const _CHECK_FAILED: int = 2

## The ad types an operation takes: `Rewarded` or `Interstitial`, `Interstitial` only, `Banner` only.
const _FOR_FULL_SCREEN: int = 0
const _FOR_INTERSTITIAL: int = 1
const _FOR_BANNER: int = 2

static var _is_initialized: bool = false
## New object on every `init` and `release`: a coroutine that sees another object stops.
static var _session: RefCounted = RefCounted.new()
## Set by `set_ads_adapter` before `init`. `null` is no ads adapter.
static var _adapter: AdsAdapter = null
## Ad unit ID by placement ID value.
static var _ad_units: Dictionary[int, String] = {}
static var _fake_present_ms: int = 0

## `start` was called after `init`.
static var _start_called: bool = false
## `initialize` succeeded.
static var _started: bool = false
## The `start` in progress, or `null`.
static var _start_call: _CALL = null
## Ready state (`AdReadyState`) by placement ID value. A placement that is not here is `NOT_READY`.
static var _ready_states: Dictionary[int, int] = {}

static var _showing: bool = false
static var _show_paused: bool = false
static var _show_pause_token: int = 0

## Placement of the banner that is open, or 0.
static var _banner_shown: int = 0
## Placement of the banner that is open or opening, or 0.
static var _banner_target: int = 0
## Grows on every `show_banner` that opens a banner and every `hide_banner`: a late `open_banner` result whose number
## is not this one is dropped.
static var _banner_seq: int = 0

## Opportunity count by placement ID value, read from the `user` file at the first `start`.
static var _opportunity: Dictionary[int, int] = {}
static var _last_interstitial_at: int = 0

## Waits that `release` stops.
static var _calls: Array[_CALL] = []

# DEV state of the fake adapter. `AdCoreDev` writes it; `FakeAdsAdapter` reads it.
## `AdShowResult` of the next fake `present`, or -1.
static var _fake_next_present: int = -1
## Fail flag by adapter operation name.
static var _fake_fails: Dictionary[String, bool] = {}
static var _fake_skip_callback: bool = false
static var _fake_delay_callback: bool = false
## Reward notify ID of the `present` whose `FakeAdCallback` waits for the next rewarded load.
static var _fake_delayed_notify_id: String = ""
static var _fake_consent_required: bool = false
static var _fake_consent_personalized: bool = false
static var _fake_privacy_required: bool = false


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init: already initialized")
		return false
	for key: String in _INT_SETTINGS:
		if not CoreSettings.has_int(key):
			LogCore.log_error(_TAG, "init found no integer core setting " + key)
			return false
	_fake_present_ms = CoreSettings.get_int(_SETTING_FAKE_PRESENT)
	if _adapter != null:
		_adapter.call_timeout_ms = CoreSettings.get_int(_SETTING_SDK_CALL_TIMEOUT)
	_session = RefCounted.new()
	_is_initialized = true
	return true


static func release() -> void:
	if not _is_initialized:
		return
	var adapter: AdsAdapter = _adapter
	var calls: Array[_CALL] = _calls
	if _show_paused and SoundCore.is_initialized():
		SoundCore.release_pause(_show_pause_token)
	if adapter != null:
		if _banner_shown != 0:
			adapter.close_banner()
		adapter.release()
	_is_initialized = false
	_session = RefCounted.new()
	_adapter = null
	_ad_units = {}
	_fake_present_ms = 0
	_start_called = false
	_started = false
	_start_call = null
	_ready_states = {}
	_showing = false
	_show_paused = false
	_show_pause_token = 0
	_banner_shown = 0
	_banner_target = 0
	_banner_seq = 0
	_opportunity = {}
	_last_interstitial_at = 0
	_calls = []
	_fake_next_present = -1
	_fake_fails = {}
	_fake_skip_callback = false
	_fake_delay_callback = false
	_fake_delayed_notify_id = ""
	_fake_consent_required = false
	_fake_consent_personalized = false
	_fake_privacy_required = false
	for call: _CALL in calls:
		call.abort()


static func is_initialized() -> bool:
	return _is_initialized


## Called before `init`. `adapter` is `null` when the build has no ads adapter.
static func set_ads_adapter(adapter: AdsAdapter, ad_units: Dictionary[int, String]) -> void:
	if _is_initialized:
		LogCore.log_error(_TAG, "set_ads_adapter: called after init")
		return
	_adapter = adapter
	_ad_units = ad_units.duplicate()


## Async. Asks for the ads consent and initializes the ads SDK. `BootstrapCore` calls it after login and does not wait.
static func start() -> bool:
	if not _check("start"):
		return false
	if not _start_called:
		_start_called = true
		_load_pacing()
	if _adapter == null or _started:
		return true
	var call: _CALL = _start_call
	if call == null:
		call = _CALL.new()
		_start_call = call
		_calls.append(call)
		_run_start(_session, call)
	if not call.finished:
		await call.done
	return call.flag


static func preload_ad(placement_id: int) -> void:
	if not _check("preload"):
		return
	if _placement_check("preload", placement_id, _FOR_FULL_SCREEN, true) != _CHECK_PASS:
		return
	var state: int = _state_of(placement_id)
	if state == AdReadyState.LOADING or state == AdReadyState.READY:
		return
	var row: GameData.AdPlacementRow = GameData.AdPlacementTable.get_row(placement_id)
	if row.type == GameData.AdType.REWARDED:
		if not AuthCore.is_logged_in():
			LogCore.log_error(_TAG, "preload: rewarded placement %d before login" % placement_id)
			return
		if row.limit_count > 0 and UserStateCore.get_ad_reward_count(placement_id) >= row.limit_count:
			_ready_states[placement_id] = AdReadyState.LIMIT_REACHED
			return
	_ready_states[placement_id] = AdReadyState.LOADING
	_run_load(_session, placement_id, row.type)


static func get_ready_state(placement_id: int) -> AdReadyState:
	if not _check("get_ready_state"):
		return AdReadyState.NOT_READY
	var checked: int = _placement_check("get_ready_state", placement_id, _FOR_FULL_SCREEN, false)
	if checked == _CHECK_UNSUPPORTED:
		return AdReadyState.UNSUPPORTED
	if checked != _CHECK_PASS:
		return AdReadyState.NOT_READY
	return _state_of(placement_id) as AdReadyState


## Whether an interstitial `show` of the placement passes the pacing now. Changes nothing and does not look at the
## ready state.
static func can_show(placement_id: int) -> bool:
	if not _check("can_show"):
		return false
	if _placement_check("can_show", placement_id, _FOR_INTERSTITIAL, false) != _CHECK_PASS:
		return false
	var row: GameData.AdPlacementRow = GameData.AdPlacementTable.get_row(placement_id)
	return not _is_paced(row, _opportunity_of(placement_id) + 1)


## Async. Shows a rewarded or interstitial ad.
static func show(placement_id: int) -> AdShowResult:
	if not _check("show"):
		return AdShowResult.FAILED
	var checked: int = _placement_check("show", placement_id, _FOR_FULL_SCREEN, true)
	if checked == _CHECK_UNSUPPORTED:
		return AdShowResult.UNSUPPORTED
	if checked != _CHECK_PASS:
		return AdShowResult.FAILED
	var row: GameData.AdPlacementRow = GameData.AdPlacementTable.get_row(placement_id)
	var rewarded: bool = row.type == GameData.AdType.REWARDED
	if rewarded and not AuthCore.is_logged_in():
		LogCore.log_error(_TAG, "show: rewarded placement %d before login" % placement_id)
		return AdShowResult.FAILED
	if _showing:
		LogCore.log_error(_TAG, "show: placement %d while another show is in progress" % placement_id)
		return AdShowResult.FAILED
	if not rewarded:
		var count: int = _opportunity_of(placement_id) + 1
		_opportunity[placement_id] = count
		_save_pacing()
		if _is_paced(row, count):
			return AdShowResult.PACED
	if _state_of(placement_id) != AdReadyState.READY:
		LogCore.log_warn(_TAG, "show: placement %d is not ready" % placement_id)
		return AdShowResult.NOT_READY
	var session: RefCounted = _session
	_showing = true
	_show_pause_token = SoundCore.request_pause()
	_show_paused = true
	var step: _SHOW_STEP = _SHOW_STEP.new()
	step.placement_id = placement_id
	step.ad_type = row.type
	step.unit_id = _unit_id(placement_id)
	if rewarded:
		step.user_id = AuthCore.get_user_id()
	await InputBlockCore.run_blocked(_BLOCK_REASON, AdCore._show_operation.bind(session, step))
	if session != _session:
		return AdShowResult.FAILED
	_show_paused = false
	SoundCore.release_pause(_show_pause_token)
	if not step.ran:
		_showing = false
		return AdShowResult.FAILED
	if step.begin_failed:
		_showing = false
		if step.limit_reached:
			_ready_states[placement_id] = AdReadyState.LIMIT_REACHED
			return AdShowResult.NOT_READY
		return AdShowResult.FAILED
	_ready_states[placement_id] = AdReadyState.NOT_READY
	if not rewarded:
		_opportunity.erase(placement_id)
		_last_interstitial_at = TimeCore.get_server_time()
		_save_pacing()
	var result: AdShowResult = step.present_result
	if result == AdShowResult.FAILED:
		LogCore.log_error(_TAG, "show: present failed for placement %d" % placement_id)
	elif result == AdShowResult.ABORTED and not rewarded:
		LogCore.log_error(_TAG, "show: present of interstitial placement %d returned Aborted" % placement_id)
		result = AdShowResult.COMPLETED
	elif rewarded and result == AdShowResult.COMPLETED:
		result = await _claim(session, step.notify_id)
		if session != _session:
			return AdShowResult.FAILED
	_showing = false
	preload_ad(placement_id)
	return result


static func show_banner(placement_id: int) -> void:
	if not _check("show_banner"):
		return
	if _placement_check("show_banner", placement_id, _FOR_BANNER, true) != _CHECK_PASS:
		return
	var row: GameData.AdPlacementRow = GameData.AdPlacementTable.get_row(placement_id)
	if _is_suppressed(row):
		if _banner_target == placement_id:
			_banner_seq += 1
			_banner_target = 0
			if _banner_shown == placement_id:
				_banner_shown = 0
				_adapter.close_banner()
		return
	if _banner_target == placement_id:
		return
	_banner_seq += 1
	_banner_target = placement_id
	_run_banner(_session, _banner_seq, placement_id)


static func hide_banner() -> void:
	if not _check("hide_banner"):
		return
	if _adapter == null or _banner_target == 0:
		return
	_banner_seq += 1
	_banner_target = 0
	if _banner_shown != 0:
		_banner_shown = 0
		_adapter.close_banner()


static func is_ad_privacy_options_required() -> bool:
	if not _check("is_ad_privacy_options_required"):
		return false
	if _adapter == null or not _started:
		return false
	return _adapter.is_privacy_options_required()


## Async. Opens the ads consent change screen, then asks for the ads consent again. True when the screen opened.
static func open_ad_privacy_options() -> bool:
	if not _check("open_ad_privacy_options"):
		return false
	if _adapter == null or not _started:
		return false
	var session: RefCounted = _session
	var adapter: AdsAdapter = _adapter
	var shown: _CALL = await _wait(adapter.show_privacy_options)
	if session != _session:
		return false
	var consent: _CALL = await _wait(adapter.request_ad_consent)
	if session != _session:
		return false
	await _report_consent(consent)
	if session != _session:
		return false
	return shown.flag


# --- start, load, banner ---


static func _run_start(session: RefCounted, call: _CALL) -> void:
	var adapter: AdsAdapter = _adapter
	var consent: _CALL = await _wait(adapter.request_ad_consent)
	if session != _session:
		return
	await _report_consent(consent)
	if session != _session:
		return
	var initialized: _CALL = await _wait(adapter.initialize.bind(_ad_consent()))
	if session != _session:
		return
	if initialized.flag:
		_started = true
	else:
		LogCore.log_error(_TAG, "start: initialize failed")
	if _start_call == call:
		_start_call = null
	_calls.erase(call)
	call.finish(initialized.flag)


## Reports the `personalized` answer of a `request_ad_consent` whose region asks for consent. A failed request leaves
## a warn log; a failed report goes on without a log.
static func _report_consent(consent: _CALL) -> void:
	var result: AdsAdapter.ConsentResult = consent.value as AdsAdapter.ConsentResult
	if result == null or not result.ok:
		if not consent.aborted:
			LogCore.log_warn(_TAG, "request_ad_consent failed")
		return
	if result.required:
		await _wait(AuthCore.report_ad_consent.bind(result.personalized))


static func _run_load(session: RefCounted, placement_id: int, ad_type: GameData.AdType) -> void:
	if not _started:
		var started: bool = await start()
		if session != _session:
			return
		if not started:
			_ready_states[placement_id] = AdReadyState.NOT_READY
			return
	var loaded: _CALL = await _wait(_adapter.load_ad.bind(ad_type, _unit_id(placement_id), _ad_consent()))
	if session != _session:
		return
	if loaded.flag:
		_ready_states[placement_id] = AdReadyState.READY
	else:
		_ready_states[placement_id] = AdReadyState.NOT_READY
		LogCore.log_warn(_TAG, "load failed for placement %d" % placement_id)


static func _run_banner(session: RefCounted, seq: int, placement_id: int) -> void:
	if not _started:
		var started: bool = await start()
		if session != _session or seq != _banner_seq:
			return
		if not started:
			_banner_target = 0
			return
	var adapter: AdsAdapter = _adapter
	if _banner_shown != 0:
		_banner_shown = 0
		adapter.close_banner()
	var opened: _CALL = await _wait(adapter.open_banner.bind(_unit_id(placement_id), _ad_consent()))
	if session != _session:
		return
	if seq != _banner_seq:
		if opened.flag and _banner_target == 0:
			adapter.close_banner()
		return
	if opened.flag:
		_banner_shown = placement_id
	else:
		_banner_target = 0
		LogCore.log_warn(_TAG, "open_banner failed for placement %d" % placement_id)


# --- show ---


## The `run_blocked` operation of `show`: `BeginAdReward` for a rewarded ad, then `present`.
static func _show_operation(session: RefCounted, step: _SHOW_STEP) -> bool:
	step.ran = true
	var verification: AdsAdapter.Verification = null
	if step.ad_type == GameData.AdType.REWARDED:
		var begin: CoreContract.BeginAdRewardRequest = CoreContract.BeginAdRewardRequest.new()
		begin.placement_id = step.placement_id
		var sent: _REQUEST = await _send(begin)
		if session != _session:
			return false
		var response: CoreContract.BeginAdRewardResponse = sent.response as CoreContract.BeginAdRewardResponse
		if not sent.ok or response == null:
			step.begin_failed = true
			step.limit_reached = sent.error_code == CoreContract.CoreError.CORE_ERROR_AD_LIMIT_REACHED
			return true
		step.notify_id = response.notify_id
		verification = AdsAdapter.Verification.new()
		verification.user_id = step.user_id
		verification.notify_id = step.notify_id
	var presented: _CALL = await _wait(_adapter.present.bind(step.ad_type, step.unit_id, verification))
	if session != _session:
		return false
	var result: int = presented.number
	if result == AdShowResult.COMPLETED or result == AdShowResult.ABORTED:
		step.present_result = result as AdShowResult
	else:
		step.present_result = AdShowResult.FAILED
	return true


static func _claim(session: RefCounted, notify_id: String) -> AdShowResult:
	var claim: CoreContract.ClaimAdRewardRequest = CoreContract.ClaimAdRewardRequest.new()
	claim.notify_id = notify_id
	var sent: _REQUEST = await _send(claim)
	if session != _session:
		return AdShowResult.FAILED
	if sent.ok:
		return AdShowResult.COMPLETED
	# A `false` send without the failure callback (e.g. a rejected delta) leaves the grant to a later response.
	if not sent.failed or sent.communication or sent.error_code == CoreContract.CoreError.CORE_ERROR_AD_REWARD_PENDING:
		return AdShowResult.REWARD_PENDING
	return AdShowResult.FAILED


static func _send(request: ContractRequest) -> _REQUEST:
	var sent: _REQUEST = _REQUEST.new()
	var call: _CALL = await _wait(NetworkCore.send.bind(request, sent.on_success, sent.on_failure))
	sent.ok = call.flag
	return sent


# --- pacing ---


## Whether the pacing stops an interstitial `show` whose opportunity count is `count`. Logs nothing.
static func _is_paced(row: GameData.AdPlacementRow, count: int) -> bool:
	if _is_suppressed(row):
		return true
	if row.first_show_after > 0:
		var created_at: int = UserStateCore.get_user_created_at()
		if created_at == 0 or not TimeCore.is_reached(created_at + row.first_show_after):
			return true
	if row.min_interval > 0 and _last_interstitial_at != 0:
		if not TimeCore.is_reached(_last_interstitial_at + row.min_interval):
			return true
	return row.every_n > 0 and count < row.every_n


## Pacing check 1: a product of `suppress_if_product` is owned. `PaymentCore` is in the module list when it is
## initialized.
static func _is_suppressed(row: GameData.AdPlacementRow) -> bool:
	if row.suppress_if_product.is_empty() or not PaymentCore.is_initialized():
		return false
	for product_id: int in row.suppress_if_product:
		if PaymentCore.is_owned(product_id):
			return true
	return false


static func _opportunity_of(placement_id: int) -> int:
	return _opportunity[placement_id] if _opportunity.has(placement_id) else 0


## Reads the opportunity counts and the last interstitial time from the `user` file. Drops a malformed element, an
## element with a negative count and an element whose placement came before, each with a warn log.
static func _load_pacing() -> void:
	_last_interstitial_at = LocalDataCore.get_value_int(LocalDataCore.FileKind.USER, _KEY_LAST_INTERSTITIAL, 0)
	_opportunity = {}
	var seen: Dictionary[int, bool] = {}
	for text: String in LocalDataCore.get_array_string(LocalDataCore.FileKind.USER, _KEY_OPPORTUNITY):
		var parts: PackedStringArray = text.split("=")
		if parts.size() != 2 or not parts[0].is_valid_int() or not parts[1].is_valid_int():
			LogCore.log_warn(_TAG, "%s: dropped malformed element %s" % [_KEY_OPPORTUNITY, text])
			continue
		var placement_id: int = parts[0].to_int()
		var count: int = parts[1].to_int()
		if count < 0:
			LogCore.log_warn(_TAG, "%s: dropped element %s with a negative count" % [_KEY_OPPORTUNITY, text])
			continue
		if seen.has(placement_id):
			LogCore.log_warn(_TAG, "%s: dropped element %s of a placement that came before" % [_KEY_OPPORTUNITY, text])
			continue
		seen[placement_id] = true
		if count > 0:
			_opportunity[placement_id] = count


static func _save_pacing() -> void:
	var ids: Array[int] = []
	for placement_id: int in _opportunity:
		ids.append(placement_id)
	ids.sort()
	var items: PackedStringArray = []
	for placement_id: int in ids:
		items.append("%d=%d" % [placement_id, _opportunity[placement_id]])
	LocalDataCore.set_array_string(LocalDataCore.FileKind.USER, _KEY_OPPORTUNITY, items)
	LocalDataCore.set_value_int(LocalDataCore.FileKind.USER, _KEY_LAST_INTERSTITIAL, _last_interstitial_at)


# --- helpers ---


static func _check(operation: String) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "%s: not initialized" % operation)
		return false
	return true


## Placement check 1~5. `needs_start` is false for `get_ready_state` and `can_show`, which skip check 2.
static func _placement_check(operation: String, placement_id: int, kind: int, needs_start: bool) -> int:
	if _adapter == null:
		return _CHECK_UNSUPPORTED
	if needs_start and not _start_called:
		LogCore.log_error(_TAG, "%s: placement %d before start" % [operation, placement_id])
		return _CHECK_FAILED
	if not GameData.AdPlacementTable.has_row(placement_id):
		LogCore.log_error(_TAG, "%s: placement %d is not in ad_placement" % [operation, placement_id])
		return _CHECK_FAILED
	var ad_type: GameData.AdType = GameData.AdPlacementTable.get_row(placement_id).type
	var fits: bool = false
	match kind:
		_FOR_FULL_SCREEN:
			fits = ad_type == GameData.AdType.REWARDED or ad_type == GameData.AdType.INTERSTITIAL
		_FOR_INTERSTITIAL:
			fits = ad_type == GameData.AdType.INTERSTITIAL
		_FOR_BANNER:
			fits = ad_type == GameData.AdType.BANNER
	if not fits:
		LogCore.log_error(_TAG, "%s: placement %d has ad type %d" % [operation, placement_id, ad_type])
		return _CHECK_FAILED
	if _unit_id(placement_id).is_empty():
		LogCore.log_error(_TAG, "%s: placement %d has no ad unit ID" % [operation, placement_id])
		return _CHECK_FAILED
	return _CHECK_PASS


static func _state_of(placement_id: int) -> int:
	return _ready_states[placement_id] if _ready_states.has(placement_id) else AdReadyState.NOT_READY


static func _unit_id(placement_id: int) -> String:
	var listed: String = _ad_units[placement_id] if _ad_units.has(placement_id) else ""
	return _adapter._unit_id(placement_id, listed)


## The ad consent of the session user. Before login it is the most restrictive one.
static func _ad_consent() -> AdsAdapter.AdConsent:
	var consent: AdsAdapter.AdConsent = AdsAdapter.AdConsent.new()
	if not AuthCore.is_logged_in():
		return consent
	var info: ConsentInfo = AuthCore.get_consent()
	consent.ad_personalization_allowed = info.ad_personalization_allowed
	consent.child = info.child
	consent.below_consent_age = info.below_consent_age
	return consent


## Async. Calls `operation` and waits until it ends or `release` stops the wait.
static func _wait(operation: Callable) -> _CALL:
	var call: _CALL = _CALL.new()
	_calls.append(call)
	_run(call, operation)
	if not call.finished:
		await call.done
	_calls.erase(call)
	return call


# ogw:input_boundary
static func _run(call: _CALL, operation: Callable) -> void:
	var result: Variant = await operation.call()
	call.finish(result)
