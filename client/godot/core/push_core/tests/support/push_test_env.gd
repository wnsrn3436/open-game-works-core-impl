extends RefCounted
## Starts and stops PushCore with the modules it depends on, logs in, and gives the fake server results of the
## PushCore core tests.

const TAG: String = "PushCore"
const SERVER_TIME_AT: int = 1700000000000
const USER_ID: int = 7301
const DEV_LOGIN: String = "core/cheat/DevLogin"
const REGISTER: String = "core/RegisterPushToken"
const UPDATE_PUSH_CONSENT: String = "core/UpdatePushConsent"
## `local_push` rows of the core test data: one with a delay, one with a null delay.
const RETURN_ROW: String = "[local_push_return]"
const EVENT_ROW: String = "[local_push_event]"
## `delay` of `RETURN_ROW`: 1h.
const RETURN_DELAY_MS: int = 3600000
## The resource key of `[ui_button_click]` in the core test data. `UICore.prepare` loads it.
const CLICK: String = "sfx/ui_button_click"
const _RESOURCES: String = "res://core/push_core/tests/resources/"
## The fake adapters, whose process state `start_dependencies` and `stop` reset. Read through these constants, not
## the global class names: on Godot 4.7.2, reading that state through the global names here keeps
## `ContractMessage`, `ContractRequest`, `ContractKind`, `CoreContract` and `GameData` alive at exit
## ("5 resources still in use at exit") whenever this script is loaded.
const _FAKE_PUSH := preload("res://core/push_core/dev/adapters/fake_push_adapter.gd")
const _FAKE_NOTIFICATION := preload("res://core/push_core/dev/adapters/fake_notification_adapter.gd")


## Starts the modules PushCore depends on, then PushCore with the adapters, on `platform`. True when all succeed.
static func start(push: PushAdapter, notification: NotificationAdapter, platform: String = "android") -> bool:
	if not await start_dependencies(platform):
		return false
	return start_push(push, notification)


## Inits the modules PushCore depends on and the modules they need on `platform`, loads the core test data and the
## English translation, and prepares the UI.
static func start_dependencies(platform: String = "android") -> bool:
	_FAKE_NOTIFICATION._scheduled.clear()
	_FAKE_PUSH._launch_push = 0
	CoreBuildInfo.platform = platform
	var keys: Dictionary[String, String] = {CLICK: _RESOURCES + "push_click.tres"}
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
		AuthCore.init,
	]
	for init: Callable in inits:
		if init.call() != true:
			return false
	if not LocalDataCore.load_device_file():
		return false
	if not await DataCore.load(null):
		return false
	LocalizationCoreDev.set_test_device_language("en")
	if LocalizationCore.resolve_language() == 0:
		return false
	var none: Array[DownloadedTranslation] = []
	if not await LocalizationCore.load_translation(none):
		return false
	if not NetworkCore.set_server_info("http://127.0.0.1", "1.0.0", CoreBuildInfo.platform):
		return false
	if not await UICore.prepare():
		return false
	return await MessageCore.prepare()


static func start_push(push: PushAdapter, notification: NotificationAdapter) -> bool:
	PushCore.set_push_adapter(push)
	PushCore.set_notification_adapter(notification)
	return PushCore.init()


## Releases the modules `start` inits, in reverse order, and gives back the platform of the running OS.
static func stop() -> void:
	var releases: Array[Callable] = [
		PushCore.release,
		AuthCore.release,
		NetworkCore.release,
		UserStateCore.release,
		MessageCore.release,
		UICore.release,
		TweenCore.release,
		SoundCore.release,
		LocalizationCore.release,
		InputCore.release,
		SafeAreaCore.release,
		ResolutionCore.release,
		InputBlockCore.release,
		PoolCore.release,
		DataCore.release,
		ResourceCore.release,
		LocalDataCore.release,
		TimeCore.release,
		EventCore.release,
		LogCore.release,
	]
	for release: Callable in releases:
		release.call()
	_FAKE_NOTIFICATION._scheduled.clear()
	_FAKE_PUSH._launch_push = 0
	CoreBuildInfo.platform = CoreBuildInfo.os_platform()


static func id_of(id_name: String) -> int:
	return GameDataDev.find_id_value(id_name)


static func errors() -> int:
	return UnitTestCore.check_logs("error", TAG)


# --- login ---


## Logs in through `AuthCoreDev.dev_login`, which publishes `LoginCompletedEvent`. Register the `RegisterPushToken`
## result first when the push adapter has a token.
static func login(consent: CoreContract.ConsentUserState = null) -> bool:
	respond_dev_login(consent)
	var result: LoginResult = await AuthCoreDev.dev_login("push_tester")
	return result.status == AuthCore.LoginStatus.SUCCESS


## A `DevLogin` success of the test user with `consent`, `consent_state()` when null.
static func respond_dev_login(consent: CoreContract.ConsentUserState = null) -> void:
	var auth: CoreContract.AuthResult = CoreContract.AuthResult.new()
	auth.user_id = USER_ID
	auth.user_created_at = SERVER_TIME_AT - 1000
	auth.login_token = "login-token"
	auth.access_token = "access-token"
	auth.access_token_expires_at = SERVER_TIME_AT + 3600000
	auth.session_signing_key = "signing-key"
	auth.consent = consent if consent != null else consent_state()
	var response: CoreCheatContract.DevLoginResponse = CoreCheatContract.DevLoginResponse.new()
	response.result = auth
	respond(DEV_LOGIN, response)


## Consent of the test user: no analytics, so no analytics event goes to the server; ad push denied.
static func consent_state() -> CoreContract.ConsentUserState:
	var consent: CoreContract.ConsentUserState = CoreContract.ConsentUserState.new()
	consent.age_confirmed_at = SERVER_TIME_AT
	consent.privacy_version = 1
	consent.analytics_allowed = false
	consent.ad_personalization_allowed = false
	consent.push_ad_at = SERVER_TIME_AT
	consent.push_ad = CoreContract.ConsentChoice.CONSENT_CHOICE_DENIED
	consent.push_night_at = SERVER_TIME_AT
	consent.push_night = CoreContract.ConsentChoice.CONSENT_CHOICE_GRANTED
	consent.tracking = CoreContract.TrackingStatus.TRACKING_STATUS_NOT_APPLICABLE
	return consent


# --- server results and requests ---


static func respond(request_name: String, message: ContractMessage) -> void:
	var envelope: CoreContract.ResponseEnvelope = CoreContract.ResponseEnvelope.new()
	envelope.server_time_at = SERVER_TIME_AT
	if message != null:
		envelope.body = message.encode()
	UnitTestCore.add_result(request_name, NetworkCore.TransferResult.DONE, 200, UnitTestCore.make_response(envelope))


static func respond_error(request_name: String, code: int) -> void:
	var envelope: CoreContract.ResponseEnvelope = CoreContract.ResponseEnvelope.new()
	envelope.server_time_at = SERVER_TIME_AT
	var error: CoreContract.ServerError = CoreContract.ServerError.new()
	error.code = code
	envelope.error = error
	UnitTestCore.add_result(request_name, NetworkCore.TransferResult.DONE, 200, UnitTestCore.make_response(envelope))


static func respond_register() -> void:
	respond(REGISTER, CoreContract.RegisterPushTokenResponse.new())


## The requests of `request_name` the fake network got, in order.
static func request_count(request_name: String) -> int:
	var count: int = 0
	for request: UnitTestRequest in UnitTestCore.received_requests():
		if request.name == request_name:
			count += 1
	return count


## The `RegisterPushToken` requests the fake network got, in order.
static func register_requests() -> Array[CoreContract.RegisterPushTokenRequest]:
	var list: Array[CoreContract.RegisterPushTokenRequest] = []
	for request: UnitTestRequest in UnitTestCore.received_requests():
		if request.name != REGISTER:
			continue
		var message: CoreContract.RegisterPushTokenRequest = CoreContract.RegisterPushTokenRequest.new()
		if message.decode(request.body):
			list.append(message)
	return list


## Waits until the requests in the queue of `NetworkCore` went out.
static func settle() -> void:
	await UnitTestCore.wait_frames(10)


## UTC offset of the device time zone now, ms.
# ogw:input_boundary
static func timezone_offset_ms() -> int:
	var zone: Dictionary = Time.get_time_zone_from_system()
	var bias: Variant = zone.get("bias", 0)
	if not bias is int:
		return 0
	var minutes: int = bias
	return minutes * 60000


# --- translation ---


## Restarts `LocalizationCore` in language `code` with a downloaded translation of `entries` (key, text, ...).
static func restart_language(code: String, entries: PackedStringArray) -> bool:
	var language: int = 0
	for row: GameData.LanguageRow in GameData.LanguageTable.all_rows():
		if row.code == code:
			language = row.id
	if language == 0 or not LocalizationCore.select_language(language):
		return false
	LocalizationCore.release()
	if not LocalizationCore.init() or LocalizationCore.resolve_language() != language:
		return false
	var bytes: PackedByteArray = _translation_binary(entries)
	var path: String = "push_test/translation_%s.bin" % code
	if not LocalDataCore.write_file(path, bytes).ok:
		return false
	var downloaded: DownloadedTranslation = DownloadedTranslation.new()
	downloaded.code = code
	downloaded.path = path
	downloaded.sha256 = UtilCore.sha256_hex(bytes)
	downloaded.data_version = DataCore.get_data_version()
	var list: Array[DownloadedTranslation] = [downloaded]
	return await LocalizationCore.load_translation(list)


## A translation binary: the protobuf `Translation` of the entries (key, text) in order.
static func _translation_binary(entries: PackedStringArray) -> PackedByteArray:
	var out: PackedByteArray = PackedByteArray()
	var i: int = 0
	while i + 1 < entries.size():
		var entry: PackedByteArray = PackedByteArray()
		_put_bytes(entry, 1, entries[i].to_utf8_buffer())
		_put_bytes(entry, 2, entries[i + 1].to_utf8_buffer())
		_put_bytes(out, 1, entry)
		i += 2
	return out


static func _put_bytes(out: PackedByteArray, number: int, bytes: PackedByteArray) -> void:
	_put_varint(out, number << 3 | 2)
	_put_varint(out, bytes.size())
	out.append_array(bytes)


static func _put_varint(out: PackedByteArray, value: int) -> void:
	var rest: int = value
	while rest >= 0x80:
		out.append((rest & 0x7F) | 0x80)
		rest >>= 7
	out.append(rest)
