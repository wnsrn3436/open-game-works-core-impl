extends UnitTestCase
## Base of the NetworkCore core tests. Starts NetworkCore and the modules it depends on in module list order, and
## reads the fake network, the popups, the toasts, the loading icon and the events NetworkCore publishes.

const FakeProvider := preload("res://core/network_core/tests/support/fake_session_provider.gd")
const SERVER_TIME: int = 1700000500000
const BASE_URL: String = "http://127.0.0.1"
const APP_VERSION: String = "1.2.3"

const INTERACTION: String = "core/CheckPurchase"
const RETRY: String = "core/ClaimMission"
const SILENT: String = "core/GetLootRates"
const SILENT_RETRY: String = "core/SaveTutorialProgress"
const RESYNC: String = "core/Resync"

const TIMEOUT_MS: int = 10000
const RETRY_COUNT: int = 3
const RETRY_DELAY_MS: int = 1000
const RETRY_FACTOR_PERMILLE: int = 2000
const RETRY_DELAY_MAX_MS: int = 3000
const MAX_RETRY_AGE_MS: int = 60000
const ICON_DELAY_MS: int = 500
const MAX_BYTES: int = 4096
const RECORD_COUNT: int = 3
const BLOCK_MAX_MS: int = 25000
## The resource key of `[ui_button_click]` in the core test data. `UICore.prepare` loads it.
const CLICK: String = "sfx/ui_button_click"

var provider: FakeProvider = null
## `<request name>:<success flag>` of every `RequestCompletedEvent`, in order.
var completed: PackedStringArray = PackedStringArray()
var update_codes: PackedInt32Array = PackedInt32Array()
var restart_count: int = 0
## Order marks the success callbacks and the event handlers of a test write.
var marks: PackedStringArray = PackedStringArray()


func after_each() -> void:
	await super()
	CoreBuildInfo.has_dev_code = true


## Initializes NetworkCore's dependencies and NetworkCore, loads the device file and data and prepares the UI, then
## sets server info and, when `with_provider`, `provider` as the session provider.
func start_network(with_provider: bool = true) -> void:
	completed = PackedStringArray()
	update_codes = PackedInt32Array()
	restart_count = 0
	marks = PackedStringArray()
	assert_true(UnitTestCore.set_test_settings("NetworkCore.requestTimeoutMs", TIMEOUT_MS))
	assert_true(UnitTestCore.set_test_settings("NetworkCore.retryCount", RETRY_COUNT))
	assert_true(UnitTestCore.set_test_settings("NetworkCore.retryDelayMs", RETRY_DELAY_MS))
	assert_true(UnitTestCore.set_test_settings("NetworkCore.retryDelayFactorPermille", RETRY_FACTOR_PERMILLE))
	assert_true(UnitTestCore.set_test_settings("NetworkCore.retryDelayMaxMs", RETRY_DELAY_MAX_MS))
	assert_true(UnitTestCore.set_test_settings("NetworkCore.maxRetryAgeMs", MAX_RETRY_AGE_MS))
	assert_true(UnitTestCore.set_test_settings("NetworkCore.loadingIconDelayMs", ICON_DELAY_MS))
	assert_true(UnitTestCore.set_test_settings("NetworkCore.responseMaxBytes", MAX_BYTES))
	assert_true(UnitTestCore.set_test_settings("NetworkCore.devRequestRecordCount", RECORD_COUNT))
	assert_true(UnitTestCore.set_test_settings("InputBlockCore.maxDurationMs", BLOCK_MAX_MS))
	# The test clock does not move between popup button taps; UICore would drop the taps after the first.
	assert_true(UnitTestCore.set_test_settings("UICore.buttonClickIntervalMs", 0))
	ResourceCoreDev.set_test_key_list({CLICK: "res://core/network_core/tests/resources/test_click.tres"})
	assert_true(LogCore.init(), "LogCore.init")
	assert_true(EventCore.init(), "EventCore.init")
	assert_true(TimeCore.init(), "TimeCore.init")
	assert_true(LocalDataCore.init(), "LocalDataCore.init")
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
	assert_true(LocalDataCore.load_device_file(), "LocalDataCore.load_device_file")
	assert_true(await DataCore.load(null), "DataCore.load")
	LocalizationCore.resolve_language()
	assert_true(await LocalizationCore.load_translation([]), "LocalizationCore.load_translation")
	assert_true(await UICore.prepare(), "UICore.prepare")
	assert_true(await MessageCore.prepare(), "MessageCore.prepare")
	assert_true(NetworkCore.set_server_info(BASE_URL, APP_VERSION, CoreBuildInfo.platform), "set_server_info")
	assert_true(EventCore.subscribe(RequestCompletedEvent, _on_request_completed))
	assert_true(EventCore.subscribe(UpdateRequiredEvent, _on_update_required))
	assert_true(EventCore.subscribe(RestartRequestedEvent, _on_restart_requested))
	if with_provider:
		provider = FakeProvider.new()
		NetworkCore.set_session_provider(provider)
		# The tests that check the log sender register it again; the others keep LogCore's batches off the fake
		# network.
		LogCore.clear_sender()


func _on_request_completed(event: RequestCompletedEvent) -> void:
	completed.append("%s:%s" % [event.request_name, event.success])
	marks.append("completed")


func _on_update_required(event: UpdateRequiredEvent) -> void:
	update_codes.append(event.error_code)


func _on_restart_requested(_event: RestartRequestedEvent) -> void:
	restart_count += 1


# --- requests ---


## A request of `request_name`: one of the constants above or `core/Login`, `core/GetTerms`, `core/GetNotices`.
func request(request_name: String) -> ContractRequest:
	match request_name:
		INTERACTION:
			return CoreContract.CheckPurchaseRequest.new()
		RETRY:
			return CoreContract.ClaimMissionRequest.new()
		SILENT:
			return CoreContract.GetLootRatesRequest.new()
		SILENT_RETRY:
			return CoreContract.SaveTutorialProgressRequest.new()
		RESYNC:
			return CoreContract.ResyncRequest.new()
		"core/Login":
			return CoreContract.LoginRequest.new()
		"core/AutoLogin":
			return CoreContract.AutoLoginRequest.new()
		"core/GetTerms":
			return CoreContract.GetTermsRequest.new()
		"core/GetNotices":
			return CoreContract.GetNoticesRequest.new()
		"core/ConfirmAge":
			return CoreContract.ConfirmAgeRequest.new()
	return CoreContract.CheckPurchaseRequest.new()


## A `send` running in the background: `done` and `ok` after it ends.
class Sent extends RefCounted:
	signal finished
	var done: bool = false
	var ok: bool = false


func start_send(message: ContractRequest, on_success: Callable = Callable(), on_failure: Callable = Callable(), options: SendOptions = null) -> Sent:
	var sent: Sent = Sent.new()
	_send_into(sent, message, on_success, on_failure, options)
	return sent


func _send_into(sent: Sent, message: ContractRequest, on_success: Callable, on_failure: Callable, options: SendOptions) -> void:
	sent.ok = await NetworkCore.send(message, on_success, on_failure, options)
	sent.done = true
	sent.finished.emit()


func wait_sent(sent: Sent) -> bool:
	if not sent.done:
		await sent.finished
	return sent.ok


# --- fake network results ---


func envelope(server_time: int = SERVER_TIME) -> CoreContract.ResponseEnvelope:
	var env: CoreContract.ResponseEnvelope = CoreContract.ResponseEnvelope.new()
	env.server_time_at = server_time
	return env


func ok_bytes(response: ContractMessage = null, server_time: int = SERVER_TIME) -> PackedByteArray:
	var env: CoreContract.ResponseEnvelope = envelope(server_time)
	if response != null:
		env.body = response.encode()
	return UnitTestCore.make_response(env)


func error_bytes(code: int, server_time: int = SERVER_TIME) -> PackedByteArray:
	var env: CoreContract.ResponseEnvelope = envelope(server_time)
	env.error = CoreContract.ServerError.new()
	env.error.code = code
	env.error.detail = "detail of %d" % code
	return UnitTestCore.make_response(env)


func add_ok(request_name: String, server_time: int = SERVER_TIME) -> void:
	UnitTestCore.add_result(request_name, NetworkCore.TransferResult.DONE, 200, ok_bytes(null, server_time))


func add_envelope(request_name: String, env: CoreContract.ResponseEnvelope) -> void:
	UnitTestCore.add_result(request_name, NetworkCore.TransferResult.DONE, 200, UnitTestCore.make_response(env))


func add_error(request_name: String, code: int) -> void:
	UnitTestCore.add_result(request_name, NetworkCore.TransferResult.DONE, 200, error_bytes(code))


func add_connection_failure(request_name: String, count: int = 1) -> void:
	for i: int in count:
		UnitTestCore.add_result(request_name, NetworkCore.TransferResult.CONNECTION_FAILED, 0, PackedByteArray())


func release_ok(request_name: String) -> bool:
	return UnitTestCore.release_pending(request_name, NetworkCore.TransferResult.DONE, 200, ok_bytes())


func request_count(request_name: String = "") -> int:
	var count: int = 0
	for received in UnitTestCore.received_requests():
		if request_name.is_empty() or received.name == request_name:
			count += 1
	return count


## Header `name` of the `index`-th received request; an empty string when it has none.
func header(index: int, header_name: String) -> String:
	var at: int = 0
	for received in UnitTestCore.received_requests():
		if at == index:
			for line: String in received.headers:
				if line.begins_with(header_name + ": "):
					return line.substr(header_name.length() + 2)
			return ""
		at += 1
	return ""


func has_header(index: int, header_name: String) -> bool:
	var at: int = 0
	for received in UnitTestCore.received_requests():
		if at == index:
			for line: String in received.headers:
				if line.begins_with(header_name + ": "):
					return true
			return false
		at += 1
	return false


func body_of(index: int) -> PackedByteArray:
	var at: int = 0
	for received in UnitTestCore.received_requests():
		if at == index:
			return received.body
		at += 1
	return PackedByteArray()


## A UserState delta that upserts `TutorialProgressUserState` rows `ids`, or that holds row 1 twice when `broken`.
func tutorial_delta(ids: PackedInt64Array, full: bool = false, broken: bool = false) -> CoreContract.UserStateDelta:
	var delta: CoreContract.UserStateDelta = CoreContract.UserStateDelta.new()
	delta.full = full
	var rows: PackedInt64Array = PackedInt64Array([1, 1]) if broken else ids
	for id: int in rows:
		var row: CoreContract.TutorialProgressUserState = CoreContract.TutorialProgressUserState.new()
		row.id = id
		row.step = 3
		var entry: CoreContract.UserStateEntry = CoreContract.UserStateEntry.new()
		entry.kind = "TutorialProgressUserState"
		entry.id = id
		entry.value = row.encode()
		delta.entries.append(entry)
	return delta


# --- time ---


## Moves the test clock and lets NetworkCore's frame check and its deferred part run.
func advance(ms: int) -> void:
	UnitTestCore.advance_clock(ms, false)
	await UnitTestCore.wait_frames(2)


# --- screen ---


func text_of(key: String) -> String:
	return LocalizationCore.get_text(key)


## Texts of the visible labels and buttons of a UI layer.
func layer_texts(layer: UICore.UILayer) -> PackedStringArray:
	var out: PackedStringArray = PackedStringArray()
	_collect_texts(UICore.get_layer(layer), out)
	return out


func _collect_texts(node: Node, out: PackedStringArray) -> void:
	if node == null:
		return
	for child: Node in node.get_children():
		if child is CanvasItem and not (child as CanvasItem).is_visible_in_tree():
			continue
		if child is Label:
			out.append((child as Label).text)
		elif child is RichTextLabel:
			out.append((child as RichTextLabel).get_parsed_text())
		elif child is Button:
			out.append((child as Button).text)
		_collect_texts(child, out)


## True when a visible text of the layer contains the translation of `key`.
func shows(layer: UICore.UILayer, key: String) -> bool:
	var want: String = text_of(key)
	for text: String in layer_texts(layer):
		if text.contains(want):
			return true
	return false


func popup_shows(key: String) -> bool:
	return shows(UICore.UILayer.POPUP, key)


func toast_shows(key: String) -> bool:
	return shows(UICore.UILayer.MESSAGE, key)


## Visible text of the popup layer that contains `part`; an empty string when none does.
func popup_text_with(part: String) -> String:
	for text: String in layer_texts(UICore.UILayer.POPUP):
		if text.contains(part):
			return text
	return ""


func popup_count() -> int:
	return UICore.get_open_popup_count()


## True when an element under the loading icon layer's root is visible. The root itself is always visible.
func loading_icon_visible() -> bool:
	var layer: CanvasLayer = UICore.get_layer(UICore.UILayer.LOADING_ICON)
	if layer == null:
		return false
	for root: Node in layer.get_children():
		for child: Node in root.get_children():
			if child is CanvasItem and (child as CanvasItem).is_visible_in_tree():
				return true
	return false


## Taps the visible popup button whose text is the translation of `label_key`. `false` when there is none.
func press_popup_button(label_key: String) -> bool:
	var button: Button = _find_button(UICore.get_layer(UICore.UILayer.POPUP), text_of(label_key))
	if button == null:
		return false
	UnitTestCore.tap(button.get_global_rect().get_center())
	await UnitTestCore.wait_frames(2)
	return true


func _find_button(node: Node, text: String) -> Button:
	if node == null:
		return null
	for child: Node in node.get_children():
		if child is CanvasItem and not (child as CanvasItem).is_visible_in_tree():
			continue
		if child is Button and (child as Button).text == text:
			return child as Button
		var found: Button = _find_button(child, text)
		if found != null:
			return found
	return null


## Presses and lets go of the back key.
func press_back() -> void:
	var down: InputEventKey = InputEventKey.new()
	down.keycode = KEY_ESCAPE
	down.pressed = true
	InputCoreDev.inject_device_input(down)
	var up: InputEventKey = InputEventKey.new()
	up.keycode = KEY_ESCAPE
	up.pressed = false
	InputCoreDev.inject_device_input(up)
	await UnitTestCore.wait_frames(2)


## Text of the log files after a flush. `list_log_files` gives paths under the app storage root.
func log_text() -> String:
	var text: String = ""
	for path: String in LogCoreDev.list_log_files():
		text += FileAccess.get_file_as_string(CoreBuildInfo.storage_root + path)
	assert_ne(text, "", "the log files have lines")
	return text


func error_logs() -> int:
	return UnitTestCore.check_logs("error", "NetworkCore")


func warn_logs() -> int:
	return UnitTestCore.check_logs("warn", "NetworkCore")
