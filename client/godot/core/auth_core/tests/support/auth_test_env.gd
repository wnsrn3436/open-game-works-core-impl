extends RefCounted
## Boot, fake server responses, popup input and the stored item of the AuthCore core tests.

const FakeStorage := preload("res://core/auth_core/tests/support/fake_token_storage.gd")
const TestSocial := preload("res://core/auth_core/tests/support/fake_social_adapter.gd")
const TestTracking := preload("res://core/auth_core/tests/support/fake_tracking.gd")
const Recorder := preload("res://core/auth_core/tests/support/event_recorder.gd")
const Flow := preload("res://core/auth_core/tests/support/flow.gd")

const SCOPE: String = "com.example.coretest.LOCAL"
const SERVER_TIME: int = 1700000000000
const TOKEN_TTL_MS: int = 1800000
const TERMS_URL: String = "https://example.com/terms"
const PRIVACY_URL: String = "https://example.com/privacy"
const POPUP_KEYS: Dictionary[String, String] = {
	"auth_test_terms": "res://core/auth_core/tests/resources/terms_popup.tscn",
	"auth_test_broken_terms": "res://core/auth_core/tests/resources/broken_terms_popup.tscn",
	"auth_test_age": "res://core/auth_core/tests/resources/age_popup.tscn",
	"auth_test_privacy": "res://core/auth_core/tests/resources/privacy_popup.tscn",
	"auth_test_push": "res://core/auth_core/tests/resources/push_popup.tscn",
	# `[ui_button_click]` of the core test data. `UICore.prepare` loads it.
	"sfx/ui_button_click": "res://core/auth_core/tests/resources/test_click.tres",
}

var storage: FakeStorage = FakeStorage.new()
var google: TestSocial = TestSocial.new()
var apple: TestSocial = TestSocial.new()
## Tracking adapter to use. `null` keeps the platform one.
var tracking: TestTracking = null
var recorder: Recorder = null
## URLs `AuthCore` opened with the OS, in order.
var opened_urls: PackedStringArray = []
## Return value of the URL opener.
var url_opens: bool = true
## Persistent storage requests.
var persist_requests: int = 0
## Return value of the persistent storage requester.
var persist_possible: bool = true
## Social adapters to pass. Keys are `CoreContract.LoginProvider` values.
var adapters: Dictionary[int, SocialAdapter] = {}
var platform: String = "macos"


func _init() -> void:
	adapters[CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE] = google
	adapters[CoreContract.LoginProvider.LOGIN_PROVIDER_APPLE] = apple


## Test settings of the module list. Call before `boot`.
func settings(values: Dictionary[String, bool]) -> bool:
	var ok: bool = true
	for key: String in values:
		ok = UnitTestCore.set_test_settings(key, values[key]) and ok
	return ok


## Inits the module list of AuthCore, loads the core test data and prepares the UI, then inits AuthCore.
func boot() -> bool:
	# The state `release` keeps outlives the test that made it: a test starts without it.
	AuthCore._clear_pending()
	AuthCore._storage_queue = AuthCore._STORAGE_QUEUE.new()
	if not (
		UnitTestCore.set_test_settings("UICore.buttonClickIntervalMs", 0)
		and UnitTestCore.set_test_settings("termsPopup", "auth_test_terms")
		and UnitTestCore.set_test_settings("agePopup", "auth_test_age")
		and UnitTestCore.set_test_settings("privacyPopup", "auth_test_privacy")
		and UnitTestCore.set_test_settings("pushConsentPopup", "auth_test_push")
	):
		return false
	ResourceCoreDev.set_test_key_list(POPUP_KEYS)
	CoreBuildInfo.platform = platform
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
	if not NetworkCore.set_server_info("http://127.0.0.1", "", platform):
		return false
	# LogCore sends the error logs of a test through NetworkCore once a session is open.
	for i: int in 4:
		respond("core/ReportClientErrors", CoreContract.ReportClientErrorsResponse.new())
	await UICore.prepare()
	await MessageCore.prepare()
	return start_auth()


## Inits AuthCore again with the same storage, adapters and test replacements.
func start_auth() -> bool:
	AuthCore.set_storage_scope(SCOPE)
	for provider: int in adapters:
		AuthCore.set_social_adapter(provider as CoreContract.LoginProvider, adapters[provider])
	AuthCore._test_storage = storage
	AuthCore._test_tracking = tracking
	AuthCore._test_url_opener = _open_url
	AuthCore._test_persist_requester = _request_persist
	if not AuthCore.init():
		return false
	if recorder == null:
		recorder = Recorder.new()
		(Engine.get_main_loop() as SceneTree).root.add_child(recorder)
		return recorder.start()
	return true


## Frees the recorder. Call at the end of each test.
func finish() -> void:
	if recorder != null:
		EventCore.unsubscribe_all(recorder)
		recorder.queue_free()
		recorder = null


func _open_url(url: String) -> bool:
	opened_urls.append(url)
	return url_opens


func _request_persist() -> bool:
	persist_requests += 1
	return persist_possible


# --- server responses ---


static func respond(request_name: String, message: ContractMessage) -> void:
	UnitTestCore.add_result(request_name, NetworkCore.TransferResult.DONE, 200, envelope(message, 0, null))


static func respond_error(request_name: String, code: int, ban: CoreContract.BanDetail = null) -> void:
	UnitTestCore.add_result(request_name, NetworkCore.TransferResult.DONE, 200, envelope(null, code, ban))


## Communication failure of every send of the request, the retries of `NetworkCore` included.
static func respond_offline(request_name: String, times: int = 1) -> void:
	for i: int in times:
		UnitTestCore.add_result(request_name, NetworkCore.TransferResult.CONNECTION_FAILED, 0, PackedByteArray())


static func envelope(message: ContractMessage, code: int, ban: CoreContract.BanDetail) -> PackedByteArray:
	var response: CoreContract.ResponseEnvelope = CoreContract.ResponseEnvelope.new()
	response.server_time_at = SERVER_TIME
	if code != 0:
		var error: CoreContract.ServerError = CoreContract.ServerError.new()
		error.code = code
		error.ban = ban
		response.error = error
	elif message != null:
		response.body = message.encode()
	return UnitTestCore.make_response(response)


static func consent_state() -> CoreContract.ConsentUserState:
	var consent: CoreContract.ConsentUserState = CoreContract.ConsentUserState.new()
	consent.age_confirmed_at = SERVER_TIME
	consent.privacy_version = 1
	consent.analytics_allowed = true
	consent.ad_personalization_allowed = true
	consent.push_ad_at = SERVER_TIME
	consent.push_ad = CoreContract.ConsentChoice.CONSENT_CHOICE_DENIED
	consent.push_night = CoreContract.ConsentChoice.CONSENT_CHOICE_DENIED
	consent.tracking = CoreContract.TrackingStatus.TRACKING_STATUS_NOT_APPLICABLE
	return consent


## The public code the fake server gives `user_id`.
static func public_code(user_id: int) -> String:
	return "PC%06d" % user_id


static func auth_result(
	user_id: int, token: String, consent: CoreContract.ConsentUserState = null
) -> CoreContract.AuthResult:
	var result: CoreContract.AuthResult = CoreContract.AuthResult.new()
	result.user_id = user_id
	result.user_created_at = SERVER_TIME - 1000
	result.login_token = token
	result.access_token = "access-%d-%s" % [user_id, token]
	result.access_token_expires_at = SERVER_TIME + TOKEN_TTL_MS
	result.session_signing_key = "key-%d" % user_id
	result.public_code = public_code(user_id)
	result.consent = consent if consent != null else consent_state()
	return result


static func respond_login(user_id: int, token: String, consent: CoreContract.ConsentUserState = null) -> void:
	var response: CoreContract.LoginResponse = CoreContract.LoginResponse.new()
	response.result = auth_result(user_id, token, consent)
	respond("core/Login", response)


static func respond_auto_login(user_id: int, token: String, consent: CoreContract.ConsentUserState = null) -> void:
	var response: CoreContract.AutoLoginResponse = CoreContract.AutoLoginResponse.new()
	response.result = auth_result(user_id, token, consent)
	respond("core/AutoLogin", response)


static func respond_refresh(access_token: String, expires_at: int = SERVER_TIME + TOKEN_TTL_MS) -> void:
	respond("core/RefreshToken", refresh_response(access_token, expires_at))


static func refresh_response(
	access_token: String, expires_at: int = SERVER_TIME + TOKEN_TTL_MS
) -> CoreContract.RefreshTokenResponse:
	var response: CoreContract.RefreshTokenResponse = CoreContract.RefreshTokenResponse.new()
	response.access_token = access_token
	response.access_token_expires_at = expires_at
	return response


static func respond_terms(version: int = 1, terms_url: String = TERMS_URL, privacy_url: String = PRIVACY_URL) -> void:
	var response: CoreContract.GetTermsResponse = CoreContract.GetTermsResponse.new()
	var terms: CoreContract.TermsDocument = CoreContract.TermsDocument.new()
	terms.item = CoreContract.TermsItem.TERMS_ITEM_TERMS
	terms.version = version
	terms.url = terms_url
	var privacy: CoreContract.TermsDocument = CoreContract.TermsDocument.new()
	privacy.item = CoreContract.TermsItem.TERMS_ITEM_PRIVACY
	privacy.version = version
	privacy.url = privacy_url
	response.documents = [terms, privacy]
	respond("core/GetTerms", response)


static func respond_consent(request_name: String, consent: CoreContract.ConsentUserState) -> void:
	var message: ContractMessage = null
	if request_name == "core/ConfirmAge":
		var age: CoreContract.ConfirmAgeResponse = CoreContract.ConfirmAgeResponse.new()
		age.consent = consent
		message = age
	elif request_name == "core/UpdatePushConsent":
		var push: CoreContract.UpdatePushConsentResponse = CoreContract.UpdatePushConsentResponse.new()
		push.consent = consent
		message = push
	else:
		var update: CoreContract.UpdateConsentResponse = CoreContract.UpdateConsentResponse.new()
		update.consent = consent
		message = update
	respond(request_name, message)


## Stores the agreed terms version on the device: `prepare_terms` then opens no popup for that version.
static func agree_terms(version: int = 1) -> void:
	LocalDataCore.set_value_int(LocalDataCore.FileKind.DEVICE, "AuthCore.terms_version", version)
	LocalDataCore.set_value_int(LocalDataCore.FileKind.DEVICE, "AuthCore.privacy_terms_version", version)


## Writes the install marker so that `boot_login` keeps the storage item.
static func mark_installed() -> void:
	LocalDataCore.write_file("auth/installed", PackedByteArray([0x31]))


## `boot_login` of a new install with no storage item: `GetTerms` and a guest `Login` of `user_id`.
func boot_guest(user_id: int, token: String) -> LoginResult:
	agree_terms()
	respond_terms()
	respond_login(user_id, token)
	return await AuthCore.boot_login()


## `boot_login` with the install marker, the agreed terms and a stored login token: `GetTerms` and `AutoLogin`.
func boot_auto(user_id: int, stored: String, token: String) -> LoginResult:
	mark_installed()
	agree_terms()
	store(stored)
	respond_terms()
	respond_auto_login(user_id, token)
	return await AuthCore.boot_login()


# --- requests the fake network got ---


static func request_count(request_name: String) -> int:
	var count: int = 0
	for request: UnitTestRequest in UnitTestCore.received_requests():
		if request.name == request_name:
			count += 1
	return count


## Body of the `index`-th request of the name, or empty bytes.
static func request_body(request_name: String, index: int = 0) -> PackedByteArray:
	var seen: int = 0
	for request: UnitTestRequest in UnitTestCore.received_requests():
		if request.name == request_name:
			if seen == index:
				return request.body
			seen += 1
	return PackedByteArray()


## Header of the `index`-th request of the name, or an empty string.
static func request_header(request_name: String, header: String, index: int = 0) -> String:
	var seen: int = 0
	for request: UnitTestRequest in UnitTestCore.received_requests():
		if request.name == request_name:
			if seen == index:
				for line: String in request.headers:
					if line.begins_with(header + ": "):
						return line.substr(header.length() + 2)
				return ""
			seen += 1
	return ""


## Signature that the `index`-th request of the name carries when it is signed with `key`.
static func expected_signature(key: String, request_name: String, index: int = 0) -> String:
	var hashing: HashingContext = HashingContext.new()
	if hashing.start(HashingContext.HASH_SHA256) != OK:
		return ""
	var body: PackedByteArray = request_body(request_name, index)
	if not body.is_empty() and hashing.update(body) != OK:
		return ""
	var text: String = "%s\n%s\n%s\n%s" % [
		request_name,
		request_header(request_name, "X-Ogw-Request-Id", index),
		request_header(request_name, "X-Ogw-Timestamp", index),
		hashing.finish().hex_encode(),
	]
	return Crypto.new().hmac_digest(HashingContext.HASH_SHA256, key.to_utf8_buffer(), text.to_utf8_buffer()).hex_encode()


## Names of the requests in the order the fake network got them.
static func request_names() -> PackedStringArray:
	var names: PackedStringArray = []
	for request: UnitTestRequest in UnitTestCore.received_requests():
		names.append(request.name)
	return names


# --- stored item ---


func stored_text() -> String:
	return storage.items[SCOPE] if storage.items.has(SCOPE) else ""


func store(token: String, linked: PackedStringArray = []) -> void:
	storage.items[SCOPE] = "{\"login_token\":%s,\"linked_providers\":%s}" % [JSON.stringify(token), JSON.stringify(linked)]


## Login token of the stored item, or an empty string.
func stored_token() -> String:
	return _stored_field(stored_text(), "login_token")


## `linked_providers` of the stored item as JSON text, or an empty string.
func stored_linked() -> String:
	return _stored_field(stored_text(), "linked_providers")


# ogw:input_boundary
static func _stored_field(text: String, field: String) -> String:
	var json: JSON = JSON.new()
	if json.parse(text) != OK or not json.data is Dictionary:
		return ""
	var data: Dictionary = json.data
	var value: Variant = data[field] if data.has(field) else null
	if value is String:
		var found: String = value
		return found
	if value == null:
		return ""
	return JSON.stringify(value)


# --- UI ---


## Taps a `UIAnchor` of a test popup and lets the input run.
static func tap(anchor: String) -> bool:
	var ok: bool = UnitTestCore.tap_anchor(anchor)
	await UnitTestCore.wait_frames(3)
	return ok


## Waits until test popup `key` has ended its open flow: it is open and takes input. Its prefab loads on an engine
## loader thread, which engine frames do not pace, so each `UIOpenedEvent` ends a wait, not a frame count. The latch
## wakes inside the publish, so one frame then lets the open flow end the call that published the event. `false` when
## the test time limit ended the wait.
static func wait_popup(key: String) -> bool:
	while not UICore.get_open_popups().has(key):
		var latch: UnitTestLatch = UnitTestCore.latch_event(UIOpenedEvent)
		await UnitTestCore.wait_latch(latch)
		if not latch.happened:
			return false
	await UnitTestCore.wait_frames(1)
	return true


## Types into the `index`-th `LineEdit` of the popup layer.
static func type_text(index: int, text: String) -> void:
	var inputs: Array[LineEdit] = []
	_collect_line_edits(UICore.get_layer(UICore.UILayer.POPUP), inputs)
	if index < inputs.size():
		inputs[index].text = text


## Taps the visible button of the popup layer whose text is the translation of `label_key`.
static func press(label_key: String) -> bool:
	var button: BaseButton = find_button(label_key)
	if button == null:
		return false
	UnitTestCore.tap(button.get_global_rect().get_center())
	await UnitTestCore.wait_frames(3)
	return true


## The visible button of the popup layer whose text is the translation of `label_key`, or `null`.
static func find_button(label_key: String) -> BaseButton:
	return _find_button(UICore.get_layer(UICore.UILayer.POPUP), LocalizationCore.get_text(label_key))


## Presses and lets go of the back input.
static func back() -> void:
	InputCore.inject_action("back", true, 1.0)
	await UnitTestCore.wait_frames(2)
	InputCore.inject_action("back", false, 0.0)
	await UnitTestCore.wait_frames(3)


## True when a visible text of the popup layer is the translation of `key`.
static func shows(key: String) -> bool:
	return _has_text(UICore.get_layer(UICore.UILayer.POPUP), LocalizationCore.get_text(key))


static func _find_button(node: Node, text: String) -> BaseButton:
	if node is CanvasItem and not (node as CanvasItem).is_visible_in_tree():
		return null
	if node is Button and (node as Button).text == text:
		return node as BaseButton
	if node is BaseButton and _has_text(node, text):
		return node as BaseButton
	for child: Node in node.get_children():
		var found: BaseButton = _find_button(child, text)
		if found != null:
			return found
	return null


static func _has_text(node: Node, text: String) -> bool:
	if node is CanvasItem and not (node as CanvasItem).is_visible_in_tree():
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


static func _collect_line_edits(node: Node, out: Array[LineEdit]) -> void:
	if node is LineEdit:
		out.append(node as LineEdit)
	for child: Node in node.get_children():
		_collect_line_edits(child, out)
