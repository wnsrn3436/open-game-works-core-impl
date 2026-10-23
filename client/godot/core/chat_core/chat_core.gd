class_name ChatCore
extends RefCounted
## Receives and caches the channel list and the messages of server core `chat`, and sends messages. Keeps a read seq
## for each channel and tells the unread counts through `BadgeCore`.
##
## Channel key of the operations: the channel number for `World`, 0 for `Guild`, the other user ID for `Direct`. The
## `channel_key` of a channel list entry is the channel ID of server core `chat`, so the `Guild` entry holds the
## guild ID.

## How the cache of a watched channel changed: `ChatMessagesChangedEvent.change`.
enum ChatMessagesChange { RESET, APPENDED, PREPENDED, REMOVED }

const _TAG: String = "ChatCore"
const _NODE := preload("res://core/chat_core/chat_core_node.gd")
const _WATCH := preload("res://core/chat_core/chat_watch.gd")
const _WAIT := preload("res://core/chat_core/chat_wait.gd")
const _CALL := preload("res://core/chat_core/chat_call.gd")

const _SETTING_MAX_WATCHED: String = "ChatCore.maxWatchedChannels"
const _SETTING_FAILURE_RETRY: String = "ChatCore.failureRetryMs"
const _KEY_READ_SEQS: String = "ChatCore.read_seqs"
const _KEY_READ_INITIALIZED: String = "ChatCore.read_initialized"
## Element names of the channel kinds that keep a read seq.
const _GUILD_NAME: String = "CHAT_CHANNEL_KIND_GUILD"
const _DIRECT_NAME: String = "CHAT_CHANNEL_KIND_DIRECT"
## Badge item key of the `Guild` channel.
const _GUILD_ITEM_KEY: int = -1
## Longest decimal text of a saved channel key or read seq that fits in `int`.
const _MAX_DECIMAL_CHARS: int = 18

static var _is_initialized: bool = false
## New object on every `init` and `release`: a coroutine or deferred call that sees another object stops.
static var _session: RefCounted = RefCounted.new()
static var _node: Node = null
static var _due_call: Callable = Callable()
static var _sync_call: Callable = Callable()
static var _due_queued: bool = false
static var _sync_queued: bool = false

static var _max_watched: int = 0
static var _failure_retry_ms: int = 0

static var _started: bool = false
## `GetChatChannels` failed with `CHILD_RESTRICTED`: nothing goes to the server until `release`.
static var _restricted: bool = false

## Channel list of the last `GetChatChannels` response.
static var _channels: Array[CoreContract.ChatChannelEntry] = []
## A `GetChatChannels` request is on the way.
static var _channels_busy: bool = false
## Real elapsed time at which the next channel list poll goes; -1 while one is on the way or before `start`.
static var _channels_due_at: int = -1
## Waits of the `refresh_channels` calls that share the request on the way.
static var _channel_waits: Array[_WAIT] = []

## Read seq by `<ChatChannelKind element name>:<channel ID>`.
static var _read_seqs: Dictionary[String, int] = {}
static var _read_initialized: bool = false
## Read seqs changed since the last save.
static var _read_dirty: bool = false
## Count of each item ChatCore set under `[chat_badge]`, by item key.
static var _badge_items: Dictionary[int, int] = {}
static var _badge_missing_logged: bool = false

## Watched channels by `<kind>:<channel key>`, and the same objects in watch order for the frame check.
static var _watches: Dictionary[String, _WATCH] = {}
static var _watch_list: Array[_WATCH] = []
## Waits of the `send_message` calls on the way.
static var _send_waits: Array[_WAIT] = []


# --- lifecycle ---


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init called while initialized")
		return false
	if not CoreSettings.has_int(_SETTING_MAX_WATCHED):
		LogCore.log_error(_TAG, "core setting %s is missing or has the wrong type" % _SETTING_MAX_WATCHED)
		return false
	if not CoreSettings.has_int(_SETTING_FAILURE_RETRY):
		LogCore.log_error(_TAG, "core setting %s is missing or has the wrong type" % _SETTING_FAILURE_RETRY)
		return false
	_max_watched = CoreSettings.get_int(_SETTING_MAX_WATCHED)
	_failure_retry_ms = CoreSettings.get_int(_SETTING_FAILURE_RETRY)
	_session = RefCounted.new()
	var node: _NODE = _NODE.new()
	node.name = "ChatCore"
	node.process_mode = Node.PROCESS_MODE_ALWAYS
	(Engine.get_main_loop() as SceneTree).root.add_child(node)
	if not EventCore.subscribe(AppForegroundReturnedEvent, node.on_foreground_returned):
		LogCore.log_error(_TAG, "init could not subscribe AppForegroundReturnedEvent")
		node.released = true
		node.get_parent().remove_child(node)
		node.queue_free()
		_reset_state()
		return false
	_node = node
	_due_call = ChatCore._run_due.bind(_session)
	_sync_call = ChatCore._run_sync.bind(_session)
	_is_initialized = true
	return true


static func release() -> void:
	if not _is_initialized:
		return
	_cleanup(true)


static func is_initialized() -> bool:
	return _is_initialized


static func _cleanup(remove_node: bool) -> void:
	var node: _NODE = _node as _NODE
	if _read_dirty and LocalDataCore.is_initialized():
		_save_read_seqs()
	_clear_badges()
	var waits: Array[_WAIT] = []
	waits.append_array(_channel_waits)
	waits.append_array(_send_waits)
	for w: _WATCH in _watch_list:
		waits.append_array(w.older_waits)
	_reset_state()
	if node != null and is_instance_valid(node):
		if EventCore.is_initialized():
			EventCore.unsubscribe_all(node)
		node.released = true
		if remove_node and node.get_parent() != null:
			node.get_parent().remove_child(node)
		node.queue_free()
	for wait: _WAIT in waits:
		wait.fire(false)


static func _reset_state() -> void:
	_is_initialized = false
	_session = RefCounted.new()
	_node = null
	_due_call = Callable()
	_sync_call = Callable()
	_due_queued = false
	_sync_queued = false
	_max_watched = 0
	_failure_retry_ms = 0
	_started = false
	_restricted = false
	_channels = []
	_channels_busy = false
	_channels_due_at = -1
	_channel_waits = []
	_read_seqs = {}
	_read_initialized = false
	_read_dirty = false
	_badge_items = {}
	_badge_missing_logged = false
	_watches = {}
	_watch_list = []
	_send_waits = []


static func _on_node_exit(node: Node) -> void:
	if _is_initialized and node == _node:
		_cleanup(false)


# --- operations ---


## Starts the channel list polling and the read seqs. `BootstrapCore` calls it in the `AfterLogin` stage.
static func start() -> void:
	if not _check_init("start"):
		return
	if _started:
		LogCore.log_warn(_TAG, "start called twice; ignored")
		return
	_started = true
	_load_read_seqs()
	_send_channels()


## Sends `GetChatChannels` now, or waits for the one on the way. `false` before `start`.
static func refresh_channels() -> bool:
	if not _check_init("refresh_channels"):
		return false
	if not _started or _restricted:
		return false
	var wait: _WAIT = _WAIT.new()
	_channel_waits.append(wait)
	if not _channels_busy:
		_send_channels()
	if not wait.fired:
		await wait.done
	return wait.ok


## Number of the entries of the last channel list.
static func get_channel_count() -> int:
	if not _check_init("get_channel_count"):
		return 0
	return _channels.size()


## Entry `index` of the last channel list. `null` for an index out of range.
static func get_channel(index: int) -> CoreContract.ChatChannelEntry:
	if not _check_init("get_channel"):
		return null
	if index < 0 or index >= _channels.size():
		LogCore.log_warn(_TAG, "get_channel: index %d is out of range of %d channels" % [index, _channels.size()])
		return null
	return _channels[index]


## max(0, `last_visible_seq` − read seq) of the channel list entry. 0 for a channel not in the list and for `World`.
static func get_unread_count(kind: CoreContract.ChatChannelKind, channel_key: int) -> int:
	if not _check_init("get_unread_count") or not _check_channel("get_unread_count", kind, channel_key):
		return 0
	var entry: CoreContract.ChatChannelEntry = _find_entry(kind, channel_key)
	if entry == null:
		return 0
	return _unread_of(entry)


## Raises the read seq to the larger of the list entry's `last_seq` and the largest cached seq.
static func mark_read(kind: CoreContract.ChatChannelKind, channel_key: int) -> void:
	if not _check_init("mark_read") or not _check_channel("mark_read", kind, channel_key):
		return
	if not _started or kind == CoreContract.ChatChannelKind.CHAT_CHANNEL_KIND_WORLD:
		return
	var seq: int = 0
	var channel_id: int = 0
	var entry: CoreContract.ChatChannelEntry = _find_entry(kind, channel_key)
	if entry != null:
		seq = entry.last_seq
		channel_id = entry.channel_key
	var w: _WATCH = _watch_of(kind, channel_key)
	if w != null:
		var watch_id: int = _watch_channel_id(w)
		if channel_id == 0:
			channel_id = watch_id
		# The cache counts only while it is of the same channel: a `Guild` cache may still be of the guild before.
		if watch_id == channel_id:
			seq = maxi(seq, w.max_seq())
	_raise_read(kind, channel_id, seq)


## Puts the channel in the watch list and sends its first request. `true` when it is watched already.
static func watch_channel(kind: CoreContract.ChatChannelKind, channel_key: int) -> bool:
	if not _check_init("watch_channel") or not _check_channel("watch_channel", kind, channel_key):
		return false
	if not _started:
		LogCore.log_error(_TAG, "watch_channel called before start")
		return false
	if _restricted:
		return false
	var id: String = _watch_id(kind, channel_key)
	if _watches.has(id):
		return true
	if _watch_list.size() >= _max_watched:
		LogCore.log_warn(_TAG, "watch_channel: %d channels are watched already" % _watch_list.size())
		return false
	var w: _WATCH = _WATCH.new()
	w.kind = kind
	w.key = channel_key
	_watches[id] = w
	_watch_list.append(w)
	_send_poll(w)
	return true


## Takes the channel out of the watch list and drops its cache and cursors. Results of its requests on the way are
## dropped without an event.
static func unwatch_channel(kind: CoreContract.ChatChannelKind, channel_key: int) -> void:
	if not _check_init("unwatch_channel") or not _check_channel("unwatch_channel", kind, channel_key):
		return
	var id: String = _watch_id(kind, channel_key)
	if not _watches.has(id):
		return
	var w: _WATCH = _watches[id]
	_watches.erase(id)
	_watch_list.erase(w)
	w.reset()
	var waits: Array[_WAIT] = w.older_waits
	w.older_waits = []
	for wait: _WAIT in waits:
		wait.fire(false)


## Number of the cached messages of a watched channel. 0 for a channel that is not watched.
static func get_message_count(kind: CoreContract.ChatChannelKind, channel_key: int) -> int:
	if not _check_init("get_message_count") or not _check_channel("get_message_count", kind, channel_key):
		return 0
	var w: _WATCH = _watch_of(kind, channel_key)
	return w.messages.size() if w != null else 0


## Cached message `index` of a watched channel, in ascending seq from 0. `null` on failure.
static func get_message(kind: CoreContract.ChatChannelKind, channel_key: int, index: int) -> CoreContract.ChatMessage:
	if not _check_init("get_message") or not _check_channel("get_message", kind, channel_key):
		return null
	var w: _WATCH = _watch_of(kind, channel_key)
	if w == null:
		LogCore.log_warn(_TAG, "get_message: channel %s is not watched" % _watch_id(kind, channel_key))
		return null
	if index < 0 or index >= w.messages.size():
		LogCore.log_warn(_TAG, "get_message: index %d is out of range of %d messages" % [index, w.messages.size()])
		return null
	return w.messages[index]


## Whether the channel is watched and older messages can be loaded: the old message cursor is above 1.
static func has_older(kind: CoreContract.ChatChannelKind, channel_key: int) -> bool:
	if not _check_init("has_older") or not _check_channel("has_older", kind, channel_key):
		return false
	var w: _WATCH = _watch_of(kind, channel_key)
	return w != null and w.old_cursor > 1


## Loads the messages before the cache of a watched channel, or waits for the `load_older` on the way. `true` without
## a request when `has_older` is false.
static func load_older(kind: CoreContract.ChatChannelKind, channel_key: int) -> bool:
	if not _check_init("load_older") or not _check_channel("load_older", kind, channel_key):
		return false
	if _restricted:
		return false
	var w: _WATCH = _watch_of(kind, channel_key)
	if w == null:
		LogCore.log_warn(_TAG, "load_older: channel %s is not watched" % _watch_id(kind, channel_key))
		return false
	if w.old_cursor <= 1:
		return true
	var wait: _WAIT = _WAIT.new()
	w.older_waits.append(wait)
	if not w.older_busy:
		_send_older(w)
	if not wait.fired:
		await wait.done
	return wait.ok


## Sends `SendChatMessage`. The sent message comes into the cache through the poll of a watched channel.
static func send_message(kind: CoreContract.ChatChannelKind, channel_key: int, message_kind: CoreContract.ChatMessageKind, text: String) -> ChatSendResult:
	if not _check_init("send_message") or not _check_channel("send_message", kind, channel_key):
		return ChatSendResult.new()
	if not _is_message_kind(message_kind):
		LogCore.log_error(_TAG, "send_message: message kind %d is not a ChatMessageKind" % message_kind)
		return ChatSendResult.new()
	if not _started:
		LogCore.log_error(_TAG, "send_message called before start")
		return ChatSendResult.new()
	if _restricted:
		var restricted: ChatSendResult = ChatSendResult.new()
		restricted.error_code = CoreContract.CoreError.CORE_ERROR_CHILD_RESTRICTED
		return restricted
	var request: CoreContract.SendChatMessageRequest = CoreContract.SendChatMessageRequest.new()
	request.channel_kind = kind
	request.channel_key = channel_key
	request.message_kind = message_kind
	request.text = text
	var wait: _WAIT = _WAIT.new()
	_send_waits.append(wait)
	_run_send(wait, request)
	if not wait.fired:
		await wait.done
	if wait.result == null:
		return ChatSendResult.new()
	return wait.result


# --- channel list ---


static func _send_channels() -> void:
	var session: RefCounted = _session
	_channels_busy = true
	_channels_due_at = -1
	var call: _CALL = _CALL.new()
	var sent: bool = await NetworkCore.send(CoreContract.GetChatChannelsRequest.new(), call.on_success, call.on_failure)
	if session != _session:
		return
	_channels_busy = false
	# Taken before the event: a `refresh_channels` of an event subscriber waits for the request it sends.
	var waits: Array[_WAIT] = _channel_waits
	_channel_waits = []
	var ok: bool = false
	var now: int = TimeCore.get_real_time()
	if sent and call.response is CoreContract.GetChatChannelsResponse:
		var response: CoreContract.GetChatChannelsResponse = call.response as CoreContract.GetChatChannelsResponse
		_channels_due_at = now + maxi(0, response.poll_after_ms)
		_take_channels(response.channels)
		ok = session == _session
	elif call.error_code == CoreContract.CoreError.CORE_ERROR_CHILD_RESTRICTED:
		_restrict()
	else:
		_channels_due_at = now + _failure_retry_ms
	_fire_waits(waits, ok)


static func _fire_waits(waits: Array[_WAIT], ok: bool) -> void:
	for wait: _WAIT in waits:
		wait.fire(ok)


static func _take_channels(channels: Array[CoreContract.ChatChannelEntry]) -> void:
	var changed: bool = channels.size() != _channels.size()
	if not changed:
		for i: int in channels.size():
			if not _same_entry(channels[i], _channels[i]):
				changed = true
				break
	_channels = channels
	_reconcile_read_seqs()
	_queue_sync()
	if changed:
		_publish_channels_changed()


static func _same_entry(a: CoreContract.ChatChannelEntry, b: CoreContract.ChatChannelEntry) -> bool:
	if a == null or b == null:
		return a == b
	return a.encode() == b.encode()


## `GetChatChannels` failed with `CHILD_RESTRICTED`: stops every polling until `release`. Read seqs stay.
static func _restrict() -> void:
	_restricted = true
	_channels_due_at = -1
	for w: _WATCH in _watch_list:
		w.due_at = -1
	var had: bool = not _channels.is_empty()
	_channels = []
	_queue_sync()
	if had:
		_publish_channels_changed()


static func _publish_channels_changed() -> void:
	var event: ChatChannelsChangedEvent = EventCore.acquire(ChatChannelsChangedEvent) as ChatChannelsChangedEvent
	if event == null:
		return
	EventCore.publish(event)


static func _find_entry(kind: CoreContract.ChatChannelKind, channel_key: int) -> CoreContract.ChatChannelEntry:
	for entry: CoreContract.ChatChannelEntry in _channels:
		if entry == null or entry.channel_kind != kind:
			continue
		if kind == CoreContract.ChatChannelKind.CHAT_CHANNEL_KIND_GUILD or entry.channel_key == channel_key:
			return entry
	return null


# --- read seq and badge ---


static func _kind_name(kind: CoreContract.ChatChannelKind) -> String:
	if kind == CoreContract.ChatChannelKind.CHAT_CHANNEL_KIND_GUILD:
		return _GUILD_NAME
	if kind == CoreContract.ChatChannelKind.CHAT_CHANNEL_KIND_DIRECT:
		return _DIRECT_NAME
	return ""


## Read seq key of a channel ID. Empty for `World` and for a channel ID below 1.
static func _read_key(kind: CoreContract.ChatChannelKind, channel_id: int) -> String:
	var kind_name: String = _kind_name(kind)
	if kind_name.is_empty() or channel_id < 1:
		return ""
	return "%s:%d" % [kind_name, channel_id]


static func _unread_of(entry: CoreContract.ChatChannelEntry) -> int:
	var key: String = _read_key(entry.channel_kind, entry.channel_key)
	if key.is_empty():
		return 0
	var read: int = _read_seqs[key] if _read_seqs.has(key) else 0
	return maxi(0, entry.last_visible_seq - read)


## Raises a read seq. A read seq does not go down.
static func _raise_read(kind: CoreContract.ChatChannelKind, channel_id: int, seq: int) -> void:
	var key: String = _read_key(kind, channel_id)
	if key.is_empty() or seq < 0:
		return
	if _read_seqs.has(key) and _read_seqs[key] >= seq:
		return
	_read_seqs[key] = seq
	_read_dirty = true
	_queue_sync()


## Matches the read seqs to the channel list just received.
static func _reconcile_read_seqs() -> void:
	if not _read_initialized:
		for entry: CoreContract.ChatChannelEntry in _channels:
			var first_key: String = _read_key(entry.channel_kind, entry.channel_key)
			if first_key.is_empty():
				continue
			var seq: int = entry.last_seq
			if _read_seqs.has(first_key):
				seq = maxi(seq, _read_seqs[first_key])
			_read_seqs[first_key] = seq
		_read_initialized = true
		LocalDataCore.set_value_bool(LocalDataCore.FileKind.USER, _KEY_READ_INITIALIZED, true)
		_read_dirty = true
	# A channel out of the list keeps its read seq: the server may list it again.
	for entry: CoreContract.ChatChannelEntry in _channels:
		var key: String = _read_key(entry.channel_kind, entry.channel_key)
		if key.is_empty() or _read_seqs.has(key):
			continue
		var guild: bool = entry.channel_kind == CoreContract.ChatChannelKind.CHAT_CHANNEL_KIND_GUILD
		_read_seqs[key] = entry.last_seq if guild else 0
		_read_dirty = true


static func _load_read_seqs() -> void:
	_read_initialized = LocalDataCore.get_value_bool(LocalDataCore.FileKind.USER, _KEY_READ_INITIALIZED, false)
	for text: String in LocalDataCore.get_array_string(LocalDataCore.FileKind.USER, _KEY_READ_SEQS):
		if not _parse_read_seq(text):
			LogCore.log_warn(_TAG, "read_seqs element %s is malformed; dropped" % text)
			_read_dirty = true
	if _read_dirty:
		_queue_sync()


## Reads one `<ChatChannelKind element name>:<channel key>=<read seq>` element into the read seqs.
static func _parse_read_seq(text: String) -> bool:
	var colon: int = text.find(":")
	var equals: int = text.find("=")
	if colon < 1 or equals < colon + 2:
		return false
	var kind_name: String = text.substr(0, colon)
	if kind_name != _GUILD_NAME and kind_name != _DIRECT_NAME:
		return false
	var id_text: String = text.substr(colon + 1, equals - colon - 1)
	var seq_text: String = text.substr(equals + 1)
	if not _is_decimal(id_text) or not _is_decimal(seq_text):
		return false
	var channel_id: int = id_text.to_int()
	if channel_id < 1:
		return false
	var key: String = "%s:%d" % [kind_name, channel_id]
	var seq: int = seq_text.to_int()
	if _read_seqs.has(key):
		seq = maxi(seq, _read_seqs[key])
	_read_seqs[key] = seq
	return true


static func _is_decimal(text: String) -> bool:
	if text.is_empty() or text.length() > _MAX_DECIMAL_CHARS:
		return false
	for i: int in text.length():
		var code: int = text.unicode_at(i)
		if code < 48 or code > 57:
			return false
	return true


static func _save_read_seqs() -> void:
	_read_dirty = false
	var out: PackedStringArray = PackedStringArray()
	for key: String in _read_seqs:
		out.append("%s=%d" % [key, _read_seqs[key]])
	LocalDataCore.set_array_string(LocalDataCore.FileKind.USER, _KEY_READ_SEQS, out)


static func _queue_sync() -> void:
	if _sync_queued or not _is_initialized:
		return
	_sync_queued = true
	_sync_call.call_deferred()


## The frame end part of a read seq or channel list change: saves the read seqs and sets the badge items.
static func _run_sync(session: RefCounted) -> void:
	if session != _session:
		return
	_sync_queued = false
	if _read_dirty:
		_save_read_seqs()
	_sync_badges()


static func _sync_badges() -> void:
	var badge: int = ReservedId.chat_badge()
	if not GameData.BadgeTable.has_row(badge):
		if not _badge_missing_logged:
			_badge_missing_logged = true
			LogCore.log_error(_TAG, "[chat_badge] is not a row of the badge table; no chat badge")
		return
	var wanted: Dictionary[int, int] = {}
	for entry: CoreContract.ChatChannelEntry in _channels:
		var count: int = _unread_of(entry)
		if count < 1:
			continue
		if entry.channel_kind == CoreContract.ChatChannelKind.CHAT_CHANNEL_KIND_GUILD:
			wanted[_GUILD_ITEM_KEY] = count
		elif entry.channel_kind == CoreContract.ChatChannelKind.CHAT_CHANNEL_KIND_DIRECT:
			wanted[entry.channel_key] = count
	for item: int in _badge_items:
		if not wanted.has(item):
			BadgeCore.clear_item(badge, item)
	for item: int in wanted:
		if not _badge_items.has(item) or _badge_items[item] != wanted[item]:
			BadgeCore.set_item(badge, item, wanted[item])
	_badge_items = wanted


## `release`: takes the items ChatCore set off `[chat_badge]`.
static func _clear_badges() -> void:
	if _badge_items.is_empty() or not BadgeCore.is_initialized():
		return
	var badge: int = ReservedId.chat_badge()
	for item: int in _badge_items:
		BadgeCore.clear_item(badge, item)


# --- watch ---


static func _watch_id(kind: int, channel_key: int) -> String:
	return "%d:%d" % [kind, channel_key]


static func _watch_of(kind: CoreContract.ChatChannelKind, channel_key: int) -> _WATCH:
	var id: String = _watch_id(kind, channel_key)
	if not _watches.has(id):
		return null
	return _watches[id]


static func _is_watched(w: _WATCH) -> bool:
	var id: String = _watch_id(w.kind, w.key)
	return _watches.has(id) and _watches[id] == w


## Channel ID of a watched channel for its read seq: the guild ID of the last response for `Guild`.
static func _watch_channel_id(w: _WATCH) -> int:
	if w.kind == CoreContract.ChatChannelKind.CHAT_CHANNEL_KIND_GUILD:
		return w.guild_id
	if w.kind == CoreContract.ChatChannelKind.CHAT_CHANNEL_KIND_DIRECT:
		return w.key
	return 0


## Sends the first request or the next poll of a watched channel.
static func _send_poll(w: _WATCH) -> void:
	var session: RefCounted = _session
	var epoch: int = w.epoch
	var first: bool = not w.first_done
	w.busy = true
	w.due_at = -1
	w.kick = false
	var request: CoreContract.GetChatMessagesRequest = CoreContract.GetChatMessagesRequest.new()
	request.channel_kind = w.kind
	request.channel_key = w.key
	if not first:
		request.after_seq = w.new_cursor
		request.after_delete_seq = w.delete_cursor
	var call: _CALL = _CALL.new()
	var sent: bool = await NetworkCore.send(request, call.on_success, call.on_failure)
	if session != _session or not _is_watched(w):
		return
	w.busy = false
	var now: int = TimeCore.get_real_time()
	if epoch != w.epoch:
		# The cache went back to the start while the request was on the way.
		w.due_at = now + _failure_retry_ms
	elif sent and call.response is CoreContract.GetChatMessagesResponse:
		var response: CoreContract.GetChatMessagesResponse = call.response as CoreContract.GetChatMessagesResponse
		w.due_at = now + maxi(0, response.poll_after_ms)
		if first:
			_apply_first(w, response)
		else:
			_apply_poll(w, response)
	else:
		w.due_at = now + _failure_retry_ms
		_check_not_member(w, call.error_code)
	if _is_watched(w) and not w.busy and w.kick:
		w.kick = false
		w.due_at = now
		_queue_due()


static func _apply_first(w: _WATCH, response: CoreContract.GetChatMessagesResponse) -> void:
	w.messages = _sorted_messages(response.messages, 0, 0)
	w.new_cursor = response.last_seq
	w.old_cursor = response.first_seq
	w.delete_cursor = response.last_delete_seq
	if w.kind == CoreContract.ChatChannelKind.CHAT_CHANNEL_KIND_GUILD:
		w.guild_id = response.channel_key
	w.first_done = true
	_raise_from_cache(w)
	_publish_messages(w, ChatMessagesChange.RESET, w.messages.size())


static func _apply_poll(w: _WATCH, response: CoreContract.GetChatMessagesResponse) -> void:
	if w.kind == CoreContract.ChatChannelKind.CHAT_CHANNEL_KIND_GUILD and response.channel_key != w.guild_id:
		w.reset()
		_publish_messages(w, ChatMessagesChange.RESET, 0)
		if _is_watched(w) and not w.busy and not _restricted:
			_send_poll(w)
		return
	var removed: int = 0
	if not response.deleted_seqs.is_empty():
		var kept: Array[CoreContract.ChatMessage] = []
		for message: CoreContract.ChatMessage in w.messages:
			if response.deleted_seqs.has(message.seq):
				removed += 1
			else:
				kept.append(message)
		w.messages = kept
	if removed > 0:
		_publish_messages(w, ChatMessagesChange.REMOVED, removed)
		if not _is_watched(w):
			return
	var added: Array[CoreContract.ChatMessage] = _sorted_messages(response.messages, w.max_seq(), 0)
	if not added.is_empty():
		w.messages.append_array(added)
		_raise_from_cache(w)
		_publish_messages(w, ChatMessagesChange.APPENDED, added.size())
		if not _is_watched(w):
			return
	if w.new_cursor == 0:
		w.old_cursor = response.first_seq
	w.new_cursor = response.last_seq
	w.delete_cursor = response.last_delete_seq


## A `Guild` request ended with `GUILD_NOT_MEMBER`: the cache and cursors go back to the start.
static func _check_not_member(w: _WATCH, error_code: int) -> void:
	if w.kind != CoreContract.ChatChannelKind.CHAT_CHANNEL_KIND_GUILD:
		return
	if error_code != CoreContract.CoreError.CORE_ERROR_GUILD_NOT_MEMBER:
		return
	var had: bool = not w.messages.is_empty()
	w.reset()
	if had:
		_publish_messages(w, ChatMessagesChange.RESET, 0)


static func _raise_from_cache(w: _WATCH) -> void:
	if w.messages.is_empty():
		return
	_raise_read(w.kind, _watch_channel_id(w), w.max_seq())


static func _send_older(w: _WATCH) -> void:
	var session: RefCounted = _session
	var epoch: int = w.epoch
	w.older_busy = true
	var request: CoreContract.GetChatMessagesRequest = CoreContract.GetChatMessagesRequest.new()
	request.channel_kind = w.kind
	request.channel_key = w.key
	request.before_seq = w.old_cursor
	var call: _CALL = _CALL.new()
	var sent: bool = await NetworkCore.send(request, call.on_success, call.on_failure)
	if session != _session or not _is_watched(w):
		return
	w.older_busy = false
	# Taken before the event: a `load_older` of an event subscriber waits for the request it sends.
	var waits: Array[_WAIT] = w.older_waits
	w.older_waits = []
	var ok: bool = false
	if epoch != w.epoch:
		ok = false
	elif sent and call.response is CoreContract.GetChatMessagesResponse:
		ok = _apply_older(w, call.response as CoreContract.GetChatMessagesResponse)
	else:
		_check_not_member(w, call.error_code)
	# A `release` or `unwatch_channel` of an event subscriber ends the operation with a failure.
	_fire_waits(waits, ok and session == _session and _is_watched(w))


static func _apply_older(w: _WATCH, response: CoreContract.GetChatMessagesResponse) -> bool:
	if w.kind == CoreContract.ChatChannelKind.CHAT_CHANNEL_KIND_GUILD and response.channel_key != w.guild_id:
		return false
	var bound: int = w.min_seq() if not w.messages.is_empty() else w.old_cursor
	var older: Array[CoreContract.ChatMessage] = _sorted_messages(response.messages, 0, bound)
	older.append_array(w.messages)
	var added: int = older.size() - w.messages.size()
	w.messages = older
	w.old_cursor = response.first_seq
	if added > 0:
		_publish_messages(w, ChatMessagesChange.PREPENDED, added)
	return true


## Messages of `source` with `above` < seq (and seq < `below` when `below` is above 0), one per seq, in ascending seq.
static func _sorted_messages(source: Array[CoreContract.ChatMessage], above: int, below: int) -> Array[CoreContract.ChatMessage]:
	var picked: Array[CoreContract.ChatMessage] = []
	for message: CoreContract.ChatMessage in source:
		if message == null or message.seq <= above or (below > 0 and message.seq >= below):
			continue
		picked.append(message)
	picked.sort_custom(ChatCore._seq_less)
	var out: Array[CoreContract.ChatMessage] = []
	for message: CoreContract.ChatMessage in picked:
		if out.is_empty() or out[out.size() - 1].seq != message.seq:
			out.append(message)
	return out


static func _seq_less(a: CoreContract.ChatMessage, b: CoreContract.ChatMessage) -> bool:
	return a.seq < b.seq


static func _publish_messages(w: _WATCH, change: ChatMessagesChange, count: int) -> void:
	var event: ChatMessagesChangedEvent = EventCore.acquire(ChatMessagesChangedEvent) as ChatMessagesChangedEvent
	if event == null:
		return
	event.channel_kind = w.kind
	event.channel_key = w.key
	event.change = change
	event.count = count
	EventCore.publish(event)


# --- send ---


static func _run_send(wait: _WAIT, request: CoreContract.SendChatMessageRequest) -> void:
	var session: RefCounted = _session
	var call: _CALL = _CALL.new()
	var sent: bool = await NetworkCore.send(request, call.on_success, call.on_failure)
	if session != _session:
		return
	_send_waits.erase(wait)
	var result: ChatSendResult = ChatSendResult.new()
	if sent and call.response is CoreContract.SendChatMessageResponse:
		var response: CoreContract.SendChatMessageResponse = call.response as CoreContract.SendChatMessageResponse
		result.ok = true
		result.message = response.message
		_on_sent(request, response.message)
	else:
		result.error_code = call.error_code
	wait.result = result
	wait.fire(result.ok)


## `send_message` succeeded: raises the read seq, and polls the channel now when it is watched.
static func _on_sent(request: CoreContract.SendChatMessageRequest, message: CoreContract.ChatMessage) -> void:
	var w: _WATCH = _watch_of(request.channel_kind, request.channel_key)
	if message != null:
		var channel_id: int = request.channel_key
		if request.channel_kind == CoreContract.ChatChannelKind.CHAT_CHANNEL_KIND_GUILD:
			channel_id = message.channel_key
		_raise_read(request.channel_kind, channel_id, message.seq)
	if w == null or _restricted:
		return
	if w.busy:
		w.kick = true
	else:
		w.due_at = TimeCore.get_real_time()
		_queue_due()


# --- polling timers ---


## Frame check of the polling timers. Frame code: it only reads and queues the deferred part.
static func _on_frame() -> void:
	if not _is_initialized or not _started or _restricted or _due_queued:
		return
	var now: int = TimeCore.get_real_time()
	var due: bool = not _channels_busy and _channels_due_at >= 0 and now >= _channels_due_at
	if not due:
		for w: _WATCH in _watch_list:
			if not w.busy and w.due_at >= 0 and now >= w.due_at:
				due = true
				break
	if due:
		_due_queued = true
		_due_call.call_deferred()


static func _queue_due() -> void:
	if _due_queued or not _is_initialized:
		return
	_due_queued = true
	_due_call.call_deferred()


## The deferred part of the frame check: sends the channel list poll and the message polls that are due.
static func _run_due(session: RefCounted) -> void:
	if session != _session:
		return
	_due_queued = false
	if not _started or _restricted:
		return
	var now: int = TimeCore.get_real_time()
	if not _channels_busy and _channels_due_at >= 0 and now >= _channels_due_at:
		_send_channels()
	for w: _WATCH in _watch_list.duplicate():
		if _is_watched(w) and not w.busy and w.due_at >= 0 and now >= w.due_at:
			_send_poll(w)


## The app returned from the background: the channel list and every watched channel send now.
static func _on_foreground_returned() -> void:
	if not _is_initialized or not _started or _restricted:
		return
	var now: int = TimeCore.get_real_time()
	if not _channels_busy:
		_channels_due_at = now
	for w: _WATCH in _watch_list:
		if not w.busy:
			w.due_at = now
	_queue_due()


# --- checks ---


static func _check_init(operation: String) -> bool:
	if _is_initialized:
		return true
	LogCore.log_error(_TAG, "%s called before init" % operation)
	return false


## Whether the channel key fits the kind: `World` 1 or more, `Guild` 0, `Direct` 1 or more.
static func _check_channel(operation: String, kind: int, channel_key: int) -> bool:
	var ok: bool = false
	match kind:
		CoreContract.ChatChannelKind.CHAT_CHANNEL_KIND_WORLD:
			ok = channel_key >= 1
		CoreContract.ChatChannelKind.CHAT_CHANNEL_KIND_GUILD:
			ok = channel_key == 0
		CoreContract.ChatChannelKind.CHAT_CHANNEL_KIND_DIRECT:
			ok = channel_key >= 1
	if not ok:
		LogCore.log_error(_TAG, "%s: channel kind %d does not take channel key %d" % [operation, kind, channel_key])
	return ok


static func _is_message_kind(message_kind: int) -> bool:
	return message_kind == CoreContract.ChatMessageKind.CHAT_MESSAGE_KIND_TEXT \
		or message_kind == CoreContract.ChatMessageKind.CHAT_MESSAGE_KIND_ROOM_INVITE \
		or message_kind == CoreContract.ChatMessageKind.CHAT_MESSAGE_KIND_SYSTEM
