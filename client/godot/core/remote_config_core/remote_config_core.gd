class_name RemoteConfigCore
extends RefCounted
## Keeps the config values, feature flags and experiment assignments server core `remote-config` chose, received with
## the login response and core `rpc` `GetRemoteConfig`, and gives typed getters with the type and default value data
## declares.

const _TAG: String = "RemoteConfigCore"
const _SETTING: String = "RemoteConfigCore.refreshIntervalMs"
const _NODE := preload("res://core/remote_config_core/remote_config_core_node.gd")
const _REFRESH := preload("res://core/remote_config_core/remote_config_refresh.gd")

static var _is_initialized: bool = false
## New object on every `init` and `release`: a coroutine that sees another object stops.
static var _session: RefCounted = RefCounted.new()
static var _node: Node = null
static var _refresh_interval_ms: int = 0

## Received values by key ID value, one dictionary per `RemoteConfigType`.
static var _bools: Dictionary[int, bool] = {}
static var _ints: Dictionary[int, int] = {}
static var _strings: Dictionary[int, String] = {}
## Received group names by experiment ID value.
static var _groups: Dictionary[int, String] = {}
static var _has_received: bool = false
## Real elapsed time at the last apply.
static var _applied_real_ms: int = 0
## Sum of `background_ms` of the background returns after the last apply.
static var _background_ms: int = 0
## The `GetRemoteConfig` send in progress, or `null`.
static var _refresh: _REFRESH = null

## Key ID values whose log was left since `init`: unknown key getter, getter type mismatch, unknown entry key.
static var _logged_unknown_keys: Dictionary[int, bool] = {}
static var _logged_type_keys: Dictionary[int, bool] = {}
static var _logged_entry_keys: Dictionary[int, bool] = {}


# --- lifecycle ---


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init: already initialized")
		return false
	if not CoreSettings.has_int(_SETTING):
		LogCore.log_error(_TAG, "init: core settings %s is missing or not an integer" % _SETTING)
		return false
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree == null:
		LogCore.log_error(_TAG, "init: no scene tree")
		return false
	_refresh_interval_ms = CoreSettings.get_int(_SETTING)
	_session = RefCounted.new()
	var node: _NODE = _NODE.new()
	node.name = "RemoteConfigCore"
	_node = node
	tree.root.add_child(node)
	_is_initialized = true
	var subscribed: bool = (
		EventCore.subscribe(LoginCompletedEvent, node._on_login_completed)
		and EventCore.subscribe(AppForegroundReturnedEvent, node._on_app_foreground_returned)
	)
	if not subscribed:
		LogCore.log_error(_TAG, "init: event subscription failed")
		release()
		return false
	return true


static func release() -> void:
	if not _is_initialized:
		return
	_clean_up(true)


static func is_initialized() -> bool:
	return _is_initialized


static func _on_node_exit(node: Node) -> void:
	if _is_initialized and node == _node:
		_clean_up(false)


static func _clean_up(detach: bool) -> void:
	_is_initialized = false
	_session = RefCounted.new()
	var refresh_call: _REFRESH = _refresh
	_refresh = null
	var node: Node = _node
	_node = null
	if node != null:
		if EventCore.is_initialized():
			EventCore.unsubscribe_all(node)
		if detach and node.get_parent() != null:
			node.get_parent().remove_child(node)
		if not node.is_queued_for_deletion():
			node.queue_free()
	_refresh_interval_ms = 0
	_bools = {}
	_ints = {}
	_strings = {}
	_groups = {}
	_has_received = false
	_applied_real_ms = 0
	_background_ms = 0
	_logged_unknown_keys = {}
	_logged_type_keys = {}
	_logged_entry_keys = {}
	if refresh_call != null:
		refresh_call.finish(false)


# --- getters ---


static func get_bool(key_id: int) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_bool called before init")
		return _is_key_of(key_id, GameData.RemoteConfigType.BOOL) and _default_bool(key_id)
	if not _check_key(key_id, GameData.RemoteConfigType.BOOL):
		return false
	if _bools.has(key_id):
		return _bools[key_id]
	return _default_bool(key_id)


static func get_int(key_id: int) -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_int called before init")
		return _default_int(key_id) if _is_key_of(key_id, GameData.RemoteConfigType.INT) else 0
	if not _check_key(key_id, GameData.RemoteConfigType.INT):
		return 0
	if _ints.has(key_id):
		return _ints[key_id]
	return _default_int(key_id)


static func get_string(key_id: int) -> String:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_string called before init")
		return _default_string(key_id) if _is_key_of(key_id, GameData.RemoteConfigType.STRING) else ""
	if not _check_key(key_id, GameData.RemoteConfigType.STRING):
		return ""
	if _strings.has(key_id):
		return _strings[key_id]
	return _default_string(key_id)


static func get_group(experiment_id: int) -> String:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_group called before init")
		return ""
	if _groups.has(experiment_id):
		return _groups[experiment_id]
	return ""


static func has_received() -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "has_received called before init")
		return false
	return _has_received


## Whether `key_id` is a `remote_config_key` row of `type`. Logs the unknown key and the type mismatch once per key.
static func _check_key(key_id: int, type: GameData.RemoteConfigType) -> bool:
	if not GameData.RemoteConfigKeyTable.has_row(key_id):
		if not _logged_unknown_keys.has(key_id):
			_logged_unknown_keys[key_id] = true
			LogCore.log_error(_TAG, "key %d is not in remote_config_key" % key_id)
		return false
	var key_type: GameData.RemoteConfigType = GameData.RemoteConfigKeyTable.get_row(key_id).type
	if key_type != type:
		if not _logged_type_keys.has(key_id):
			_logged_type_keys[key_id] = true
			LogCore.log_error(
				_TAG, "key %d is of type %s, not %s" % [key_id, _type_name(key_type), _type_name(type)]
			)
		return false
	return true


static func _is_key_of(key_id: int, type: GameData.RemoteConfigType) -> bool:
	return GameData.RemoteConfigKeyTable.has_row(key_id) and GameData.RemoteConfigKeyTable.get_row(key_id).type == type


static func _default_bool(key_id: int) -> bool:
	return GameData.RemoteConfigKeyTable.get_row(key_id).default_value == "true"


static func _default_int(key_id: int) -> int:
	return GameData.RemoteConfigKeyTable.get_row(key_id).default_value.to_int()


static func _default_string(key_id: int) -> String:
	return GameData.RemoteConfigKeyTable.get_row(key_id).default_value


# --- fetch ---


static func refresh() -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "refresh called before init")
		return false
	var session: RefCounted = _session
	var refresh_call: _REFRESH = _refresh
	if refresh_call == null:
		if not _is_logged_in():
			LogCore.log_warn(_TAG, "refresh before login; no request sent")
			return false
		refresh_call = _REFRESH.new()
		_refresh = refresh_call
		_send_refresh(refresh_call, session)
	if not refresh_call.finished:
		await refresh_call.done
	if session != _session:
		return false
	return refresh_call.ok


static func _send_refresh(refresh_call: _REFRESH, session: RefCounted) -> void:
	var sent: bool = await NetworkCore.send(CoreContract.GetRemoteConfigRequest.new(), refresh_call.on_success)
	if session != _session:
		return
	_refresh = null
	var response: CoreContract.GetRemoteConfigResponse = refresh_call.response
	var ok: bool = sent and response != null
	if ok:
		_apply(response.entries, response.assignments)
	refresh_call.finish(ok)


static func _is_logged_in() -> bool:
	return AuthCore.is_initialized() and AuthCore.is_logged_in()


static func _on_login_completed() -> void:
	if not _is_initialized:
		return
	var config: CoreContract.GetRemoteConfigResponse = AuthCore.get_login_remote_config()
	_apply(config.entries, config.assignments)


static func _on_foreground_returned(background_ms: int) -> void:
	if not _is_initialized:
		return
	_background_ms += background_ms
	if not _has_received or not _is_logged_in():
		return
	if TimeCore.get_real_time() - _applied_real_ms + _background_ms < _refresh_interval_ms:
		return
	refresh()


## Replaces every entry and assignment with the received lists and publishes `RemoteConfigChangedEvent` when a value
## or an assignment changed.
static func _apply(
	entries: Array[CoreContract.RemoteConfigEntry], assignments: Array[CoreContract.ExperimentAssignment]
) -> void:
	var bools: Dictionary[int, bool] = {}
	var ints: Dictionary[int, int] = {}
	var strings: Dictionary[int, String] = {}
	var seen: Dictionary[int, bool] = {}
	for entry: CoreContract.RemoteConfigEntry in entries:
		if entry == null:
			continue
		var key_id: int = entry.key_id
		if not GameData.RemoteConfigKeyTable.has_row(key_id):
			if not _logged_entry_keys.has(key_id):
				_logged_entry_keys[key_id] = true
				LogCore.log_warn(_TAG, "entry key %d is not in remote_config_key; dropped" % key_id)
			continue
		if seen.has(key_id):
			LogCore.log_error(_TAG, "entry key %d came twice; the first entry is used" % key_id)
			continue
		seen[key_id] = true
		var value: CoreContract.RemoteConfigValue = entry.value
		var kind: CoreContract.RemoteConfigValueKind = (
			value.kind if value != null else CoreContract.RemoteConfigValueKind.REMOTE_CONFIG_VALUE_KIND_UNSPECIFIED
		)
		var key_type: GameData.RemoteConfigType = GameData.RemoteConfigKeyTable.get_row(key_id).type
		if kind != _kind_of(key_type):
			LogCore.log_error(
				_TAG, "entry key %d has value kind %s for type %s; dropped" % [key_id, _kind_name(kind), _type_name(key_type)]
			)
			continue
		match key_type:
			GameData.RemoteConfigType.BOOL:
				bools[key_id] = value.bool_value
			GameData.RemoteConfigType.INT:
				ints[key_id] = value.int_value
			GameData.RemoteConfigType.STRING:
				strings[key_id] = value.string_value
	var groups: Dictionary[int, String] = {}
	for assignment: CoreContract.ExperimentAssignment in assignments:
		if assignment == null or groups.has(assignment.experiment_id):
			continue
		groups[assignment.experiment_id] = assignment.group
	var changed: bool = (
		groups != _groups
		or _bools_changed(_bools, bools)
		or _ints_changed(_ints, ints)
		or _strings_changed(_strings, strings)
	)
	_bools = bools
	_ints = ints
	_strings = strings
	_groups = groups
	_has_received = true
	_applied_real_ms = TimeCore.get_real_time()
	_background_ms = 0
	if changed:
		var event: RemoteConfigChangedEvent = EventCore.acquire(RemoteConfigChangedEvent) as RemoteConfigChangedEvent
		if event != null:
			EventCore.publish(event)


## The `RemoteConfigValueKind` that corresponds to `type`, by name.
static func _kind_of(type: GameData.RemoteConfigType) -> CoreContract.RemoteConfigValueKind:
	match type:
		GameData.RemoteConfigType.BOOL:
			return CoreContract.RemoteConfigValueKind.REMOTE_CONFIG_VALUE_KIND_BOOL
		GameData.RemoteConfigType.INT:
			return CoreContract.RemoteConfigValueKind.REMOTE_CONFIG_VALUE_KIND_INT
		GameData.RemoteConfigType.STRING:
			return CoreContract.RemoteConfigValueKind.REMOTE_CONFIG_VALUE_KIND_STRING
	return CoreContract.RemoteConfigValueKind.REMOTE_CONFIG_VALUE_KIND_UNSPECIFIED


# Values compare old against new, a key without a received value counting as its `default_value`.


static func _bools_changed(old: Dictionary[int, bool], new: Dictionary[int, bool]) -> bool:
	for key_id: int in new:
		var before: bool = old[key_id] if old.has(key_id) else _default_bool(key_id)
		if before != new[key_id]:
			return true
	for key_id: int in old:
		if not new.has(key_id) and old[key_id] != _default_bool(key_id):
			return true
	return false


static func _ints_changed(old: Dictionary[int, int], new: Dictionary[int, int]) -> bool:
	for key_id: int in new:
		var before: int = old[key_id] if old.has(key_id) else _default_int(key_id)
		if before != new[key_id]:
			return true
	for key_id: int in old:
		if not new.has(key_id) and old[key_id] != _default_int(key_id):
			return true
	return false


static func _strings_changed(old: Dictionary[int, String], new: Dictionary[int, String]) -> bool:
	for key_id: int in new:
		var before: String = old[key_id] if old.has(key_id) else _default_string(key_id)
		if before != new[key_id]:
			return true
	for key_id: int in old:
		if not new.has(key_id) and old[key_id] != _default_string(key_id):
			return true
	return false


## Element name of a `RemoteConfigType` for logs.
static func _type_name(type: GameData.RemoteConfigType) -> String:
	match type:
		GameData.RemoteConfigType.BOOL:
			return "Bool"
		GameData.RemoteConfigType.INT:
			return "Int"
		GameData.RemoteConfigType.STRING:
			return "String"
	return "None"


## Element name of a `RemoteConfigValueKind` for logs.
static func _kind_name(kind: CoreContract.RemoteConfigValueKind) -> String:
	match kind:
		CoreContract.RemoteConfigValueKind.REMOTE_CONFIG_VALUE_KIND_BOOL:
			return "REMOTE_CONFIG_VALUE_KIND_BOOL"
		CoreContract.RemoteConfigValueKind.REMOTE_CONFIG_VALUE_KIND_INT:
			return "REMOTE_CONFIG_VALUE_KIND_INT"
		CoreContract.RemoteConfigValueKind.REMOTE_CONFIG_VALUE_KIND_STRING:
			return "REMOTE_CONFIG_VALUE_KIND_STRING"
		CoreContract.RemoteConfigValueKind.REMOTE_CONFIG_VALUE_KIND_UNSPECIFIED:
			return "REMOTE_CONFIG_VALUE_KIND_UNSPECIFIED"
	return str(kind)
