extends UnitTestCase
## Base of the PaymentCore core tests. Starts PaymentCore and the modules it depends on in module list order with the
## fake store adapter, logs in with a dev login, and reads the fake network, the fake store adapter calls, the popups
## and `PurchaseRecoveredEvent`.

const TestSocial := preload("res://core/payment_core/tests/support/usable_social_adapter.gd")

const SERVER_TIME: int = 1700000500000
const DAY_MS: int = 86400000
const USER_ID: int = 9101
const ACCOUNT_TOKEN: String = "1b4e28ba-2fa1-41d2-883f-0016d3cca427"
const STORE_CALL_TIMEOUT_MS: int = 5000
const RETRY_DELAY_MS: int = 3000

const CHECK: String = "core/CheckPurchase"
const VERIFY: String = "core/VerifyPurchase"
const RECOVER: String = "core/RecoverPurchase"
const SYNC: String = "core/SyncSubscriptions"
const CLAIM: String = "core/ClaimIapDaily"
const DEV_LOGIN: String = "core/cheat/DevLogin"
## The resource key of `[ui_button_click]` in the core test data. `UICore.prepare` loads it.
const CLICK: String = "sfx/ui_button_click"
const RESOURCES: String = "res://core/payment_core/tests/resources/"

var fake: FakeStoreAdapter = null
var social: TestSocial = null
## `<product ID value>@<finish calls of the fake adapter>` of each `PurchaseRecoveredEvent`, in order.
var recovered: PackedStringArray = PackedStringArray()


func before_each() -> void:
	super()
	fake = null
	social = null
	recovered = PackedStringArray()


# --- boot ---


## Inits the module list of PaymentCore, loads the core test data and prepares the UI, then inits AuthCore with a
## usable social provider when `social_supported`, inits PaymentCore with a fake adapter of `store` (none when
## `with_adapter` is false) and logs in. `linked` gives the login a linked social provider.
func start(
	store: CoreContract.IapStore = CoreContract.IapStore.IAP_STORE_APPLE,
	with_adapter: bool = true,
	linked: bool = true,
	social_supported: bool = false,
	login: bool = true
) -> bool:
	if not start_modules():
		return false
	if not await prepare_modules():
		return false
	if not start_auth(social_supported):
		return false
	if not start_payment(store, with_adapter):
		return false
	if login:
		return await log_in(USER_ID, linked)
	return true


func start_modules() -> bool:
	CoreBuildInfo.platform = "macos"
	var ints: Dictionary[String, int] = {
		"PaymentCore.storeCallTimeoutMs": STORE_CALL_TIMEOUT_MS,
		"PaymentCore.deliveryRetryDelayMs": RETRY_DELAY_MS,
		"UICore.buttonClickIntervalMs": 0,
	}
	for key: String in ints:
		if not UnitTestCore.set_test_settings(key, ints[key]):
			return false
	var popup_keys: PackedStringArray = ["termsPopup", "agePopup", "privacyPopup", "pushConsentPopup"]
	for key: String in popup_keys:
		if not UnitTestCore.set_test_settings(key, ""):
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
	return true


## `ui` false leaves out `UICore.prepare` and `MessageCore.prepare`: `UICore` cannot open a popup.
func prepare_modules(ui: bool = true) -> bool:
	if not LocalDataCore.load_device_file():
		return false
	if not await DataCore.load(null):
		return false
	if LocalizationCore.resolve_language() == 0:
		return false
	var translations: Array[DownloadedTranslation] = []
	if not await LocalizationCore.load_translation(translations):
		return false
	if not NetworkCore.set_server_info("http://127.0.0.1", "", CoreBuildInfo.platform):
		return false
	if ui:
		if not await UICore.prepare():
			return false
		await MessageCore.prepare()
	LogCore.clear_sender()
	return true


func start_auth(social_supported: bool) -> bool:
	if social_supported:
		social = TestSocial.new()
		AuthCore.set_social_adapter(CoreContract.LoginProvider.LOGIN_PROVIDER_APPLE, social)
	return AuthCore.init()


## Inits PaymentCore with a fake adapter of `store`, or with none, and subscribes to `PurchaseRecoveredEvent`.
func start_payment(store: CoreContract.IapStore, with_adapter: bool = true) -> bool:
	if with_adapter:
		fake = FakeStoreAdapter.new(store)
		PaymentCore.set_store_adapter(fake)
	if not PaymentCore.init():
		return false
	return EventCore.subscribe(PurchaseRecoveredEvent, _on_purchase_recovered)


## `start` with the store adapter `adapter`: a logged-in user with a linked provider.
func start_with(adapter: FakeStoreAdapter) -> bool:
	if not start_modules() or not await prepare_modules() or not start_auth(false):
		return false
	fake = adapter
	PaymentCore.set_store_adapter(adapter)
	if not PaymentCore.init() or not EventCore.subscribe(PurchaseRecoveredEvent, _on_purchase_recovered):
		return false
	return await log_in(USER_ID)


## Dev login of `user_id`. Each one is a new login session.
func log_in(user_id: int, linked: bool = true) -> bool:
	var response: CoreCheatContract.DevLoginResponse = CoreCheatContract.DevLoginResponse.new()
	var result: CoreContract.AuthResult = CoreContract.AuthResult.new()
	result.user_id = user_id
	result.user_created_at = SERVER_TIME - DAY_MS
	result.login_token = "login-token-%d" % user_id
	result.access_token = "access-token-%d" % user_id
	result.access_token_expires_at = SERVER_TIME + 365 * DAY_MS
	result.session_signing_key = "signing-key-%d" % user_id
	if linked:
		result.linked_providers = PackedInt32Array([CoreContract.LoginProvider.LOGIN_PROVIDER_APPLE])
	response.result = result
	respond(DEV_LOGIN, response)
	var login: LoginResult = await AuthCoreDev.dev_login("payment-%d" % user_id)
	# The login session sets the LogCore sender. The tests read the error logs with `check_logs`, not the server.
	LogCore.clear_sender()
	return login.status == AuthCore.LoginStatus.SUCCESS


func _on_purchase_recovered(event: PurchaseRecoveredEvent) -> void:
	recovered.append("%d@%d" % [event.product_id, fake.count_calls("finish") if fake != null else -1])


# --- data ---


## ID value of ID name `id_name`, for example `[iap_gems]`.
func id_of(id_name: String) -> int:
	return GameDataDev.find_id_value(id_name)


# --- fake network ---


func envelope(message: ContractMessage, delta: CoreContract.UserStateDelta = null) -> PackedByteArray:
	var env: CoreContract.ResponseEnvelope = CoreContract.ResponseEnvelope.new()
	env.server_time_at = TimeCore.get_server_time() if TimeCore.is_synced() else SERVER_TIME
	if message != null:
		env.body = message.encode()
	env.user_state = delta
	return UnitTestCore.make_response(env)


func error_envelope(code: int) -> PackedByteArray:
	var env: CoreContract.ResponseEnvelope = CoreContract.ResponseEnvelope.new()
	env.server_time_at = TimeCore.get_server_time() if TimeCore.is_synced() else SERVER_TIME
	env.error = CoreContract.ServerError.new()
	env.error.code = code
	return UnitTestCore.make_response(env)


func respond(request_name: String, message: ContractMessage, delta: CoreContract.UserStateDelta = null) -> void:
	UnitTestCore.add_result(request_name, NetworkCore.TransferResult.DONE, 200, envelope(message, delta))


func respond_error(request_name: String, code: int) -> void:
	UnitTestCore.add_result(request_name, NetworkCore.TransferResult.DONE, 200, error_envelope(code))


func respond_check(token: String = ACCOUNT_TOKEN) -> void:
	var response: CoreContract.CheckPurchaseResponse = CoreContract.CheckPurchaseResponse.new()
	response.account_token = token
	respond(CHECK, response)


func verify_response(status: CoreContract.PurchaseStatus, product_id: int) -> CoreContract.VerifyPurchaseResponse:
	var response: CoreContract.VerifyPurchaseResponse = CoreContract.VerifyPurchaseResponse.new()
	response.status = status
	response.product_id = product_id
	return response


func recover_response(status: CoreContract.PurchaseStatus, product_id: int) -> CoreContract.RecoverPurchaseResponse:
	var response: CoreContract.RecoverPurchaseResponse = CoreContract.RecoverPurchaseResponse.new()
	response.status = status
	response.product_id = product_id
	return response


func respond_verify(
	status: CoreContract.PurchaseStatus, product_id: int, delta: CoreContract.UserStateDelta = null
) -> void:
	respond(VERIFY, verify_response(status, product_id), delta)


func respond_recover(
	status: CoreContract.PurchaseStatus, product_id: int, delta: CoreContract.UserStateDelta = null
) -> void:
	respond(RECOVER, recover_response(status, product_id), delta)


## Results of the requests a foreground return sends besides PaymentCore's: `Resync`, and the `RefreshToken` AuthCore
## sends while there is a session.
func respond_foreground() -> void:
	respond("core/Resync", CoreContract.ResyncResponse.new())
	var refresh: CoreContract.RefreshTokenResponse = CoreContract.RefreshTokenResponse.new()
	refresh.access_token = "access-token-refreshed"
	refresh.access_token_expires_at = SERVER_TIME + 365 * DAY_MS
	respond("core/RefreshToken", refresh)


func request_count(request_name: String) -> int:
	var count: int = 0
	for received: UnitTestRequest in UnitTestCore.received_requests():
		if received.name == request_name:
			count += 1
	return count


## Names of the received requests that are not the dev login, in order.
func request_names() -> PackedStringArray:
	var names: PackedStringArray = PackedStringArray()
	for received: UnitTestRequest in UnitTestCore.received_requests():
		if received.name != DEV_LOGIN:
			names.append(received.name)
	return names


## Body of the `index`-th request of `request_name`, or empty bytes.
func request_body(request_name: String, index: int = 0) -> PackedByteArray:
	var seen: int = 0
	for received: UnitTestRequest in UnitTestCore.received_requests():
		if received.name == request_name:
			if seen == index:
				return received.body
			seen += 1
	return PackedByteArray()


## Receipt data of the `index`-th `RecoverPurchase`.
func recovered_receipt(index: int) -> String:
	var request: CoreContract.RecoverPurchaseRequest = CoreContract.RecoverPurchaseRequest.new()
	if not request.decode(request_body(RECOVER, index)):
		return ""
	return request.receipt


# --- UserState ---


func iap_delta(product_id: int, count: int, pass_end_day: int = 0, daily_claimed_day: int = 0) -> CoreContract.UserStateDelta:
	var row: CoreContract.IapPurchaseUserState = CoreContract.IapPurchaseUserState.new()
	row.id = product_id
	row.count = count
	row.pass_end_day = pass_end_day
	row.daily_claimed_day = daily_claimed_day
	return _delta("IapPurchaseUserState", product_id, row)


func subscription_delta(product_id: int, state: CoreContract.SubscriptionState, ends_at: int) -> CoreContract.UserStateDelta:
	var row: CoreContract.SubscriptionUserState = CoreContract.SubscriptionUserState.new()
	row.id = product_id
	row.state = state
	row.ends_at = ends_at
	row.auto_renew = true
	return _delta("SubscriptionUserState", product_id, row)


## Applies `delta` the way a response does.
func apply(delta: CoreContract.UserStateDelta) -> bool:
	return UserStateCore.apply_delta(delta, UserStateCore.DeltaSource.RESPONSE)


func _delta(kind: String, id: int, row: ContractMessage) -> CoreContract.UserStateDelta:
	var entry: CoreContract.UserStateEntry = CoreContract.UserStateEntry.new()
	entry.kind = kind
	entry.id = id
	entry.value = row.encode()
	var delta: CoreContract.UserStateDelta = CoreContract.UserStateDelta.new()
	delta.entries.append(entry)
	return delta


# --- time and frames ---


## Lets the deferred work and the fake adapter frames run.
func settle(frames: int = 12) -> void:
	await UnitTestCore.wait_frames(frames)


## Moves the test clock `ms` ahead without a background step, then lets the frame check run.
func advance(ms: int) -> void:
	UnitTestCore.advance_clock(ms, false)
	await settle()


## Moves the server time to `target` (later than now).
func advance_to(target: int) -> void:
	await advance(target - TimeCore.get_server_time())


## A background step of `ms`: `TimeCore` publishes `AppForegroundReturnedEvent`.
func background_return(ms: int = 1000) -> void:
	UnitTestCore.advance_clock(ms, true)
	await settle()


## Game day number of today.
func today() -> int:
	return TimeCore.get_day_number(TimeCore.get_current_day())


# --- popup ---


## The visible button of the popup layer whose text is the translation of `label_key`, or `null`.
func find_button(label_key: String) -> BaseButton:
	return _find_button(UICore.get_layer(UICore.UILayer.POPUP), LocalizationCore.get_text(label_key))


## Taps the visible popup button of `label_key`.
func press(label_key: String) -> bool:
	var button: BaseButton = find_button(label_key)
	if button == null:
		return false
	UnitTestCore.tap(button.get_global_rect().get_center())
	await settle(4)
	return true


## Presses and lets go of the back input.
func back() -> void:
	InputCore.inject_action("back", true, 1.0)
	await settle(2)
	InputCore.inject_action("back", false, 0.0)
	await settle(4)


## True when a visible text of the popup layer is the translation of `key`.
func shows(key: String) -> bool:
	return _has_text(UICore.get_layer(UICore.UILayer.POPUP), LocalizationCore.get_text(key))


func _find_button(node: Node, text: String) -> BaseButton:
	if node == null or (node is CanvasItem and not (node as CanvasItem).is_visible_in_tree()):
		return null
	if node is BaseButton and _has_text(node, text):
		return node as BaseButton
	for child: Node in node.get_children():
		var found: BaseButton = _find_button(child, text)
		if found != null:
			return found
	return null


func _has_text(node: Node, text: String) -> bool:
	if node == null or (node is CanvasItem and not (node as CanvasItem).is_visible_in_tree()):
		return false
	if node is Label and (node as Label).text == text:
		return true
	if node is Button and (node as Button).text == text:
		return true
	if node is RichTextLabel and (node as RichTextLabel).get_parsed_text() == text:
		return true
	for child: Node in node.get_children():
		if _has_text(child, text):
			return true
	return false


# --- running operations ---


## A `purchase` running in the background: `done` and `result` after it ends.
class Purchase extends RefCounted:
	signal finished
	var done: bool = false
	var result: PaymentCore.PurchaseResult = PaymentCore.PurchaseResult.REJECTED


func start_purchase(product_id: int) -> Purchase:
	var running: Purchase = Purchase.new()
	_purchase_into(running, product_id)
	return running


func _purchase_into(running: Purchase, product_id: int) -> void:
	running.result = await PaymentCore.purchase(product_id)
	running.done = true
	running.finished.emit()


func wait_purchase(running: Purchase) -> PaymentCore.PurchaseResult:
	if not running.done:
		await running.finished
	return running.result


## A `recover_purchases` or `restore_purchases` running in the background.
class Recovery extends RefCounted:
	signal finished
	var done: bool = false
	var ok: bool = false
	var summary: RecoverySummary = null


func start_recover() -> Recovery:
	var running: Recovery = Recovery.new()
	_recover_into(running)
	return running


func start_restore() -> Recovery:
	var running: Recovery = Recovery.new()
	_restore_into(running)
	return running


func _recover_into(running: Recovery) -> void:
	var result: RecoverPurchasesResult = await PaymentCore.recover_purchases()
	running.ok = result.ok
	running.summary = result.summary
	running.done = true
	running.finished.emit()


func _restore_into(running: Recovery) -> void:
	var result: RestorePurchasesResult = await PaymentCore.restore_purchases()
	running.ok = result.ok
	running.summary = result.summary
	running.done = true
	running.finished.emit()


func wait_recovery(running: Recovery) -> bool:
	if not running.done:
		await running.finished
	return running.ok


## Summary counts as `granted,already_granted,invalid,other_user,pending,failed`.
func counts(summary: RecoverySummary) -> String:
	if summary == null:
		return "null"
	return "%d,%d,%d,%d,%d,%d" % [
		summary.granted, summary.already_granted, summary.invalid, summary.other_user, summary.pending, summary.failed,
	]

