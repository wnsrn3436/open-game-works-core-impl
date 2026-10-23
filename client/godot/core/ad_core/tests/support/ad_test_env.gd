extends RefCounted
## Boot, dev login, fake server responses and request reading of the AdCore core tests.

const TestAdapter := preload("res://core/ad_core/tests/support/recording_ads_adapter.gd")

const SERVER_TIME: int = 1700000000000
const USER_ID: int = 7001
const CREATED_AT: int = SERVER_TIME - 1000
## Long enough that no test advances the clock into the access token refresh.
const TOKEN_TTL_MS: int = 2592000000
## The resource key of `[ui_button_click]` in the core test data. `UICore.prepare` loads it.
const CLICK: String = "sfx/ui_button_click"
const RESOURCES: String = "res://core/ad_core/tests/resources/"
const REPORT_ERRORS: String = "core/ReportClientErrors"

var adapter: TestAdapter = TestAdapter.new()
## Ads adapter `start_ad` passes. `null` passes no adapter.
var ads_adapter: AdsAdapter = adapter
## Ad unit list `start_ad` passes. `boot` fills it with `unit-<placement ID value>` for every `ad_placement` row.
var ad_units: Dictionary[int, String] = {}
## Inits `PaymentCore` too.
var payment: bool = false
## UserState delta of the dev login response, or `null`.
var login_delta: CoreContract.UserStateDelta = null
## Consent of the session user.
var consent: CoreContract.ConsentUserState = consent_state()


static func id(id_name: String) -> int:
	return GameDataDev.find_id_value(id_name)


## Test settings. Call before `boot`.
static func settings(values: Dictionary[String, int]) -> bool:
	var ok: bool = true
	for key: String in values:
		ok = UnitTestCore.set_test_settings(key, values[key]) and ok
	return ok


## Inits the module list of AdCore, loads the core test data, logs in when `login` and inits AdCore.
func boot(login: bool = true) -> bool:
	if not UnitTestCore.set_test_settings("AdCore.fakePresentMs", 0):
		return false
	var keys: Dictionary[String, String] = {CLICK: RESOURCES + "test_click.tres"}
	ResourceCoreDev.set_test_key_list(keys)
	var inits: Array[Callable] = [
		LogCore.init,
		EventCore.init,
		TimeCore.init,
		LocalDataCore.init,
		ResourceCore.init,
		DataCore.init,
		PoolCore.init,
		InputBlockCore.init,
		ResolutionCore.init,
		SafeAreaCore.init,
		InputCore.init,
		LocalizationCore.init,
		SoundCore.init,
		TweenCore.init,
		UICore.init,
		MessageCore.init,
		UserStateCore.init,
		NetworkCore.init,
	]
	for init: Callable in inits:
		if init.call() != true:
			return false
	if not LocalDataCore.load_device_file():
		return false
	if not await DataCore.load(null):
		return false
	if LocalizationCore.resolve_language() == 0:
		return false
	var translations: Array[DownloadedTranslation] = []
	if not await LocalizationCore.load_translation(translations):
		return false
	if not NetworkCore.set_server_info("http://127.0.0.1", "", "android"):
		return false
	await UICore.prepare()
	await MessageCore.prepare()
	if not AuthCore.init():
		return false
	if payment and not PaymentCore.init():
		return false
	if login and not await log_in():
		return false
	for row: GameData.AdPlacementRow in GameData.AdPlacementTable.all_rows():
		ad_units[row.id] = "unit-%d" % row.id
	return start_ad()


## Passes the adapter and the ad unit list and inits AdCore.
func start_ad() -> bool:
	AdCore.set_ads_adapter(ads_adapter, ad_units)
	return AdCore.init()


## Dev login of `USER_ID` and the load of its `user` file.
func log_in() -> bool:
	var result: CoreContract.AuthResult = CoreContract.AuthResult.new()
	result.user_id = USER_ID
	result.user_created_at = CREATED_AT
	result.login_token = "token-ad"
	result.access_token = "access-ad"
	result.access_token_expires_at = SERVER_TIME + TOKEN_TTL_MS
	result.session_signing_key = "key-ad"
	result.consent = consent
	var response: CoreCheatContract.DevLoginResponse = CoreCheatContract.DevLoginResponse.new()
	response.result = result
	respond("core/cheat/DevLogin", response, login_delta)
	var login: LoginResult = await AuthCoreDev.dev_login("ad_tester")
	if login.status != AuthCore.LoginStatus.SUCCESS:
		return false
	# LogCore sends the error logs of a test through NetworkCore once a session is open.
	for i: int in 8:
		UnitTestCore.add_result(REPORT_ERRORS, NetworkCore.TransferResult.DONE, 200, envelope(null))
	return LocalDataCore.load_user_file(USER_ID)


static func consent_state() -> CoreContract.ConsentUserState:
	var state: CoreContract.ConsentUserState = CoreContract.ConsentUserState.new()
	state.age_confirmed_at = SERVER_TIME
	state.privacy_version = 1
	state.analytics = CoreContract.ConsentChoice.CONSENT_CHOICE_GRANTED
	state.analytics_allowed = true
	state.ad_personalization = CoreContract.ConsentChoice.CONSENT_CHOICE_GRANTED
	state.ad_personalization_allowed = true
	state.tracking = CoreContract.TrackingStatus.TRACKING_STATUS_NOT_APPLICABLE
	return state


# --- server responses ---


static func envelope(
	body: ContractMessage, code: int = 0, delta: CoreContract.UserStateDelta = null, pending: CoreContract.UserStateDelta = null
) -> PackedByteArray:
	var response: CoreContract.ResponseEnvelope = CoreContract.ResponseEnvelope.new()
	response.server_time_at = SERVER_TIME
	if code != 0:
		var error: CoreContract.ServerError = CoreContract.ServerError.new()
		error.code = code
		response.error = error
	elif body != null:
		response.body = body.encode()
	response.user_state = delta
	response.pending_user_state = pending
	return UnitTestCore.make_response(response)


static func respond(
	request_name: String, body: ContractMessage, delta: CoreContract.UserStateDelta = null, pending: CoreContract.UserStateDelta = null
) -> void:
	UnitTestCore.add_result(request_name, NetworkCore.TransferResult.DONE, 200, envelope(body, 0, delta, pending))


static func respond_error(request_name: String, code: int) -> void:
	UnitTestCore.add_result(request_name, NetworkCore.TransferResult.DONE, 200, envelope(null, code))


## Communication failures for every send of a `SilentRetry` request: the first send, the resend without a screen and
## the `NetworkCore.retryCount` retries.
static func respond_offline(request_name: String) -> void:
	for i: int in CoreSettings.get_int("NetworkCore.retryCount") + 2:
		UnitTestCore.add_result(request_name, NetworkCore.TransferResult.CONNECTION_FAILED, 0, PackedByteArray())


static func respond_begin(notify_id: String) -> void:
	var response: CoreContract.BeginAdRewardResponse = CoreContract.BeginAdRewardResponse.new()
	response.notify_id = notify_id
	respond("core/BeginAdReward", response)


## `ClaimAdReward` that granted `amount` of `item_id` and made the reward count of the placement `count`.
static func respond_claim(placement_id: int, count: int, reset_at: int, item_id: int, amount: int) -> void:
	var delta: CoreContract.UserStateDelta = CoreContract.UserStateDelta.new()
	delta.entries.append(reward_count_entry(placement_id, count, reset_at))
	delta.entries.append(balance_entry(item_id, amount))
	respond("core/ClaimAdReward", CoreContract.ClaimAdRewardResponse.new(), delta)


static func respond_update_consent(personalized: bool) -> void:
	var state: CoreContract.ConsentUserState = consent_state()
	state.ad_personalization = (
		CoreContract.ConsentChoice.CONSENT_CHOICE_GRANTED if personalized else CoreContract.ConsentChoice.CONSENT_CHOICE_DENIED
	)
	state.ad_personalization_allowed = personalized
	var response: CoreContract.UpdateConsentResponse = CoreContract.UpdateConsentResponse.new()
	response.consent = state
	respond("core/UpdateConsent", response)


static func reward_count_entry(placement_id: int, count: int, reset_at: int) -> CoreContract.UserStateEntry:
	var state: CoreContract.AdRewardCountUserState = CoreContract.AdRewardCountUserState.new()
	state.id = placement_id
	state.count = count
	state.reset_at = reset_at
	return entry("AdRewardCountUserState", placement_id, state)


static func balance_entry(item_id: int, amount: int) -> CoreContract.UserStateEntry:
	var state: CoreContract.ItemBalanceUserState = CoreContract.ItemBalanceUserState.new()
	state.id = item_id
	state.amount = amount
	return entry("ItemBalanceUserState", item_id, state)


static func iap_purchase_entry(product_id: int, count: int) -> CoreContract.UserStateEntry:
	var state: CoreContract.IapPurchaseUserState = CoreContract.IapPurchaseUserState.new()
	state.id = product_id
	state.count = count
	return entry("IapPurchaseUserState", product_id, state)


static func entry(kind: String, entry_id: int, message: ContractMessage) -> CoreContract.UserStateEntry:
	var out: CoreContract.UserStateEntry = CoreContract.UserStateEntry.new()
	out.kind = kind
	out.id = entry_id
	out.value = message.encode()
	return out


static func delta_of(entries: Array[CoreContract.UserStateEntry]) -> CoreContract.UserStateDelta:
	var delta: CoreContract.UserStateDelta = CoreContract.UserStateDelta.new()
	delta.entries = entries
	return delta


# --- requests the fake network got ---


static func request_count(request_name: String) -> int:
	var found: int = 0
	for request: UnitTestRequest in UnitTestCore.received_requests():
		if request.name == request_name:
			found += 1
	return found


## Body of the `index`-th request of the name, or empty bytes.
static func request_body(request_name: String, index: int = 0) -> PackedByteArray:
	var seen: int = 0
	for request: UnitTestRequest in UnitTestCore.received_requests():
		if request.name == request_name:
			if seen == index:
				return request.body
			seen += 1
	return PackedByteArray()


static func request_names() -> PackedStringArray:
	var names: PackedStringArray = []
	for request: UnitTestRequest in UnitTestCore.received_requests():
		names.append(request.name)
	return names


## Active blocks whose reason tag is `ad`.
static func ad_blocks() -> int:
	var buffer: Array[ActiveBlockInfo] = []
	buffer.resize(16)
	var found: int = 0
	for index: int in InputBlockCoreDev.list_active(buffer):
		if buffer[index].reason == "ad":
			found += 1
	return found


## Global pause state that `sound_pause` reads.
enum SoundPause { NONE, PAUSED, NO_PLAY }

## Test clock time `sound_pause` moves: past the length of `CLICK` (4 ms, no loop).
const CLICK_PASS_MS: int = 100


## Whether SoundCore is in global pause, read through public behavior only: a play of `CLICK` on the `Ui` bus ends
## when the test clock passes its length, unless a global pause holds it. `NO_PLAY` when the click does not play. The
## play is stopped before return. Async.
static func sound_pause() -> SoundPause:
	var handle: int = SoundCore.play(CLICK, SoundCore.SoundBus.UI, ResourceCore.get_global_scope())
	if handle == SoundCore.INVALID_HANDLE:
		return SoundPause.NO_PLAY
	UnitTestCore.advance_clock(CLICK_PASS_MS, false)
	await UnitTestCore.wait_frames(1)
	var paused: bool = SoundCore.is_playing(handle)
	SoundCore.stop(handle)
	return SoundPause.PAUSED if paused else SoundPause.NONE


## Whether the current `show` holds the only global pause reason, its own: SoundCore is paused, releasing
## `AdCore._show_pause_token` logs no SoundCore error and ends the pause, and asking for the pause again into the token
## pauses again, so the show keeps one pause. An unchecked SoundCore error from before also makes it `false`. Async.
static func holds_show_pause() -> bool:
	if UnitTestCore.check_logs("error", "SoundCore") != 0 or await sound_pause() != SoundPause.PAUSED:
		return false
	SoundCore.release_pause(AdCore._show_pause_token)
	if UnitTestCore.check_logs("error", "SoundCore") != 0 or await sound_pause() != SoundPause.NONE:
		return false
	AdCore._show_pause_token = SoundCore.request_pause()
	return await sound_pause() == SoundPause.PAUSED


## Whether SoundCore has no global pause reason and logged no unchecked error. Async.
static func no_sound_pause() -> bool:
	return UnitTestCore.check_logs("error", "SoundCore") == 0 and await sound_pause() == SoundPause.NONE


## Waits a few frames so that queued requests and their callbacks run.
static func settle(frames: int = 5) -> void:
	await UnitTestCore.wait_frames(frames)
