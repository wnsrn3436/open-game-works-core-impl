class_name SoundCore
extends RefCounted
## Bus volume and mute, BGM changes, sound effect playback with concurrency limits, pause and haptic patterns.

## Sound bus. The engine bus name is the element name.
enum SoundBus { MASTER, BGM, SFX, VOICE, UI }
## Haptic target of a `play_haptic` request.
enum HapticTarget { DEVICE, GAMEPAD }

## Play handle that points at no request.
const INVALID_HANDLE: int = 0
## Pause token that points at no pause reason.
const INVALID_PAUSE_TOKEN: int = 0

const _TAG: String = "SoundCore"
const _NODE := preload("res://core/sound_core/sound_core_node.gd")
const _BGM_RECORD := preload("res://core/sound_core/sound_bgm_record.gd")
const _BGM_CHANNEL := preload("res://core/sound_core/sound_bgm_channel.gd")
const _BGM_REQUEST := preload("res://core/sound_core/sound_bgm_request.gd")
const _SFX_REQUEST := preload("res://core/sound_core/sound_sfx_request.gd")
const _HAPTIC_PATTERN := preload("res://core/sound_core/sound_haptic_pattern.gd")

const _BUS_NAMES: Array[StringName] = [&"Master", &"Bgm", &"Sfx", &"Voice", &"Ui"]
const _VOLUME_KEYS: PackedStringArray = [
	"SoundCore.master_volume", "SoundCore.bgm_volume", "SoundCore.sfx_volume", "SoundCore.voice_volume",
	"SoundCore.ui_volume",
]
const _MUTE_KEYS: PackedStringArray = [
	"SoundCore.master_mute", "SoundCore.bgm_mute", "SoundCore.sfx_mute", "SoundCore.voice_mute",
	"SoundCore.ui_mute",
]
const _HAPTIC_ENABLED_KEY: String = "SoundCore.haptic_enabled"
const _SETTING_CROSSFADE: String = "SoundCore.bgmCrossfadeMs"
const _SETTING_MAX_CONCURRENT: String = "SoundCore.maxConcurrent"
const _SETTING_MAX_PER_KEY: String = "SoundCore.maxConcurrentPerKey"
const _SETTING_PEAK: String = "SoundCore.masterPeakMaxDbtp"
const _SETTING_MARGIN: String = "SoundCore.masterLimiterMarginDb"
const _SETTING_LOUDNESS: String = "SoundCore.busLoudnessLufs"
const _SETTING_BUS_PEAK: String = "SoundCore.busPeakMaxDbtp"
const _SETTING_HAPTIC_LOG: String = "SoundCore.devHapticLogCount"
const _VARIANT_PURPOSE: String = "sound_variant"
const _POSITIONAL_GROUP: StringName = &"ogw_positional_sound"
const _HAPTIC_PLATFORMS: PackedStringArray = ["android", "ios"]
const _HAPTIC_SEGMENT_KEYS: PackedStringArray = ["delay_ms", "duration_ms", "intensity"]
## Engine bus and player volume of a silent volume 0.
const _SILENT_DB: float = -80.0
const _CHANNEL_COUNT: int = 2

static var _is_initialized: bool = false
## New object on every `init` and `release`: a coroutine or deferred call that sees another object stops.
static var _session: RefCounted = RefCounted.new()
static var _node: _NODE = null

static var _crossfade_ms: int = 0
static var _max_concurrent: int = 0
static var _max_per_key: int = 0
static var _haptic_log_count: int = 0

## Volume and mute by `SoundBus`.
static var _volumes: PackedFloat64Array = PackedFloat64Array([1.0, 1.0, 1.0, 1.0, 1.0])
static var _mutes: Array[bool] = [false, false, false, false, false]
static var _haptic_enabled: bool = true
## Engine buses `init` added. `release` removes them.
static var _created_buses: PackedStringArray = PackedStringArray()
static var _limiter: AudioEffectHardLimiter = null
static var _scope_listener: Callable = Callable()
static var _positional_pause_call: Callable = Callable()
static var _settle_call: Callable = Callable()
static var _load_call: Callable = Callable()
## A deferred `_on_deferred_load` is queued.
static var _load_queued: bool = false

## BGM.
static var _channels: Array[_BGM_CHANNEL] = []
static var _current: _BGM_RECORD = null
static var _previous: _BGM_RECORD = null
static var _bgm_request: _BGM_REQUEST = null
## Records with a BGM scope that has not ended.
static var _owned_records: Array[_BGM_RECORD] = []
static var _bgm_owner_count: int = 0
static var _settling: bool = false
static var _settle_queued: bool = false

## Sound effects: one slot per sfx player. A slot with handle `INVALID_HANDLE` is an empty player.
static var _players: Array[AudioStreamPlayer] = []
static var _slot_handles: PackedInt64Array = PackedInt64Array()
static var _slot_keys: PackedStringArray = PackedStringArray()
static var _slot_buses: PackedInt32Array = PackedInt32Array()
static var _slot_priorities: PackedInt64Array = PackedInt64Array()
static var _slot_orders: PackedInt64Array = PackedInt64Array()
static var _slot_scopes: Array[Scope] = []
## Sound length by slot, 0 for a loop sound or a sound the engine gives no length: such a play ends only when the engine
## ends it or when it is stopped.
static var _slot_lengths_ms: PackedInt64Array = PackedInt64Array()
## Real elapsed time by slot that the play spent outside pause.
static var _slot_played_ms: PackedInt64Array = PackedInt64Array()
## Real elapsed time up to which `_slot_played_ms` is counted.
static var _played_at: int = 0
static var _start_order: int = 0
static var _next_handle: int = 0
## `play` requests whose sound is loading.
static var _pending: Array[_SFX_REQUEST] = []
static var _variant_random: UtilRandom = null
## Variant of the last play by resource key, for keys with two or more variants.
static var _last_variants: Dictionary[String, int] = {}

## Pause.
static var _game_paused: bool = false
static var _focus_lost: bool = false
static var _backgrounded: bool = false
static var _pause_tokens: PackedInt64Array = PackedInt64Array()
static var _next_pause_token: int = 0
static var _global_paused: bool = false
static var _positional_pause_queued: bool = false
static var _last_real_time: int = 0

## Haptic.
static var _haptic_kind: int = -1
static var _haptic_fallback: JSON = null
static var _haptic_patterns: Dictionary[String, _HAPTIC_PATTERN] = {}
static var _haptic_pattern: _HAPTIC_PATTERN = null
static var _haptic_target: HapticTarget = HapticTarget.DEVICE
static var _haptic_gamepad: int = -1
## Segment `_haptic_pattern` plays now or waits for, and the end of the segments of the playing variant.
static var _haptic_segment: int = 0
static var _haptic_segment_end: int = 0
## Real elapsed time the delay of `_haptic_segment` counts from until it vibrates, then the end of its vibration.
static var _haptic_wait_from: int = 0
static var _haptic_vibrated: bool = false
## Ring of the latest `play_haptic` requests. Only a build with DEV code keeps it.
static var _haptic_log_keys: PackedStringArray = PackedStringArray()
static var _haptic_log_played: Array[bool] = []
static var _haptic_log_targets: PackedInt32Array = PackedInt32Array()
static var _haptic_log_next: int = 0
static var _haptic_log_size: int = 0


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init of an initialized module")
		return false
	if not _read_settings():
		return false
	var fallback: JSON = JSON.new()
	if fallback.parse("{\"segments\": []}") != OK:
		LogCore.log_error(_TAG, "init could not make the haptic fallback")
		return false
	var kind: int = ResourceCore.register_kind(JSON, fallback)
	if kind == ResourceCore.INVALID_KIND:
		LogCore.log_error(_TAG, "init could not register the haptic kind")
		return false
	var node: _NODE = _NODE.new()
	node.name = "SoundCore"
	(Engine.get_main_loop() as SceneTree).root.add_child(node)
	var subscribed: bool = (
		EventCore.subscribe(AppBackgroundEnteredEvent, node._on_app_background_entered)
		and EventCore.subscribe(AppForegroundReturnedEvent, node._on_app_foreground_returned)
	)
	if not subscribed or not node.connect_tree():
		LogCore.log_error(_TAG, "init could not subscribe to the background events or the tree")
		EventCore.unsubscribe_all(node)
		node.disconnect_tree()
		node.get_parent().remove_child(node)
		node.free()
		return false
	_node = node
	_session = RefCounted.new()
	_haptic_kind = kind
	_haptic_fallback = fallback
	_scope_listener = SoundCore._on_scope_released
	_positional_pause_call = node._on_deferred_positional_pause
	_settle_call = node._on_deferred_settle
	_load_call = node._on_deferred_load
	ResourceCore.add_scope_release_listener(_scope_listener)
	_make_players(node)
	_setup_buses()
	if CoreBuildInfo.has_dev_code:
		_haptic_log_keys.resize(_haptic_log_count)
		_haptic_log_played.resize(_haptic_log_count)
		_haptic_log_targets.resize(_haptic_log_count)
	var seed_value: int = UtilCore.make_purpose_seed(_VARIANT_PURPOSE, TimeCore.get_device_time())
	_variant_random = UtilCore.create_random(seed_value)
	LogCore.log_debug(_TAG, "random " + _VARIANT_PURPOSE + " seed " + str(seed_value))
	_game_paused = TimeCore.is_paused()
	_last_real_time = TimeCore.get_real_time()
	_played_at = _last_real_time
	_is_initialized = true
	return true


static func release() -> void:
	if not _is_initialized:
		return
	_cleanup(true)


static func is_initialized() -> bool:
	return _is_initialized


static func load_volume_settings() -> void:
	if not _check_initialized("load_volume_settings"):
		return
	for bus: int in _BUS_NAMES.size():
		var volume: float = LocalDataCore.get_value_float(LocalDataCore.FileKind.DEVICE, _VOLUME_KEYS[bus], 1.0)
		if is_nan(volume) or volume < 0.0 or volume > 1.0:
			volume = 1.0
		_volumes[bus] = volume
		_mutes[bus] = LocalDataCore.get_value_bool(LocalDataCore.FileKind.DEVICE, _MUTE_KEYS[bus], false)
		_apply_bus(bus)
	_haptic_enabled = LocalDataCore.get_value_bool(LocalDataCore.FileKind.DEVICE, _HAPTIC_ENABLED_KEY, true)


static func set_volume(bus: SoundBus, volume: float) -> void:
	if not _check_initialized("set_volume"):
		return
	if not _is_bus(bus):
		LogCore.log_error(_TAG, "set_volume got a bus that is not a SoundBus element")
		return
	var value: float = volume
	if is_nan(volume):
		LogCore.log_error(_TAG, "set_volume got NaN and applies 1")
		value = 1.0
	elif volume < 0.0:
		LogCore.log_error(_TAG, "set_volume got a volume below 0 and applies 0")
		value = 0.0
	elif volume > 1.0:
		LogCore.log_error(_TAG, "set_volume got a volume above 1 and applies 1")
		value = 1.0
	_volumes[bus] = value
	_apply_bus(bus)
	LocalDataCore.set_value_float(LocalDataCore.FileKind.DEVICE, _VOLUME_KEYS[bus], value)


static func get_volume(bus: SoundBus) -> float:
	if not _check_initialized("get_volume"):
		return 1.0
	if not _is_bus(bus):
		LogCore.log_error(_TAG, "get_volume got a bus that is not a SoundBus element")
		return 1.0
	return _volumes[bus]


static func set_mute(bus: SoundBus, mute: bool) -> void:
	if not _check_initialized("set_mute"):
		return
	if not _is_bus(bus):
		LogCore.log_error(_TAG, "set_mute got a bus that is not a SoundBus element")
		return
	_mutes[bus] = mute
	_apply_bus(bus)
	LocalDataCore.set_value_bool(LocalDataCore.FileKind.DEVICE, _MUTE_KEYS[bus], mute)


static func get_mute(bus: SoundBus) -> bool:
	if not _check_initialized("get_mute"):
		return false
	if not _is_bus(bus):
		LogCore.log_error(_TAG, "get_mute got a bus that is not a SoundBus element")
		return false
	return _mutes[bus]


## Plays `key` as the BGM. `scope` null omits the scope: the request loads with a BGM scope.
static func play_bgm(key: String, scope: Scope = null) -> void:
	if not _check_initialized("play_bgm"):
		return
	if scope != null and scope.released:
		LogCore.log_error(_TAG, "play_bgm got a released resource scope: " + key)
		return
	_bgm_request = null
	var record: _BGM_RECORD = _BGM_RECORD.new()
	record.key = key
	if scope == null:
		var owner: Node = Node.new()
		_bgm_owner_count += 1
		owner.name = "BgmScope" + str(_bgm_owner_count)
		_node.add_child(owner)
		var owner_scope: Scope = ResourceCore.get_owner_scope(owner)
		if owner_scope == null or owner_scope.released:
			_node.remove_child(owner)
			owner.free()
			_settle_all()
			return
		record.owner = owner
		record.scope = owner_scope
		_owned_records.append(record)
	else:
		record.scope = scope
	var request: _BGM_REQUEST = _BGM_REQUEST.new()
	request.record = record
	_bgm_request = request
	_settle_all()
	_queue_load()


static func stop_bgm() -> void:
	if not _check_initialized("stop_bgm"):
		return
	_bgm_request = null
	if _current != null:
		for channel: _BGM_CHANNEL in _channels:
			if channel.record == _current:
				_fade(channel, 0.0, true)
		_previous = _current
		_current = null
	_settle_all()


static func return_bgm() -> void:
	if not _check_initialized("return_bgm"):
		return
	_bgm_request = null
	if _previous == null:
		_settle_all()
		return
	var request: _BGM_REQUEST = _BGM_REQUEST.new()
	request.record = _previous
	request.is_return = true
	_bgm_request = request
	_settle_all()
	_queue_load()


static func get_bgm_key() -> String:
	if not _check_initialized("get_bgm_key"):
		return ""
	return _current.key if _current != null else ""


## Plays `key` on `bus` (`SFX`, `VOICE` or `UI`). Returns the play handle, or `INVALID_HANDLE` when the request does
## not play. A loaded sound starts in the call; the call may come from frame code.
static func play(key: String, bus: SoundBus, scope: Scope, priority: int = 0) -> int:
	if not _check_initialized("play"):
		return INVALID_HANDLE
	if bus != SoundBus.SFX and bus != SoundBus.VOICE and bus != SoundBus.UI:
		LogCore.log_error(_TAG, "play got a bus that is not Sfx, Voice or Ui")
		return INVALID_HANDLE
	if scope == null or scope.released:
		LogCore.log_error(_TAG, "play got a missing or released resource scope")
		return INVALID_HANDLE
	_next_handle += 1
	var handle: int = _next_handle
	if ResourceCore.is_loaded(key, ResourceCore.BaseKind.AUDIO_STREAM):
		var resource: Resource = ResourceCore.get_loaded(key, ResourceCore.BaseKind.AUDIO_STREAM, scope)
		if resource == null:
			return INVALID_HANDLE
		return handle if _start_sfx(handle, key, bus, priority, scope, resource) else INVALID_HANDLE
	if CoreBuildInfo.has_dev_code:
		LogCore.log_warn(_TAG, "play of a sound that is not loaded: " + key)
	var request: _SFX_REQUEST = _SFX_REQUEST.new()
	request.handle = handle
	request.key = key
	request.bus = bus
	request.priority = priority
	request.scope = scope
	_pending.append(request)
	_queue_load()
	return handle


static func stop(handle: int) -> void:
	if not _check_initialized("stop"):
		return
	if handle == INVALID_HANDLE:
		return
	for slot: int in _players.size():
		if _slot_handles[slot] == handle:
			_free_slot(slot)
			return
	for index: int in _pending.size():
		if _pending[index].handle == handle:
			_pending.remove_at(index)
			return


static func is_playing(handle: int) -> bool:
	if not _check_initialized("is_playing"):
		return false
	if handle == INVALID_HANDLE:
		return false
	_update_game_pause(TimeCore.get_real_time())
	for slot: int in _players.size():
		if _slot_handles[slot] == handle:
			if not _has_ended(slot):
				return true
			_free_slot(slot)
			return false
	for request: _SFX_REQUEST in _pending:
		if request.handle == handle:
			return true
	return false


static func request_pause() -> int:
	if not _check_initialized("request_pause"):
		return INVALID_PAUSE_TOKEN
	_next_pause_token += 1
	_pause_tokens.append(_next_pause_token)
	_update_global_pause()
	return _next_pause_token


static func release_pause(token: int) -> void:
	if not _check_initialized("release_pause"):
		return
	var index: int = _pause_tokens.find(token) if token != INVALID_PAUSE_TOKEN else -1
	if index == -1:
		LogCore.log_error(_TAG, "release_pause got an invalid or released pause token")
		return
	_pause_tokens.remove_at(index)
	_update_global_pause()


static func play_haptic(key: String, scope: Scope) -> bool:
	if not _check_initialized("play_haptic"):
		return false
	if scope == null or scope.released:
		LogCore.log_error(_TAG, "play_haptic got a missing or released resource scope")
		return false
	var target: HapticTarget = HapticTarget.DEVICE
	var gamepad: int = -1
	if InputCore.get_device() == InputCore.InputDevice.GAMEPAD:
		target = HapticTarget.GAMEPAD
		gamepad = InputCore.get_last_gamepad()
	var played: bool = _play_haptic(key, scope, target, gamepad)
	_record_haptic(key, played, target)
	return played


static func set_haptic_enabled(enabled: bool) -> void:
	if not _check_initialized("set_haptic_enabled"):
		return
	_haptic_enabled = enabled
	LocalDataCore.set_value_bool(LocalDataCore.FileKind.DEVICE, _HAPTIC_ENABLED_KEY, enabled)


static func is_haptic_enabled() -> bool:
	if not _check_initialized("is_haptic_enabled"):
		return false
	return _haptic_enabled


static func _check_initialized(operation: String) -> bool:
	if _is_initialized:
		return true
	LogCore.log_error(_TAG, operation + " before init or after release")
	return false


static func _is_bus(bus: int) -> bool:
	return bus >= 0 and bus < _BUS_NAMES.size()


static func _read_settings() -> bool:
	var int_keys: PackedStringArray = [_SETTING_CROSSFADE, _SETTING_MAX_CONCURRENT, _SETTING_MAX_PER_KEY]
	if CoreBuildInfo.has_dev_code:
		int_keys.append(_SETTING_HAPTIC_LOG)
	for key: String in int_keys:
		if not CoreSettings.has_int(key):
			LogCore.log_error(_TAG, "init found no integer core setting " + key)
			return false
	var number_keys: PackedStringArray = [_SETTING_PEAK, _SETTING_MARGIN]
	for key: String in number_keys:
		if not CoreSettings.has_float(key):
			LogCore.log_error(_TAG, "init found no number core setting " + key)
			return false
	var object_keys: PackedStringArray = [_SETTING_LOUDNESS, _SETTING_BUS_PEAK]
	for key: String in object_keys:
		if not CoreSettings.has_key(key):
			LogCore.log_error(_TAG, "init found no core setting " + key)
			return false
	var crossfade_ms: int = CoreSettings.get_int(_SETTING_CROSSFADE)
	var max_concurrent: int = CoreSettings.get_int(_SETTING_MAX_CONCURRENT)
	var max_per_key: int = CoreSettings.get_int(_SETTING_MAX_PER_KEY)
	var haptic_log_count: int = CoreSettings.get_int(_SETTING_HAPTIC_LOG) if CoreBuildInfo.has_dev_code else 0
	if crossfade_ms < 0 or max_concurrent < 1 or max_per_key < 1 or haptic_log_count < 0:
		LogCore.log_error(_TAG, "init found a core setting out of range")
		return false
	_crossfade_ms = crossfade_ms
	_max_concurrent = max_concurrent
	_max_per_key = max_per_key
	_haptic_log_count = haptic_log_count
	return true


static func _make_players(node: _NODE) -> void:
	for index: int in _CHANNEL_COUNT:
		var channel: _BGM_CHANNEL = _BGM_CHANNEL.new()
		channel.player = AudioStreamPlayer.new()
		channel.player.name = "Bgm" + str(index)
		channel.player.bus = _BUS_NAMES[SoundBus.BGM]
		node.add_child(channel.player)
		_channels.append(channel)
	_slot_handles.resize(_max_concurrent)
	_slot_keys.resize(_max_concurrent)
	_slot_buses.resize(_max_concurrent)
	_slot_priorities.resize(_max_concurrent)
	_slot_orders.resize(_max_concurrent)
	_slot_scopes.resize(_max_concurrent)
	_slot_lengths_ms.resize(_max_concurrent)
	_slot_played_ms.resize(_max_concurrent)
	for slot: int in _max_concurrent:
		var player: AudioStreamPlayer = AudioStreamPlayer.new()
		player.name = "Sfx" + str(slot)
		player.bus = _BUS_NAMES[SoundBus.SFX]
		node.add_child(player)
		node.watch_sfx_player(player, slot)
		_players.append(player)


## Adds the missing buses that send to `Master`, the `Master` limiter and applies the bus volumes and mutes.
static func _setup_buses() -> void:
	var master: int = AudioServer.get_bus_index(_BUS_NAMES[SoundBus.MASTER])
	for bus: int in range(SoundBus.BGM, _BUS_NAMES.size()):
		var index: int = AudioServer.get_bus_index(_BUS_NAMES[bus])
		if index == -1:
			AudioServer.add_bus()
			index = AudioServer.bus_count - 1
			AudioServer.set_bus_name(index, _BUS_NAMES[bus])
			_created_buses.append(String(_BUS_NAMES[bus]))
		AudioServer.set_bus_send(index, _BUS_NAMES[SoundBus.MASTER])
	_limiter = AudioEffectHardLimiter.new()
	_limiter.ceiling_db = CoreSettings.get_float(_SETTING_PEAK) - CoreSettings.get_float(_SETTING_MARGIN)
	if master != -1:
		AudioServer.add_bus_effect(master, _limiter)
	for bus: int in _BUS_NAMES.size():
		_apply_bus(bus)


## Takes the limiter out, removes the buses `init` added and puts the other buses at volume 1 without mute.
static func _restore_buses() -> void:
	var master: int = AudioServer.get_bus_index(_BUS_NAMES[SoundBus.MASTER])
	if master != -1 and _limiter != null:
		for effect: int in AudioServer.get_bus_effect_count(master):
			if AudioServer.get_bus_effect(master, effect) == _limiter:
				AudioServer.remove_bus_effect(master, effect)
				break
	for position: int in range(_created_buses.size() - 1, -1, -1):
		var index: int = AudioServer.get_bus_index(_created_buses[position])
		if index != -1:
			AudioServer.remove_bus(index)
	for bus: int in _BUS_NAMES.size():
		var index: int = AudioServer.get_bus_index(_BUS_NAMES[bus])
		if index != -1:
			AudioServer.set_bus_volume_db(index, 0.0)
			AudioServer.set_bus_mute(index, false)


static func _apply_bus(bus: int) -> void:
	var index: int = AudioServer.get_bus_index(_BUS_NAMES[bus])
	if index == -1:
		return
	var volume: float = _volumes[bus]
	AudioServer.set_bus_volume_db(index, linear_to_db(volume) if volume > 0.0 else _SILENT_DB)
	AudioServer.set_bus_mute(index, _mutes[bus] or volume <= 0.0)


## Starts the loads of the BGM request and the `play` requests from a deferred call: `play_bgm`, `return_bgm` and
## `play` may come from frame code, which does no `await`.
static func _queue_load() -> void:
	if _load_queued:
		return
	_load_queued = true
	_load_call.call_deferred()


static func _on_deferred_load() -> void:
	if not _is_initialized or not _load_queued:
		return
	_load_queued = false
	if _bgm_request != null and not _bgm_request.started:
		_bgm_request.started = true
		_run_bgm_request(_bgm_request, _session)
	for request: _SFX_REQUEST in _pending.duplicate():
		if not request.started and _pending.has(request):
			request.started = true
			_load_sfx(request, _session)


static func _run_bgm_request(request: _BGM_REQUEST, session: RefCounted) -> void:
	var record: _BGM_RECORD = request.record
	var resource: Resource = await ResourceCore.load(record.key, ResourceCore.BaseKind.AUDIO_STREAM, record.scope)
	if session != _session or request != _bgm_request:
		return
	_bgm_request = null
	var loaded: bool = (
		resource != null and not record.scope.released
		and ResourceCore.is_loaded(record.key, ResourceCore.BaseKind.AUDIO_STREAM)
	)
	if not loaded:
		_settle_all()
		return
	if request.is_return:
		if record == _previous:
			_previous = null
			var outgoing: _BGM_RECORD = _current
			_current = record
			_start_crossfade(record, _pick_stream(record.key, resource), outgoing)
		_settle_all()
		return
	if _current != null and _current.key == record.key:
		for channel: _BGM_CHANNEL in _channels:
			if channel.record == _current:
				channel.record = record
		_current = record
		_settle_all()
		return
	var outgoing_current: _BGM_RECORD = _current
	if _current != null:
		_previous = _current
	_current = record
	_start_crossfade(record, _pick_stream(record.key, resource), outgoing_current)
	_settle_all()


## Stops the BGM players that do not play `outgoing` without fade, fades `outgoing` out and starts `record` from the
## beginning with a fade in.
static func _start_crossfade(record: _BGM_RECORD, stream: AudioStream, outgoing: _BGM_RECORD) -> void:
	var outgoing_channel: _BGM_CHANNEL = null
	for channel: _BGM_CHANNEL in _channels:
		if channel.record == null:
			continue
		if outgoing != null and channel.record == outgoing and not channel.stop_at_end:
			outgoing_channel = channel
		else:
			_stop_channel(channel)
	if outgoing_channel != null:
		_fade(outgoing_channel, 0.0, true)
	for channel: _BGM_CHANNEL in _channels:
		if channel.record == null:
			channel.record = record
			channel.volume = 0.0
			_apply_channel_volume(channel)
			channel.player.stream = _loop_stream(stream)
			channel.player.stream_paused = false
			channel.player.play()
			if _global_paused:
				channel.player.stream_paused = true
			_fade(channel, 1.0, false)
			return


## A copy of the loaded BGM stream with loop on. The cached resource does not change.
static func _loop_stream(stream: AudioStream) -> AudioStream:
	var copy: AudioStream = stream.duplicate() as AudioStream
	if copy is AudioStreamOggVorbis:
		(copy as AudioStreamOggVorbis).loop = true
	elif copy is AudioStreamMP3:
		(copy as AudioStreamMP3).loop = true
	elif copy is AudioStreamWAV:
		var wav: AudioStreamWAV = copy as AudioStreamWAV
		wav.loop_mode = AudioStreamWAV.LOOP_FORWARD
		wav.loop_begin = 0
		wav.loop_end = roundi(wav.get_length() * wav.mix_rate)
	return copy


static func _fade(channel: _BGM_CHANNEL, to: float, stop_at_end: bool) -> void:
	channel.fade_from = channel.volume
	channel.fade_to = to
	channel.fade_ms = _crossfade_ms
	channel.fade_elapsed_ms = 0
	channel.stop_at_end = stop_at_end
	channel.fading = true
	if _crossfade_ms == 0:
		_end_fade(channel)


static func _end_fade(channel: _BGM_CHANNEL) -> void:
	channel.fading = false
	channel.volume = channel.fade_to
	_apply_channel_volume(channel)
	if channel.stop_at_end:
		_stop_channel(channel)
		_queue_settle()


static func _stop_channel(channel: _BGM_CHANNEL) -> void:
	channel.player.stop()
	channel.player.stream = null
	channel.player.stream_paused = false
	channel.record = null
	channel.volume = 0.0
	channel.fading = false
	channel.stop_at_end = false


static func _apply_channel_volume(channel: _BGM_CHANNEL) -> void:
	channel.player.volume_db = linear_to_db(channel.volume) if channel.volume > 0.0 else _SILENT_DB


## Ends the BGM scope of every record that is not the current BGM, the previous BGM, a pending request or on a
## player.
static func _settle_all() -> void:
	if _settling:
		return
	_settling = true
	var found: bool = true
	while found:
		found = false
		for index: int in _owned_records.size():
			var record: _BGM_RECORD = _owned_records[index]
			if not _is_held(record):
				_owned_records.remove_at(index)
				_end_owner(record)
				found = true
				break
	_settling = false


static func _is_held(record: _BGM_RECORD) -> bool:
	if record == _current or record == _previous:
		return true
	if _bgm_request != null and _bgm_request.record == record:
		return true
	for channel: _BGM_CHANNEL in _channels:
		if channel.record == record:
			return true
	return false


static func _end_owner(record: _BGM_RECORD) -> void:
	var owner: Node = record.owner
	record.owner = null
	if owner == null:
		return
	if ResourceCore.is_initialized():
		ResourceCore.end_owner_scope(owner)
	if is_instance_valid(owner):
		owner.queue_free()


static func _queue_settle() -> void:
	if _settle_queued:
		return
	_settle_queued = true
	_settle_call.call_deferred()


static func _on_deferred_settle() -> void:
	if not _is_initialized or not _settle_queued:
		return
	_settle_queued = false
	_settle_all()


static func _load_sfx(request: _SFX_REQUEST, session: RefCounted) -> void:
	var resource: Resource = await ResourceCore.load(request.key, ResourceCore.BaseKind.AUDIO_STREAM, request.scope)
	if session != _session:
		return
	var index: int = _pending.find(request)
	if index == -1:
		return
	_pending.remove_at(index)
	if resource == null or request.scope.released:
		return
	if not ResourceCore.is_loaded(request.key, ResourceCore.BaseKind.AUDIO_STREAM):
		return
	_start_sfx(request.handle, request.key, request.bus, request.priority, request.scope, resource)


## Starts a `play` request on an empty player or on the replaced player with the loaded `resource` of `key`: an
## `AudioStream`, or a `ResourceVariants` of them. False when the limit check decides not to play it. Allocates no
## memory.
static func _start_sfx(handle: int, key: String, bus: int, priority: int, scope: Scope, resource: Resource) -> bool:
	_update_game_pause(TimeCore.get_real_time())
	var slot: int = _choose_slot(key, priority)
	if slot == -1:
		return false
	if _slot_handles[slot] != INVALID_HANDLE:
		_free_slot(slot)
	var player: AudioStreamPlayer = _players[slot]
	if player.bus != _BUS_NAMES[bus]:
		player.bus = _BUS_NAMES[bus]
	player.stream = _pick_stream(key, resource)
	_slot_lengths_ms[slot] = _length_ms(player.stream)
	_slot_played_ms[slot] = 0
	player.stream_paused = false
	player.play()
	if _is_bus_paused(bus):
		player.stream_paused = true
	_start_order += 1
	_slot_handles[slot] = handle
	_slot_keys[slot] = key
	_slot_buses[slot] = bus
	_slot_priorities[slot] = priority
	_slot_orders[slot] = _start_order
	_slot_scopes[slot] = scope
	var event: SoundPlayedEvent = EventCore.acquire(SoundPlayedEvent) as SoundPlayedEvent
	event.bus = bus as SoundBus
	EventCore.publish(event)
	return true


## The empty player for a new play of `key`, the player of the replaced play, or -1 when the replaced play has a
## higher priority.
static func _choose_slot(key: String, priority: int) -> int:
	var total: int = 0
	var same_key: int = 0
	var empty_slot: int = -1
	for slot: int in _players.size():
		if _slot_handles[slot] == INVALID_HANDLE or _has_ended(slot):
			if empty_slot == -1:
				empty_slot = slot
			continue
		total += 1
		if _slot_keys[slot] == key:
			same_key += 1
	var key_full: bool = same_key >= _max_per_key
	if not key_full and total < _max_concurrent:
		return empty_slot
	var target: int = -1
	for slot: int in _players.size():
		if _slot_handles[slot] == INVALID_HANDLE or _has_ended(slot):
			continue
		if key_full and _slot_keys[slot] != key:
			continue
		if (
			target == -1 or _slot_priorities[slot] < _slot_priorities[target]
			or (_slot_priorities[slot] == _slot_priorities[target] and _slot_orders[slot] < _slot_orders[target])
		):
			target = slot
	if target == -1 or _slot_priorities[target] > priority:
		return -1
	return target


## Whether the play of `slot` ended: the engine ended it before its player's `finished` signal came, or its time
## played outside pause, counted by `_count_played` up to now, reached its sound length. A paused play has not ended in
## the engine.
static func _has_ended(slot: int) -> bool:
	if _reached_length(slot):
		return true
	var player: AudioStreamPlayer = _players[slot]
	return not player.playing and not player.stream_paused


## Whether the time the play of `slot` spent outside pause, counted by `_count_played`, reached its sound length.
static func _reached_length(slot: int) -> bool:
	return _slot_lengths_ms[slot] > 0 and _slot_played_ms[slot] >= _slot_lengths_ms[slot]


## Adds the real elapsed time since the last count up to `now` to every play outside pause. The browser runtime's
## playback reports no end while the page audio is stopped (its audio worklet pulls the mix only while the context
## runs), so the sound length ends such a play. Called before the pause of a play changes. Allocates no memory.
static func _count_played(now: int) -> void:
	var step: int = now - _played_at
	if step <= 0:
		return
	_played_at = now
	for slot: int in _players.size():
		if _slot_handles[slot] != INVALID_HANDLE and _slot_lengths_ms[slot] > 0 and not _is_bus_paused(_slot_buses[slot]):
			_slot_played_ms[slot] += step


## Counts the time played up to `now`, then takes the game time pause of `TimeCore` at once: a `play` or a pause
## change in the frame where the game time pause changed sees the new pause before the frame processing. Allocates no
## memory.
static func _update_game_pause(now: int) -> void:
	_count_played(now)
	var game_paused: bool = TimeCore.is_paused()
	if game_paused == _game_paused:
		return
	_game_paused = game_paused
	_apply_player_pause()
	if not game_paused and _global_paused and not _positional_pause_queued:
		_positional_pause_queued = true
		_positional_pause_call.call_deferred()


## Sound length of a play that does not loop, in ms. 0 for a loop sound and for a stream the engine gives no length.
static func _length_ms(stream: AudioStream) -> int:
	if stream is AudioStreamWAV:
		if (stream as AudioStreamWAV).loop_mode != AudioStreamWAV.LOOP_DISABLED:
			return 0
	elif stream is AudioStreamOggVorbis:
		if (stream as AudioStreamOggVorbis).loop:
			return 0
	elif stream is AudioStreamMP3:
		if (stream as AudioStreamMP3).loop:
			return 0
	var length: float = stream.get_length()
	if not is_finite(length) or length <= 0.0:
		return 0
	return maxi(roundi(length * 1000.0), 1)


## The player of `slot` sent `finished`: its play ended.
static func _on_sfx_finished(slot: int) -> void:
	if _is_initialized and slot < _players.size() and _slot_handles[slot] != INVALID_HANDLE:
		_free_slot(slot)


## Stops the player of `slot` and makes it an empty player.
static func _free_slot(slot: int) -> void:
	var player: AudioStreamPlayer = _players[slot]
	player.stop()
	player.stream = null
	player.stream_paused = false
	_slot_handles[slot] = INVALID_HANDLE
	_slot_keys[slot] = ""
	_slot_scopes[slot] = null
	_slot_lengths_ms[slot] = 0
	_slot_played_ms[slot] = 0


## The stream to play for `key` from its loaded `resource`: the resource itself, or for a key with two or more variants
## the `ResourceVariants` item `_choose_variant` picks.
static func _pick_stream(key: String, resource: Resource) -> AudioStream:
	var variants: ResourceVariants = resource as ResourceVariants
	if variants == null:
		return resource as AudioStream
	return variants.items[_choose_variant(key, variants.items.size())] as AudioStream


## Variant index for a play of `key` with `count` variants: a variant other than the last one played for that key,
## from the `sound_variant` random instance. The first play of a key picks from every variant.
static func _choose_variant(key: String, count: int) -> int:
	if count < 2:
		return 0
	var pick: int = 0
	if _last_variants.has(key):
		var last: int = _last_variants[key]
		pick = UtilCore.range_int(_variant_random, 0, count - 2)
		if pick >= last:
			pick += 1
	else:
		pick = UtilCore.range_int(_variant_random, 0, count - 1)
	_last_variants[key] = pick
	return pick


static func _is_bus_paused(bus: int) -> bool:
	return _global_paused or (_game_paused and (bus == SoundBus.SFX or bus == SoundBus.VOICE))


static func _update_global_pause() -> void:
	var paused: bool = _focus_lost or _backgrounded or not _pause_tokens.is_empty()
	if paused == _global_paused:
		return
	_update_game_pause(TimeCore.get_real_time())
	_global_paused = paused
	_apply_player_pause()
	_apply_positional_pause()


static func _apply_player_pause() -> void:
	for slot: int in _players.size():
		if _slot_handles[slot] != INVALID_HANDLE:
			_players[slot].stream_paused = _is_bus_paused(_slot_buses[slot])
	for channel: _BGM_CHANNEL in _channels:
		if channel.record != null:
			channel.player.stream_paused = _global_paused


## Global pause on: pauses every content positional player. Off: resumes the ones whose `can_process()` is true.
static func _apply_positional_pause() -> void:
	if _node == null or not _node.is_inside_tree():
		return
	for node: Node in _node.get_tree().get_nodes_in_group(_POSITIONAL_GROUP):
		if _global_paused:
			_set_positional_paused(node, true)
		elif node.can_process():
			_set_positional_paused(node, false)


static func _set_positional_paused(node: Node, paused: bool) -> void:
	if node is AudioStreamPlayer2D:
		(node as AudioStreamPlayer2D).stream_paused = paused
	elif node is AudioStreamPlayer3D:
		(node as AudioStreamPlayer3D).stream_paused = paused


## Global pause: pauses the content positional players that play unpaused. The engine starts the playback of `play()`
## and `autoplay` in the player's physics processing, after `stream_paused` was set.
static func _on_physics_frame() -> void:
	if not _is_initialized or not _global_paused:
		return
	for node: Node in _node.get_tree().get_nodes_in_group(_POSITIONAL_GROUP):
		if node is AudioStreamPlayer2D:
			var player_2d: AudioStreamPlayer2D = node as AudioStreamPlayer2D
			if player_2d.playing and not player_2d.stream_paused:
				player_2d.stream_paused = true
		elif node is AudioStreamPlayer3D:
			var player_3d: AudioStreamPlayer3D = node as AudioStreamPlayer3D
			if player_3d.playing and not player_3d.stream_paused:
				player_3d.stream_paused = true


static func _on_deferred_positional_pause() -> void:
	if not _is_initialized or not _positional_pause_queued:
		return
	_positional_pause_queued = false
	if _global_paused:
		_apply_positional_pause()


static func _on_node_added(node: Node) -> void:
	if _is_initialized and _global_paused and node.is_in_group(_POSITIONAL_GROUP):
		_set_positional_paused(node, true)


static func _on_focus_changed(has_focus: bool) -> void:
	if not _is_initialized:
		return
	_focus_lost = not has_focus
	_update_global_pause()


static func _on_background_changed(backgrounded: bool) -> void:
	if not _is_initialized:
		return
	_backgrounded = backgrounded
	_update_global_pause()


static func _on_scope_released(scope: Scope) -> void:
	if not _is_initialized:
		return
	for slot: int in _players.size():
		if _slot_handles[slot] != INVALID_HANDLE and _slot_scopes[slot] == scope:
			_free_slot(slot)
	for index: int in range(_pending.size() - 1, -1, -1):
		if _pending[index].scope == scope:
			_pending.remove_at(index)
	# A request whose load has not started does not load with the released scope; one whose load runs is not played.
	if _bgm_request != null and _bgm_request.record.scope == scope:
		_bgm_request = null
	for channel: _BGM_CHANNEL in _channels:
		if channel.record != null and channel.record.scope == scope:
			_stop_channel(channel)
	if _current != null and _current.scope == scope:
		_current = null
	if _previous != null and _previous.scope == scope:
		_previous = null
	_settle_all()


## Frame processing: ends of plays at their length, game time pause, fades and haptic segments. Allocates no memory.
static func _on_frame() -> void:
	if not _is_initialized:
		return
	var now: int = TimeCore.get_real_time()
	var elapsed: int = maxi(now - _last_real_time, 0)
	_last_real_time = now
	# A play the engine ended frees its player on `finished`; one that reached its length is stopped here.
	_update_game_pause(now)
	for slot: int in _players.size():
		if _slot_handles[slot] != INVALID_HANDLE and _reached_length(slot):
			_free_slot(slot)
	if not _global_paused:
		for channel: _BGM_CHANNEL in _channels:
			if not channel.fading:
				continue
			channel.fade_elapsed_ms += elapsed
			if channel.fade_elapsed_ms >= channel.fade_ms:
				_end_fade(channel)
			else:
				var ratio: float = float(channel.fade_elapsed_ms) / float(channel.fade_ms)
				channel.volume = channel.fade_from + (channel.fade_to - channel.fade_from) * ratio
				_apply_channel_volume(channel)
	_step_haptic(now)


static func _play_haptic(key: String, scope: Scope, target: HapticTarget, gamepad: int) -> bool:
	var resource: Resource = ResourceCore.get_loaded(key, _haptic_kind, scope)
	if resource == null or resource == _haptic_fallback:
		return false
	var pattern: _HAPTIC_PATTERN = _pattern_of(key, resource)
	if not pattern.valid:
		return false
	if not _haptic_enabled or _global_paused:
		return false
	if target == HapticTarget.GAMEPAD:
		if gamepad == -1:
			return false
	elif not _HAPTIC_PLATFORMS.has(CoreBuildInfo.platform):
		return false
	var variant: int = _choose_variant(key, pattern.variant_ends.size())
	_stop_haptic()
	_haptic_pattern = pattern
	_haptic_target = target
	_haptic_gamepad = gamepad
	_haptic_segment = pattern.variant_ends[variant - 1] if variant > 0 else 0
	_haptic_segment_end = pattern.variant_ends[variant]
	_haptic_wait_from = TimeCore.get_real_time()
	_haptic_vibrated = false
	_step_haptic(_haptic_wait_from)
	return true


## The checked pattern of `key`, checked on its first play: the `JSON` resource, or every item of a
## `ResourceVariants`. A failed check logs an error once per key.
static func _pattern_of(key: String, resource: Resource) -> _HAPTIC_PATTERN:
	if _haptic_patterns.has(key):
		return _haptic_patterns[key]
	var pattern: _HAPTIC_PATTERN = _HAPTIC_PATTERN.new()
	var variants: ResourceVariants = resource as ResourceVariants
	if variants == null:
		pattern.valid = _parse_pattern(resource as JSON, pattern)
	else:
		pattern.valid = true
		for item: Resource in variants.items:
			if not _parse_pattern(item as JSON, pattern):
				pattern.valid = false
				break
	_haptic_patterns[key] = pattern
	if not pattern.valid:
		LogCore.log_error(_TAG, "haptic resource is not a haptic pattern: " + key)
	return pattern


## Appends the segments of `resource` to `pattern` as one variant. False when `resource` is not a haptic pattern.
# ogw:input_boundary
static func _parse_pattern(resource: JSON, pattern: _HAPTIC_PATTERN) -> bool:
	if resource == null or not resource.data is Dictionary:
		return false
	var root: Dictionary = resource.data
	if root.size() != 1 or not root.has("segments") or not root["segments"] is Array:
		return false
	var segments: Array = root["segments"]
	if segments.is_empty():
		return false
	for item: Variant in segments:
		if not item is Dictionary:
			return false
		var segment: Dictionary = item
		if segment.size() != _HAPTIC_SEGMENT_KEYS.size():
			return false
		for name: String in _HAPTIC_SEGMENT_KEYS:
			if not segment.has(name) or not _is_json_int(segment[name]):
				return false
		var delay_ms: int = _json_int(segment["delay_ms"])
		var duration_ms: int = _json_int(segment["duration_ms"])
		var intensity: int = _json_int(segment["intensity"])
		if delay_ms < 0 or duration_ms < 1 or intensity < 0 or intensity > 1000:
			return false
		pattern.delays_ms.append(delay_ms)
		pattern.durations_ms.append(duration_ms)
		pattern.intensities.append(intensity)
	pattern.variant_ends.append(pattern.delays_ms.size())
	return true


# ogw:input_boundary
static func _is_json_int(value: Variant) -> bool:
	if value is int:
		return true
	if value is float:
		var number: float = value
		return is_finite(number) and number == floorf(number) and absf(number) < 9.0e15
	return false


# ogw:input_boundary
static func _json_int(value: Variant) -> int:
	if value is int:
		return value
	var number: float = value
	return int(number)


## Plays the segments of the playing pattern that are due at real elapsed time `now`. A segment vibrates for its whole
## duration from the frame that reaches its delay, and the delay of the next segment counts from the end of that
## vibration: a frame later than the delay, or a segment shorter than a frame, delays the segments after it and skips
## none.
static func _step_haptic(now: int) -> void:
	while _haptic_pattern != null:
		if _haptic_segment >= _haptic_segment_end:
			_haptic_pattern = null
			return
		if not _haptic_vibrated:
			if now < _haptic_wait_from + _haptic_pattern.delays_ms[_haptic_segment]:
				return
			_haptic_vibrated = true
			_haptic_wait_from = now + _haptic_pattern.durations_ms[_haptic_segment]
			_vibrate(_haptic_pattern.durations_ms[_haptic_segment], _haptic_pattern.intensities[_haptic_segment])
		if now < _haptic_wait_from:
			return
		_haptic_segment += 1
		_haptic_vibrated = false


static func _vibrate(duration_ms: int, intensity: int) -> void:
	if intensity <= 0:
		return
	var strength: float = float(intensity) / 1000.0
	if _haptic_target == HapticTarget.GAMEPAD:
		Input.start_joy_vibration(_haptic_gamepad, strength, strength, float(duration_ms) / 1000.0)
	else:
		Input.vibrate_handheld(duration_ms, strength)


static func _stop_haptic() -> void:
	if _haptic_pattern != null and _haptic_target == HapticTarget.GAMEPAD:
		Input.stop_joy_vibration(_haptic_gamepad)
	_haptic_pattern = null


static func _record_haptic(key: String, played: bool, target: HapticTarget) -> void:
	var capacity: int = _haptic_log_keys.size()
	if capacity == 0:
		return
	_haptic_log_keys[_haptic_log_next] = key
	_haptic_log_played[_haptic_log_next] = played
	_haptic_log_targets[_haptic_log_next] = target
	_haptic_log_next = (_haptic_log_next + 1) % capacity
	_haptic_log_size = mini(_haptic_log_size + 1, capacity)


## Cleanup of `release`, and of the core node leaving the tree outside `release` without detaching it.
static func _cleanup(detach: bool) -> void:
	var node: _NODE = _node
	_is_initialized = false
	if ResourceCore.is_initialized():
		ResourceCore.remove_scope_release_listener(_scope_listener)
	if EventCore.is_initialized():
		EventCore.unsubscribe_all(node)
	if is_instance_valid(node):
		node.disconnect_tree()
	_stop_haptic()
	for slot: int in _players.size():
		if is_instance_valid(_players[slot]):
			_players[slot].stop()
			_players[slot].stream = null
	for channel: _BGM_CHANNEL in _channels:
		if is_instance_valid(channel.player):
			channel.player.stop()
			channel.player.stream = null
	for record: _BGM_RECORD in _owned_records:
		_end_owner(record)
	_restore_buses()
	_reset_state()
	if detach and is_instance_valid(node):
		var parent: Node = node.get_parent()
		if parent != null:
			parent.remove_child(node)
		node.queue_free()


static func _on_node_exit(node: _NODE) -> void:
	if not _is_initialized or node != _node:
		return
	_cleanup(false)


static func _reset_state() -> void:
	_is_initialized = false
	_session = RefCounted.new()
	_node = null
	_crossfade_ms = 0
	_max_concurrent = 0
	_max_per_key = 0
	_haptic_log_count = 0
	_volumes = PackedFloat64Array([1.0, 1.0, 1.0, 1.0, 1.0])
	_mutes = [false, false, false, false, false]
	_haptic_enabled = true
	_created_buses = PackedStringArray()
	_limiter = null
	_scope_listener = Callable()
	_positional_pause_call = Callable()
	_settle_call = Callable()
	_load_call = Callable()
	_load_queued = false
	_channels = []
	_current = null
	_previous = null
	_bgm_request = null
	_owned_records = []
	_bgm_owner_count = 0
	_settling = false
	_settle_queued = false
	_players = []
	_slot_handles = PackedInt64Array()
	_slot_keys = PackedStringArray()
	_slot_buses = PackedInt32Array()
	_slot_priorities = PackedInt64Array()
	_slot_orders = PackedInt64Array()
	_slot_scopes = []
	_slot_lengths_ms = PackedInt64Array()
	_slot_played_ms = PackedInt64Array()
	_played_at = 0
	_start_order = 0
	_next_handle = 0
	_pending = []
	_variant_random = null
	_last_variants = {}
	_game_paused = false
	_focus_lost = false
	_backgrounded = false
	_pause_tokens = PackedInt64Array()
	_next_pause_token = 0
	_global_paused = false
	_positional_pause_queued = false
	_last_real_time = 0
	_haptic_kind = -1
	_haptic_fallback = null
	_haptic_patterns = {}
	_haptic_pattern = null
	_haptic_target = HapticTarget.DEVICE
	_haptic_gamepad = -1
	_haptic_segment = 0
	_haptic_segment_end = 0
	_haptic_wait_from = 0
	_haptic_vibrated = false
	_haptic_log_keys = PackedStringArray()
	_haptic_log_played = []
	_haptic_log_targets = PackedInt32Array()
	_haptic_log_next = 0
	_haptic_log_size = 0
