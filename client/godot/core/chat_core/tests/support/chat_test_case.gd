extends UnitTestCase
## Base of the ChatCore core tests. Starts NetworkCore and the modules it depends on, loads the user file, starts the
## modules `BadgeCore` depends on, `BadgeCore` and ChatCore, and gives the fake network chat responses.

const SERVER_TIME: int = 1700000500000
const BASE_URL: String = "http://127.0.0.1"
const APP_VERSION: String = "1.2.3"
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
const GET_CHANNELS: String = "core/GetChatChannels"
const GET_MESSAGES: String = "core/GetChatMessages"
const SEND: String = "core/SendChatMessage"
const USER_ID: int = 1001
const MAX_WATCHED: int = 2
const FAILURE_RETRY_MS: int = 7000
## Poll wait of a response in a test that does not wait for the next poll.
const LONG_MS: int = 3600000
const GUILD_ID: int = 77
const OTHER_GUILD_ID: int = 78
const FRIEND_ID: int = 501
const OTHER_FRIEND_ID: int = 502
const WORLD_NUMBER: int = 3
const READ_SEQS_KEY: String = "ChatCore.read_seqs"
const READ_INITIALIZED_KEY: String = "ChatCore.read_initialized"
## The `badge` row `[chat_badge]` points at in the core test data.
const CHAT_BADGE_ROW: String = "[badge_chat]"
## App storage folder of the data `start_network` writes without a `badge` row.
const DATA_FOLDER: String = "chat_core_test/data"
## The resource key of `[ui_button_click]` in the core test data. `UICore.prepare` loads it.
const CLICK: String = "sfx/ui_button_click"

const WORLD: CoreContract.ChatChannelKind = CoreContract.ChatChannelKind.CHAT_CHANNEL_KIND_WORLD
const GUILD: CoreContract.ChatChannelKind = CoreContract.ChatChannelKind.CHAT_CHANNEL_KIND_GUILD
const DIRECT: CoreContract.ChatChannelKind = CoreContract.ChatChannelKind.CHAT_CHANNEL_KIND_DIRECT
const TEXT: CoreContract.ChatMessageKind = CoreContract.ChatMessageKind.CHAT_MESSAGE_KIND_TEXT

## `<channel key> <change> <count>` of every `ChatMessagesChangedEvent`, in order.
var changes: PackedStringArray = PackedStringArray()
var channel_events: int = 0


## The session of the ChatCore core tests: every access token request succeeds.
class ChatSessionProvider extends SessionProvider:
	func get_access_token() -> GetAccessTokenResult:
		return _ok()

	func refresh_access_token() -> GetAccessTokenResult:
		return _ok()

	func get_signing_key() -> String:
		return "signing-key-secret-1"

	func _ok() -> GetAccessTokenResult:
		var result: GetAccessTokenResult = GetAccessTokenResult.new()
		result.ok = true
		result.access_token = "access-token-secret-1"
		return result


## Initializes NetworkCore's dependencies and NetworkCore in module list order, loads data, prepares the UI, then sets
## server info and a `ChatSessionProvider` as the session provider. When `without_badge` is an ID name, the data is the
## core test data without that `badge` row.
func start_network(without_badge: String = "") -> void:
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
	ResourceCoreDev.set_test_key_list({CLICK: "res://core/chat_core/tests/resources/test_click.tres"})
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
	var downloaded: DownloadedData = null
	if not without_badge.is_empty():
		downloaded = write_data_without_badge(without_badge)
	assert_true(await DataCore.load(downloaded), "DataCore.load")
	if downloaded != null:
		assert_eq(DataCore.get_data_version(), downloaded.data_version, "the data without the badge row loaded")
	LocalizationCore.resolve_language()
	assert_true(await LocalizationCore.load_translation([]), "LocalizationCore.load_translation")
	assert_true(await UICore.prepare(), "UICore.prepare")
	assert_true(await MessageCore.prepare(), "MessageCore.prepare")
	assert_true(NetworkCore.set_server_info(BASE_URL, APP_VERSION, CoreBuildInfo.platform), "set_server_info")
	NetworkCore.set_session_provider(ChatSessionProvider.new())
	# Keeps LogCore's batches off the fake network.
	LogCore.clear_sender()


## Starts the modules and ChatCore, then `ChatCore.start` with the channel list `entries` when `start` is true. When
## `read_initialized` is true, the user file already has `ChatCore.read_initialized` true and `saved_seqs`. When
## `without_badge` is an ID name, the data has no `badge` row of it.
func start_chat(entries: Array[CoreContract.ChatChannelEntry] = [], start: bool = true, read_initialized: bool = false, saved_seqs: PackedStringArray = PackedStringArray(), without_badge: String = "") -> void:
	assert_true(UnitTestCore.set_test_settings("ChatCore.maxWatchedChannels", MAX_WATCHED))
	assert_true(UnitTestCore.set_test_settings("ChatCore.failureRetryMs", FAILURE_RETRY_MS))
	await start_network(without_badge)
	assert_true(LocalDataCore.load_user_file(USER_ID), "LocalDataCore.load_user_file")
	if read_initialized:
		LocalDataCore.set_value_bool(LocalDataCore.FileKind.USER, READ_INITIALIZED_KEY, true)
	if not saved_seqs.is_empty():
		LocalDataCore.set_array_string(LocalDataCore.FileKind.USER, READ_SEQS_KEY, saved_seqs)
	assert_true(RequirementCore.init(), "RequirementCore.init")
	assert_true(BadgeCore.init(), "BadgeCore.init")
	assert_true(ChatCore.init(), "ChatCore.init")
	changes = PackedStringArray()
	channel_events = 0
	assert_true(EventCore.subscribe(ChatMessagesChangedEvent, _on_messages_changed))
	assert_true(EventCore.subscribe(ChatChannelsChangedEvent, _on_channels_changed))
	if start:
		await start_with(entries)


## `ChatCore.start` with the channel list `entries` as the first `GetChatChannels` response.
func start_with(entries: Array[CoreContract.ChatChannelEntry], poll_ms: int = LONG_MS) -> void:
	add_channels(entries, poll_ms)
	ChatCore.start()
	await settle()


## ChatCore again from `init` and `start`, with the channel list `entries`. The other modules and the event
## subscriptions of the test stay.
func restart_chat(entries: Array[CoreContract.ChatChannelEntry]) -> void:
	ChatCore.release()
	assert_true(ChatCore.init(), "ChatCore.init")
	await start_with(entries)


func _on_messages_changed(event: ChatMessagesChangedEvent) -> void:
	changes.append("%d %s %d" % [event.channel_key, change_name(event.change), event.count])


func change_name(change: ChatCore.ChatMessagesChange) -> String:
	match change:
		ChatCore.ChatMessagesChange.RESET:
			return "Reset"
		ChatCore.ChatMessagesChange.APPENDED:
			return "Appended"
		ChatCore.ChatMessagesChange.PREPENDED:
			return "Prepended"
		ChatCore.ChatMessagesChange.REMOVED:
			return "Removed"
	return "?"


func _on_channels_changed(_event: ChatChannelsChangedEvent) -> void:
	channel_events += 1


## Lets the frame check, the deferred sends and the frame end sync run.
func settle() -> void:
	await UnitTestCore.wait_frames(3)


## Moves the test clock in the foreground and lets ChatCore run.
func pass_time(ms: int) -> void:
	UnitTestCore.advance_clock(ms, false)
	await settle()


# --- data ---


## Writes the built-in table binaries to app storage without the `badge` row `id_name`, and returns them as downloaded
## data of a new data version.
func write_data_without_badge(id_name: String) -> DownloadedData:
	var id_value: int = GameDataDev.find_id_value(id_name)
	assert_ne(id_value, 0, "ID value of %s" % id_name)
	var location: String = DataCore.get_builtin_location()
	var builtin_version: String = FileAccess.get_file_as_string(location + "data_version").strip_edges()
	var downloaded: DownloadedData = DownloadedData.new()
	downloaded.data_version = builtin_version.left(64) + "-" + UtilCore.sha256_hex(("without " + id_name).to_utf8_buffer())
	for name: String in DirAccess.get_files_at(location):
		if not name.ends_with(".bin") or name.begins_with("translation_"):
			continue
		var bytes: PackedByteArray = FileAccess.get_file_as_bytes(location + name)
		if name == "badge.bin":
			var kept: PackedByteArray = without_row(bytes, id_value)
			assert_lt(kept.size(), bytes.size(), "badge.bin had the row %s" % id_name)
			bytes = kept
		var path: String = DATA_FOLDER + "/" + name
		assert_true(LocalDataCore.write_file(path, bytes).ok, "write %s" % path)
		downloaded.files[path] = UtilCore.sha256_hex(bytes)
	return downloaded


## A table binary without the rows whose field 1 (`id`) is `id_value`. Each row is field 1 of the table message.
func without_row(table: PackedByteArray, id_value: int) -> PackedByteArray:
	var out: PackedByteArray = PackedByteArray()
	var at: int = 0
	while at < table.size():
		var start: int = at
		var length: PackedInt64Array = read_varint(table, at + 1)
		var end: int = length[1] + length[0]
		var row: PackedByteArray = table.slice(length[1], end)
		at = end
		if row.size() > 1 and row[0] == 0x08 and read_varint(row, 1)[0] == id_value:
			continue
		out.append_array(table.slice(start, end))
	return out


## [value, offset after it] of the varint at `at`.
func read_varint(bytes: PackedByteArray, at: int) -> PackedInt64Array:
	var value: int = 0
	var shift: int = 0
	var i: int = at
	while i < bytes.size():
		var b: int = bytes[i]
		value |= (b & 0x7F) << shift
		i += 1
		if b < 0x80:
			break
		shift += 7
	return PackedInt64Array([value, i])


# --- responses ---


func entry(kind: CoreContract.ChatChannelKind, channel_id: int, last_seq: int, last_visible_seq: int) -> CoreContract.ChatChannelEntry:
	var out: CoreContract.ChatChannelEntry = CoreContract.ChatChannelEntry.new()
	out.channel_kind = kind
	out.channel_key = channel_id
	out.last_seq = last_seq
	out.last_visible_seq = last_visible_seq
	return out


func channels_bytes(entries: Array[CoreContract.ChatChannelEntry], poll_ms: int = LONG_MS) -> PackedByteArray:
	var response: CoreContract.GetChatChannelsResponse = CoreContract.GetChatChannelsResponse.new()
	response.channels = entries
	response.poll_after_ms = poll_ms
	return ok_bytes(response)


func add_channels(entries: Array[CoreContract.ChatChannelEntry], poll_ms: int = LONG_MS) -> void:
	UnitTestCore.add_result(GET_CHANNELS, NetworkCore.TransferResult.DONE, 200, channels_bytes(entries, poll_ms))


func message(kind: CoreContract.ChatChannelKind, channel_id: int, seq: int) -> CoreContract.ChatMessage:
	var out: CoreContract.ChatMessage = CoreContract.ChatMessage.new()
	out.channel_kind = kind
	out.channel_key = channel_id
	out.seq = seq
	out.sender_id = FRIEND_ID
	out.message_kind = TEXT
	out.text = "message %d" % seq
	return out


## A `GetChatMessages` response of the channel `channel_id` with the messages `seqs`, in that order.
func messages(kind: CoreContract.ChatChannelKind, channel_id: int, seqs: PackedInt64Array, last_seq: int, first_seq: int, poll_ms: int = LONG_MS) -> CoreContract.GetChatMessagesResponse:
	var out: CoreContract.GetChatMessagesResponse = CoreContract.GetChatMessagesResponse.new()
	for seq: int in seqs:
		out.messages.append(message(kind, channel_id, seq))
	out.last_seq = last_seq
	out.first_seq = first_seq
	out.channel_key = channel_id
	out.poll_after_ms = poll_ms
	return out


func add_messages(response: CoreContract.GetChatMessagesResponse) -> void:
	UnitTestCore.add_result(GET_MESSAGES, NetworkCore.TransferResult.DONE, 200, ok_bytes(response))


func release_messages(response: CoreContract.GetChatMessagesResponse) -> bool:
	return UnitTestCore.release_pending(GET_MESSAGES, NetworkCore.TransferResult.DONE, 200, ok_bytes(response))


func add_sent(kind: CoreContract.ChatChannelKind, channel_id: int, seq: int) -> void:
	var response: CoreContract.SendChatMessageResponse = CoreContract.SendChatMessageResponse.new()
	response.message = message(kind, channel_id, seq)
	UnitTestCore.add_result(SEND, NetworkCore.TransferResult.DONE, 200, ok_bytes(response))


# --- async operations in the background ---


## A ChatCore async operation running in the background: `done`, `ok` and the `send_message` result after it ends.
class Run extends RefCounted:
	signal finished
	var done: bool = false
	var ok: bool = false
	var result: ChatSendResult = null


func refresh_in_background() -> Run:
	var run: Run = Run.new()
	_refresh_into(run)
	return run


func older_in_background(kind: CoreContract.ChatChannelKind, channel_key: int) -> Run:
	var run: Run = Run.new()
	_older_into(run, kind, channel_key)
	return run


func send_in_background(kind: CoreContract.ChatChannelKind, channel_key: int, text: String) -> Run:
	var run: Run = Run.new()
	_send_message_into(run, kind, channel_key, text)
	return run


func _refresh_into(run: Run) -> void:
	run.ok = await ChatCore.refresh_channels()
	run.done = true
	run.finished.emit()


func _older_into(run: Run, kind: CoreContract.ChatChannelKind, channel_key: int) -> void:
	run.ok = await ChatCore.load_older(kind, channel_key)
	run.done = true
	run.finished.emit()


func _send_message_into(run: Run, kind: CoreContract.ChatChannelKind, channel_key: int, text: String) -> void:
	run.result = await ChatCore.send_message(kind, channel_key, TEXT, text)
	run.ok = run.result.ok
	run.done = true
	run.finished.emit()


func wait_run(run: Run) -> bool:
	if not run.done:
		await run.finished
	return run.ok


# --- received requests ---


## The `GetChatMessages` requests the fake network received, in order.
func message_requests() -> Array[CoreContract.GetChatMessagesRequest]:
	var out: Array[CoreContract.GetChatMessagesRequest] = []
	for received: UnitTestRequest in UnitTestCore.received_requests():
		if received.name != GET_MESSAGES:
			continue
		var request: CoreContract.GetChatMessagesRequest = CoreContract.GetChatMessagesRequest.new()
		assert_true(request.decode(received.body), "GetChatMessages body decodes")
		out.append(request)
	return out


func last_message_request() -> CoreContract.GetChatMessagesRequest:
	var all: Array[CoreContract.GetChatMessagesRequest] = message_requests()
	if all.is_empty():
		return CoreContract.GetChatMessagesRequest.new()
	return all[all.size() - 1]


## Seqs of the cached messages of a channel, in cache order.
func cached_seqs(kind: CoreContract.ChatChannelKind, channel_key: int) -> PackedInt64Array:
	var out: PackedInt64Array = PackedInt64Array()
	for i: int in ChatCore.get_message_count(kind, channel_key):
		out.append(ChatCore.get_message(kind, channel_key, i).seq)
	return out


func saved_seqs() -> PackedStringArray:
	return LocalDataCore.get_array_string(LocalDataCore.FileKind.USER, READ_SEQS_KEY)


## Count of the item `item_key` under `[chat_badge]`.
func badge_item(item_key: int) -> int:
	return BadgeCore.get_item_count(ReservedId.chat_badge(), item_key)


## Error logs NetworkCore left for the failed requests.
func network_errors() -> int:
	return UnitTestCore.check_logs("error", "NetworkCore")


func chat_errors() -> int:
	return UnitTestCore.check_logs("error", "ChatCore")


func chat_warns() -> int:
	return UnitTestCore.check_logs("warn", "ChatCore")


# --- fake network results ---


func ok_bytes(response: ContractMessage = null) -> PackedByteArray:
	var env: CoreContract.ResponseEnvelope = CoreContract.ResponseEnvelope.new()
	env.server_time_at = SERVER_TIME
	if response != null:
		env.body = response.encode()
	return UnitTestCore.make_response(env)


func error_bytes(code: int) -> PackedByteArray:
	var env: CoreContract.ResponseEnvelope = CoreContract.ResponseEnvelope.new()
	env.server_time_at = SERVER_TIME
	env.error = CoreContract.ServerError.new()
	env.error.code = code
	env.error.detail = "detail of %d" % code
	return UnitTestCore.make_response(env)


func add_ok(request_name: String) -> void:
	UnitTestCore.add_result(request_name, NetworkCore.TransferResult.DONE, 200, ok_bytes())


func add_error(request_name: String, code: int) -> void:
	UnitTestCore.add_result(request_name, NetworkCore.TransferResult.DONE, 200, error_bytes(code))


## Count of the requests the fake network received: of `request_name`, or of every name when it is empty.
func request_count(request_name: String = "") -> int:
	var count: int = 0
	for received: UnitTestRequest in UnitTestCore.received_requests():
		if request_name.is_empty() or received.name == request_name:
			count += 1
	return count
