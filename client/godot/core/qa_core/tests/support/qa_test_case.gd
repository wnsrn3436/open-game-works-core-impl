extends UnitTestCase
## Base of the QACore core tests: settings, test resources, module start in module list order, command helpers,
## the fake network, JSON reading and log reading. Every test releases QACore before the setup and at its end.

const JSONR := preload("res://core/qa_core/tests/support/qa_json_read.gd")
const SESSION := preload("res://core/qa_core/tests/support/qa_session_provider.gd")

const RESOURCES: String = "res://core/qa_core/tests/resources/"
const SCENE: String = "scene/qa_test"
const SCENE_OTHER: String = "scene/qa_test_other"
const PANEL: String = "prefab/qa_test_panel"
const PANEL_OTHER: String = "prefab/qa_test_panel_other"
const POPUP: String = "prefab/qa_test_popup"
const TUTORIAL_VIEW: String = "prefab/qa_tutorial_view"
const LOADING: String = "prefab/qa_loading"
const MISSING: String = "scene/qa_test_missing"
## The resource key of `[ui_button_click]` in the core test data.
const CLICK: String = "sfx/ui_button_click"
const TAG: String = "QACore"
const ERROR: String = "error"
const WARN: String = "warn"
const BASE_URL: String = "http://127.0.0.1"
const SERVER_TIME: int = 1700000500000
const USER_ID: int = 1001
const DEV_LOGIN: String = "core/cheat/DevLogin"
const ACCESS_TOKEN_MS: int = 86400000

const COMMAND_TIMEOUT_MS: int = 5000
const CHANNEL_MAX_BYTES: int = 4096
const STATS_REFRESH_MS: int = 100
const TEXT_MAX_CHARS: int = 8
const VIDEO_FPS: int = 4
const VIDEO_MAX_MS: int = 2000
const FEEDBACK_WINDOW_MS: int = 500
const IDLE_THRESHOLD_MS: int = 1000
const TELEMETRY_MAX_RECORDS: int = 5
const SOFTLOCK_BLOCK_MS: int = 2000
const SOFTLOCK_NO_RESPONSE_MS: int = 3000
const SOFTLOCK_INPUTS: int = 3
const STEP_MAX_MS: int = 1000
const TOUCH_INDEX_COUNT: int = 4
const TIME_SCALE_MAX_PERMILLE: int = 4000
const BASE_RESOLUTION: Vector2i = Vector2i(1280, 720)

## Click callback labels of the buttons a test made, in click order.
var clicks: PackedStringArray = PackedStringArray()
## `RestartRequestedEvent`s since `start`, and the `module` of the last one.
var restarts: int = 0
var restart_module: String = ""


func before_each() -> void:
	QACore.release()
	super()
	clicks = PackedStringArray()
	restarts = 0
	restart_module = ""
	set_int("QACore.commandTimeoutMs", COMMAND_TIMEOUT_MS)
	set_int("QACore.channelMessageMaxBytes", CHANNEL_MAX_BYTES)
	set_int("QACore.statsRefreshMs", STATS_REFRESH_MS)
	set_int("QACore.textMaxChars", TEXT_MAX_CHARS)
	set_int("QACore.videoFps", VIDEO_FPS)
	set_int("QACore.videoMaxMs", VIDEO_MAX_MS)
	set_int("QACore.feedbackWindowMs", FEEDBACK_WINDOW_MS)
	set_int("QACore.idleThresholdMs", IDLE_THRESHOLD_MS)
	set_int("QACore.telemetryMaxRecords", TELEMETRY_MAX_RECORDS)
	set_block_ms(SOFTLOCK_BLOCK_MS)
	set_int("QACore.softlockNoResponseMs", SOFTLOCK_NO_RESPONSE_MS)
	set_int("QACore.softlockNoResponseInputs", SOFTLOCK_INPUTS)
	set_int("QACore.stepMaxMs", STEP_MAX_MS)
	set_int("QACore.timeScaleMaxPermille", TIME_SCALE_MAX_PERMILLE)
	set_int("QACore.touchIndexCount", TOUCH_INDEX_COUNT)
	set_int("UICore.buttonClickIntervalMs", 0)
	set_string("UICore.dimResource", "")
	set_string("UICore.loadingIconResource", "")
	set_string("UICore.systemPopupResource", "")
	set_string("loadingScreen", LOADING)
	set_int("SceneCore.loadingMinDisplayMs", 0)
	QACore._test_launch_values = {}
	QACore._has_test_launch_values = true


func after_each() -> void:
	QACore.release()
	super()


func set_int(key: String, value: int) -> void:
	assert_true(UnitTestCore.set_test_settings(key, value), key)


func set_string(key: String, value: String) -> void:
	assert_true(UnitTestCore.set_test_settings(key, value), key)


func set_bool(key: String, value: bool) -> void:
	assert_true(UnitTestCore.set_test_settings(key, value), key)


## `QACore.softlockBlockMs` with `ms` for every reason tag.
func set_block_ms(ms: int) -> void:
	var values: Dictionary[String, int] = {}
	for reason: String in QACore._SOFTLOCK_REASONS:
		values[reason] = ms
	_set_object("QACore.softlockBlockMs", values)


# ogw:input_boundary
func _set_object(key: String, values: Dictionary[String, int]) -> void:
	var plain: Dictionary = {}
	for name: String in values:
		plain[name] = values[name]
	assert_true(UnitTestCore.set_test_settings(key, plain), key)


func resource_keys() -> Dictionary[String, String]:
	var keys: Dictionary[String, String] = {
		SCENE: RESOURCES + "qa_test_scene.tscn",
		SCENE_OTHER: RESOURCES + "qa_test_scene.tscn",
		PANEL: RESOURCES + "qa_test_panel.tscn",
		PANEL_OTHER: RESOURCES + "qa_test_panel.tscn",
		POPUP: RESOURCES + "qa_test_popup.tscn",
		CLICK: RESOURCES + "qa_click.tres",
		TUTORIAL_VIEW: RESOURCES + "qa_tutorial_view.tscn",
		LOADING: RESOURCES + "qa_loading.tscn",
	}
	for font: String in ["font/main", "font/cjk"]:
		keys[font] = RESOURCES + "qa_font.tres"
	for icon: String in ["icon/key_j", "icon/key_escape", "icon/pad_b", "icon/ps_circle"]:
		keys[icon] = RESOURCES + "qa_icon.tres"
	return keys


## Starts the modules QACore depends on in module list order with the core test data and translation, prepares
## `UICore` and `MessageCore`, sets the server info, boots `SceneCore` into `SCENE` when `boot_scene`, then inits
## QACore unless `init_qa` is false. Settings and launch values are set before. Async.
func start(init_qa: bool = true, boot_scene: bool = true) -> bool:
	ResourceCoreDev.set_test_key_list(resource_keys())
	var started: bool = (
		LogCore.init() and EventCore.init() and TimeCore.init() and LocalDataCore.init() and ResourceCore.init()
		and PoolCore.init() and DataCore.init() and UserStateCore.init() and ResolutionCore.init()
		and SafeAreaCore.init() and InputBlockCore.init() and InputCore.init() and LocalizationCore.init()
		and SoundCore.init() and TweenCore.init() and UICore.init() and ScreenEffectCore.init() and MessageCore.init()
		and NetworkCore.init() and SceneCore.init()
	)
	assert_true(started, "dependencies init")
	if not started:
		return false
	assert_true(LocalDataCore.load_device_file(), "LocalDataCore.load_device_file")
	var loaded: bool = await DataCore.load(null)
	assert_true(loaded, "DataCore.load")
	LocalizationCore.resolve_language()
	var translated: bool = await LocalizationCore.load_translation([])
	assert_true(translated, "LocalizationCore.load_translation")
	var ui_ready: bool = await UICore.prepare()
	assert_true(ui_ready, "UICore.prepare")
	var message_ready: bool = await MessageCore.prepare()
	assert_true(message_ready, "MessageCore.prepare")
	assert_true(NetworkCore.set_server_info(BASE_URL, "1.0.0", CoreBuildInfo.platform), "set_server_info")
	NetworkCore.set_session_provider(SESSION.new())
	# NetworkCore registers the LogCore sender; the tests keep the error reports off the fake network.
	LogCore.clear_sender()
	assert_true(EventCore.subscribe(RestartRequestedEvent, _on_restart_requested))
	if boot_scene:
		var booted: bool = await SceneCore.boot_change_scene(SCENE, null)
		assert_true(booted, "boot_change_scene")
	if not init_qa:
		return loaded and translated and ui_ready
	var initialized: bool = QACore.init()
	assert_true(initialized, "QACore.init")
	return loaded and translated and ui_ready and initialized


func _on_restart_requested(event: RestartRequestedEvent) -> void:
	restarts += 1
	restart_module = event.module


# --- commands ---


## Runs one command and waits for its result.
func run(command_name: String, args: PackedStringArray = PackedStringArray()) -> RunCommandResult:
	var result: RunCommandResult = await QACore.run_command(command_name, args)
	return result


## Runs one command that must succeed and returns its `result` JSON text.
func run_ok(command_name: String, args: PackedStringArray = PackedStringArray()) -> String:
	var result: RunCommandResult = await run(command_name, args)
	assert_true(result.ok, "%s %s: %s" % [command_name, " ".join(args), result.result])
	return result.result


## A command started without waiting: `done` and the result after it ends.
class Pending:
	extends RefCounted
	signal finished
	var done: bool = false
	var result: RunCommandResult = null


func start_command(command_name: String, args: PackedStringArray = PackedStringArray()) -> Pending:
	var pending: Pending = Pending.new()
	_run_into(pending, command_name, args)
	return pending


func _run_into(pending: Pending, command_name: String, args: PackedStringArray) -> void:
	pending.result = await QACore.run_command(command_name, args)
	pending.done = true
	pending.finished.emit()


## Waits for `pending`, moving the test clock by `step_ms` a frame at most `frames` times.
func finish(pending: Pending, step_ms: int = 16, frames: int = 200) -> RunCommandResult:
	for i: int in frames:
		if pending.done:
			break
		await advance(step_ms, 1)
	assert_true(pending.done, "the command ended")
	return pending.result if pending.result != null else RunCommandResult.new()


## Moves the test clock by `ms` of foreground time and lets the modules process it.
func advance(ms: int, frames: int = 2) -> void:
	UnitTestCore.advance_clock(ms, false)
	await UnitTestCore.wait_frames(frames)


func state() -> String:
	return await run_ok("get_state")


func telemetry() -> String:
	return await run_ok("get_telemetry")


## Warn logs of QACore since the last check.
func warns() -> int:
	return UnitTestCore.check_logs(WARN, TAG)


func errors() -> int:
	return UnitTestCore.check_logs(ERROR, TAG)


## Every line of the log files.
func log_text() -> String:
	var parts: PackedStringArray = PackedStringArray()
	for path: String in LogCoreDev.list_log_files():
		parts.append(FileAccess.get_file_as_string(CoreBuildInfo.storage_root + path))
	return "\n".join(parts)


# --- UI ---


## A `Button` with a `UIButton` child that records `label` when clicked, on the `SceneUI` layer at `position`.
func add_button(label: String, position: Vector2 = Vector2(600, 300), button_size: Vector2 = Vector2(120, 60)) -> Button:
	var button: Button = Button.new()
	button.name = label.capitalize().replace(" ", "")
	button.text = label
	button.position = position
	button.size = button_size
	var ui_button: UIButton = UIButton.new()
	ui_button.set_on_click(_on_click.bind(label))
	button.add_child(ui_button)
	UICore.get_layer(UICore.UILayer.SCENE_UI).add_child(button)
	return button


func _on_click(label: String) -> void:
	clicks.append(label)


func add_anchor(control: Control, anchor_name: String, key: int = 0) -> UIAnchor:
	var anchor: UIAnchor = UIAnchor.new()
	anchor.anchor_name = anchor_name
	control.add_child(anchor)
	if key != 0:
		anchor.set_anchor_key(key)
	return anchor


## Window pixel position of game position (`x`, `y`) as two command arguments.
func window_args(x: float, y: float) -> PackedStringArray:
	var window: Vector2 = ResolutionCore.game_to_window(Vector2(x, y))
	return PackedStringArray([str(window.x), str(window.y)])


## Window pixel center of `rect` (`[x, y, w, h]` of `list_ui` or `get_anchor`) as `tap` arguments.
func center_args(rect: Rect2) -> PackedStringArray:
	var center: Vector2 = rect.get_center()
	return PackedStringArray([str(center.x), str(center.y)])


## The `list_ui` element whose `path` ends with `/<suffix>`; its index, or -1.
func element_index(list: String, suffix: String) -> int:
	for i: int in JSONR.count(list, ""):
		if JSONR.text(list, "%d.path" % i).ends_with("/" + suffix):
			return i
	return -1


## The `list_ui` field `field` of the element whose path ends with `suffix`, as JSON text.
func element_field(list: String, suffix: String, field: String) -> String:
	var index: int = element_index(list, suffix)
	assert_true(index >= 0, "list_ui has " + suffix)
	return JSONR.at(list, "%d.%s" % [index, field]) if index >= 0 else ""


# --- fake network ---


func ok_bytes(response: ContractMessage = null) -> PackedByteArray:
	var envelope: CoreContract.ResponseEnvelope = CoreContract.ResponseEnvelope.new()
	envelope.server_time_at = SERVER_TIME
	if response != null:
		envelope.body = response.encode()
	return UnitTestCore.make_response(envelope)


## Dev login of `USER_ID` through the fake network, and the user file. `AuthCore` is initialized before. Async.
func dev_login() -> void:
	var auth: CoreContract.AuthResult = CoreContract.AuthResult.new()
	auth.user_id = USER_ID
	auth.user_created_at = SERVER_TIME - 1000
	auth.login_token = "qa-test-login-token"
	auth.access_token = "qa-test-access-token-value"
	auth.access_token_expires_at = SERVER_TIME + ACCESS_TOKEN_MS
	auth.session_signing_key = "qa-test-signing-key"
	auth.consent = CoreContract.ConsentUserState.new()
	auth.remote_config = CoreContract.GetRemoteConfigResponse.new()
	var response: CoreCheatContract.DevLoginResponse = CoreCheatContract.DevLoginResponse.new()
	response.result = auth
	UnitTestCore.add_result(DEV_LOGIN, NetworkCore.TransferResult.DONE, 200, ok_bytes(response))
	var login: LoginResult = await AuthCoreDev.dev_login("qa")
	assert_eq(login.status, AuthCore.LoginStatus.SUCCESS, "dev_login")
	assert_true(LocalDataCore.load_user_file(USER_ID), "LocalDataCore.load_user_file")


func add_ok(request_name: String, envelope: CoreContract.ResponseEnvelope = null) -> void:
	var bytes: PackedByteArray = UnitTestCore.make_response(envelope) if envelope != null else ok_bytes()
	UnitTestCore.add_result(request_name, NetworkCore.TransferResult.DONE, 200, bytes)


## Bodies of the received requests of `request_name`, in order.
func bodies(request_name: String) -> Array[PackedByteArray]:
	var found: Array[PackedByteArray] = []
	for received: UnitTestRequest in UnitTestCore.received_requests():
		if received.name == request_name:
			found.append(received.body)
	return found


func request_count() -> int:
	return UnitTestCore.received_requests().size()
