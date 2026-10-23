extends UnitTestCase
## Base of the RemoteConfigCore core tests. Starts RemoteConfigCore and the modules before it in module list order, logs
## in with a dev account whose login response carries remote config, and answers `GetRemoteConfig`.

const TAG: String = "RemoteConfigCore"
const SERVER_TIME: int = 1700000500000
const TOKEN_TTL_MS: int = 864000000
const INTERVAL_MS: int = 600000
const HALF_INTERVAL_MS: int = 300000
const QUARTER_INTERVAL_MS: int = 150000
const BASE_URL: String = "http://127.0.0.1"
const GET: String = "core/GetRemoteConfig"
const DEV_LOGIN: String = "core/cheat/DevLogin"
const REFRESH_TOKEN: String = "core/RefreshToken"
const REPORT_ERRORS: String = "core/ReportClientErrors"
const RESYNC: String = "core/Resync"
## The resource key of `[ui_button_click]` in the core test data. `UICore.prepare` loads it.
const CLICK: String = "sfx/ui_button_click"
## Key ID value of no `remote_config_key` row and no ID name.
const NO_KEY: int = 999999

## Key ID values of the core test data: `[rc_flag]` (Bool, `false`), `[rc_count]` (Int, `10`), `[rc_title]` (String,
## `hello`), and `[rc_threshold]`, a key whose `client` is `false` and so not in client data.
var flag: int = 0
var count: int = 0
var title: int = 0
var threshold: int = 0
## Experiment ID values `[exp_a]`, `[exp_b]`.
var exp_a: int = 0
var exp_b: int = 0
## `RemoteConfigChangedEvent`s since `start`.
var changed_events: int = 0


## A `refresh` running in the background: `done` and `ok` after it ends.
class Call extends RefCounted:
	signal finished
	var done: bool = false
	var ok: bool = false


## Initializes the modules up to RemoteConfigCore in module list order and loads the core test data. RemoteConfigCore
## itself only when `with_remote_config`.
func start(with_remote_config: bool = true) -> void:
	changed_events = 0
	assert_true(UnitTestCore.set_test_settings("RemoteConfigCore.refreshIntervalMs", INTERVAL_MS))
	ResourceCoreDev.set_test_key_list({CLICK: "res://core/remote_config_core/tests/resources/test_click.tres"})
	assert_true(LogCore.init(), "LogCore.init")
	assert_true(EventCore.init(), "EventCore.init")
	assert_true(TimeCore.init(), "TimeCore.init")
	assert_true(LocalDataCore.init(), "LocalDataCore.init")
	assert_true(LocalDataCore.load_device_file(), "LocalDataCore.load_device_file")
	assert_true(ResourceCore.init(), "ResourceCore.init")
	assert_true(PoolCore.init(), "PoolCore.init")
	assert_true(DataCore.init(), "DataCore.init")
	assert_true(ResolutionCore.init(), "ResolutionCore.init")
	assert_true(InputBlockCore.init(), "InputBlockCore.init")
	assert_true(InputCore.init(), "InputCore.init")
	assert_true(SoundCore.init(), "SoundCore.init")
	assert_true(LocalizationCore.init(), "LocalizationCore.init")
	assert_true(SafeAreaCore.init(), "SafeAreaCore.init")
	assert_true(TweenCore.init(), "TweenCore.init")
	assert_true(UICore.init(), "UICore.init")
	assert_true(MessageCore.init(), "MessageCore.init")
	assert_true(UserStateCore.init(), "UserStateCore.init")
	assert_true(NetworkCore.init(), "NetworkCore.init")
	assert_true(AuthCore.init(), "AuthCore.init")
	assert_true(await DataCore.load(null), "DataCore.load")
	LocalizationCore.resolve_language()
	assert_true(await LocalizationCore.load_translation([]), "LocalizationCore.load_translation")
	assert_true(await UICore.prepare(), "UICore.prepare")
	assert_true(await MessageCore.prepare(), "MessageCore.prepare")
	assert_true(NetworkCore.set_server_info(BASE_URL, "1.0.0", CoreBuildInfo.platform), "set_server_info")
	flag = GameDataDev.find_id_value("[rc_flag]")
	count = GameDataDev.find_id_value("[rc_count]")
	title = GameDataDev.find_id_value("[rc_title]")
	threshold = GameDataDev.find_id_value("[rc_threshold]")
	exp_a = GameDataDev.find_id_value("[exp_a]")
	exp_b = GameDataDev.find_id_value("[exp_b]")
	assert_ne(threshold, 0, "[rc_threshold] has an ID value")
	assert_false(GameData.RemoteConfigKeyTable.has_row(threshold), "[rc_threshold] is not in client data")
	assert_true(EventCore.subscribe(RemoteConfigChangedEvent, _on_remote_config_changed))
	if with_remote_config:
		assert_true(RemoteConfigCore.init(), "RemoteConfigCore.init")


func _on_remote_config_changed(_event: RemoteConfigChangedEvent) -> void:
	changed_events += 1


## Logs in through `DevLogin` whose login response carries `remote_config`.
func login(remote_config: CoreContract.GetRemoteConfigResponse) -> void:
	var result: CoreContract.AuthResult = CoreContract.AuthResult.new()
	result.user_id = 7001
	result.user_created_at = SERVER_TIME - 1000
	result.login_token = "login-7001"
	result.access_token = "access-7001"
	result.access_token_expires_at = SERVER_TIME + TOKEN_TTL_MS
	result.session_signing_key = "key-7001"
	result.consent = CoreContract.ConsentUserState.new()
	result.remote_config = remote_config
	var response: CoreCheatContract.DevLoginResponse = CoreCheatContract.DevLoginResponse.new()
	response.result = result
	add_response(DEV_LOGIN, response)
	var login_result: LoginResult = await AuthCoreDev.dev_login("remote-config-test")
	assert_eq(login_result.status, AuthCore.LoginStatus.SUCCESS, "dev login")
	# LogCore sends the error logs of a test through NetworkCore once a session is open.
	for i: int in 4:
		add_response(REPORT_ERRORS, null)


## Background return of `background_ms`, with the results of the requests the return sends: NetworkCore's `Resync`
## and AuthCore's access token refresh.
func return_from_background(background_ms: int) -> void:
	add_response(RESYNC, CoreContract.ResyncResponse.new())
	var refreshed: CoreContract.RefreshTokenResponse = CoreContract.RefreshTokenResponse.new()
	refreshed.access_token = "access-7001-refreshed"
	refreshed.access_token_expires_at = SERVER_TIME + TOKEN_TTL_MS
	add_response(REFRESH_TOKEN, refreshed)
	UnitTestCore.advance_clock(background_ms, true)


func start_refresh() -> Call:
	var call: Call = Call.new()
	_refresh_into(call)
	return call


func _refresh_into(call: Call) -> void:
	call.ok = await RemoteConfigCore.refresh()
	call.done = true
	call.finished.emit()


func wait_call(call: Call) -> bool:
	if not call.done:
		await call.finished
	return call.ok


# --- fake network results ---


func response_bytes(message: ContractMessage) -> PackedByteArray:
	var envelope: CoreContract.ResponseEnvelope = CoreContract.ResponseEnvelope.new()
	envelope.server_time_at = SERVER_TIME
	if message != null:
		envelope.body = message.encode()
	return UnitTestCore.make_response(envelope)


func add_response(request_name: String, message: ContractMessage) -> void:
	UnitTestCore.add_result(request_name, NetworkCore.TransferResult.DONE, 200, response_bytes(message))


func add_get(remote_config: CoreContract.GetRemoteConfigResponse) -> void:
	add_response(GET, remote_config)


func request_count(request_name: String) -> int:
	var found: int = 0
	for received: UnitTestRequest in UnitTestCore.received_requests():
		if received.name == request_name:
			found += 1
	return found


# --- remote config messages ---


static func config(
	entries: Array[CoreContract.RemoteConfigEntry],
	assignments: Array[CoreContract.ExperimentAssignment] = []
) -> CoreContract.GetRemoteConfigResponse:
	var response: CoreContract.GetRemoteConfigResponse = CoreContract.GetRemoteConfigResponse.new()
	response.entries = entries
	response.assignments = assignments
	return response


static func entry(key_id: int, kind: CoreContract.RemoteConfigValueKind) -> CoreContract.RemoteConfigEntry:
	var value: CoreContract.RemoteConfigValue = CoreContract.RemoteConfigValue.new()
	value.kind = kind
	var item: CoreContract.RemoteConfigEntry = CoreContract.RemoteConfigEntry.new()
	item.key_id = key_id
	item.value = value
	return item


static func bool_entry(key_id: int, value: bool) -> CoreContract.RemoteConfigEntry:
	var item: CoreContract.RemoteConfigEntry = entry(key_id, CoreContract.RemoteConfigValueKind.REMOTE_CONFIG_VALUE_KIND_BOOL)
	item.value.bool_value = value
	return item


static func int_entry(key_id: int, value: int) -> CoreContract.RemoteConfigEntry:
	var item: CoreContract.RemoteConfigEntry = entry(key_id, CoreContract.RemoteConfigValueKind.REMOTE_CONFIG_VALUE_KIND_INT)
	item.value.int_value = value
	return item


static func string_entry(key_id: int, value: String) -> CoreContract.RemoteConfigEntry:
	var item: CoreContract.RemoteConfigEntry = entry(
		key_id, CoreContract.RemoteConfigValueKind.REMOTE_CONFIG_VALUE_KIND_STRING
	)
	item.value.string_value = value
	return item


static func assignment(experiment_id: int, group: String) -> CoreContract.ExperimentAssignment:
	var item: CoreContract.ExperimentAssignment = CoreContract.ExperimentAssignment.new()
	item.experiment_id = experiment_id
	item.group = group
	return item


func error_logs() -> int:
	return UnitTestCore.check_logs("error", TAG)


func warn_logs() -> int:
	return UnitTestCore.check_logs("warn", TAG)
