class_name ResourceCore
extends RefCounted
## Loads resources by resource key, holds and drops loaded resources by scope, and attaches downloaded bundles so
## their resources load.

## Base resource kinds. They exist from `init` on. A registered kind is an `int` after them.
enum BaseKind { PACKED_SCENE, TEXTURE_2D, AUDIO_STREAM, FONT, MATERIAL, SHADER, MESH, ANIMATION, SPRITE_FRAMES, TILE_SET }

## Scope kinds.
enum ScopeKind { GLOBAL, SCENE, PANEL, POPUP, OWNER }

## Invalid kind: points at no kind.
const INVALID_KIND: int = -1

const _TAG: String = "ResourceCore"
const _CORE_NODE = preload("res://core/resource_core/resource_core_node.gd")
const _KIND = preload("res://core/resource_core/resource_kind_entry.gd")
const _KEY = preload("res://core/resource_core/resource_key_entry.gd")
const _ENTRY = preload("res://core/resource_core/resource_cache_entry.gd")
const _LOADING = preload("res://core/resource_core/resource_loading.gd")
const _WAIT = preload("res://core/resource_core/resource_wait.gd")
const _LISTENER = preload("res://core/resource_core/resource_listener.gd")
const _LEAK = preload("res://core/resource_core/resource_leak.gd")
const _WATCHER = preload("res://core/resource_core/resource_owner_watcher.gd")
const _AUDIO_CLOCK = preload("res://core/resource_core/resource_audio_clock.gd")

const _KEY_LIST_PATH: String = "res://generated/resource_keys.json"
const _BUNDLE_KEYS_FOLDER: String = "res://bundle_keys/"
const _GLOBAL_SCOPE_NAME: String = "global"
## Frames a shader warmup instance draws before it is destroyed.
const _WARMUP_FRAMES: int = 2
## Size of the control a canvas item material warmup draws.
const _WARMUP_RECT_SIZE: Vector2 = Vector2(4.0, 4.0)
## Frames the audio server mixes at once. Driver callbacks after a drop that pass more than this made it mix again.
const _MIX_SIZE_FRAMES: int = 512
## Two callback starts read closer than this many frames apart are one callback: each start is a tick read minus
## `get_time_since_last_mix`, two clock reads apart, so one callback's start varies by the time between them. Half the
## shortest audio driver callback, the browser runtime's 128 frames, keeps two callbacks apart.
const _SAME_CALLBACK_FRAMES: int = 64

## Failure conditions whose `error` log is once per key until `release`.
const _FAIL_NO_SCOPE: String = "no_scope"
const _FAIL_RELEASED_SCOPE: String = "released_scope"
const _FAIL_UNKNOWN_KEY: String = "unknown_key"
const _FAIL_ENGINE_LOAD: String = "engine_load"
const _FAIL_KIND_CHECK: String = "kind_check"
const _FAIL_NOT_LOADED: String = "not_loaded"

## Results of `_apply_bundle`. A bundle skipped after it was attached keeps its files attached.
const _BUNDLE_APPLIED: int = 0
const _BUNDLE_SKIPPED: int = 1
const _BUNDLE_SKIPPED_ATTACHED: int = 2

static var _is_initialized: bool = false
static var _session: RefCounted = null
static var _node: _CORE_NODE = null
## Parent of the shader warmup instances. Its processing is disabled so instances only draw.
static var _warmup_holder: Node = null
## Kinds by kind value: the base kinds, then the registered kinds.
static var _kinds: Array[_KIND] = []
static var _key_list: Dictionary[String, _KEY] = {}
## Keys of the applied bundles. A later bundle's key replaces an earlier one's.
static var _bundle_keys: Dictionary[String, _KEY] = {}
## List set by `ResourceCoreDev.set_test_key_list`: resource key to engine path.
static var _test_key_list: Dictionary[String, String] = {}
## Variant counts set by `ResourceCoreDev.set_test_key_list` for keys with two or more variants.
static var _test_variants: Dictionary[String, int] = {}
static var _has_test_key_list: bool = false
static var _global_scope: Scope = null
## Scopes that are not released, in creation order.
static var _scopes: Array[Scope] = []
## Owner scope and its watcher by owner object instance ID.
static var _owner_scopes: Dictionary[int, Scope] = {}
static var _owner_watchers: Dictionary[int, _WATCHER] = {}
static var _listeners: Array[_LISTENER] = []
static var _cache: Dictionary[String, _ENTRY] = {}
## Engine loads in progress by resource key.
static var _loading: Dictionary[String, _LOADING] = {}
## `_run_loading`, made in `init`. `load` starts it deferred so the frame by frame wait runs outside frame code that
## calls `load`.
static var _run_loading_call: Callable = Callable()
## Preload and warmup waits in progress.
static var _waits: Array[_WAIT] = []
static var _warmups: Array[Node] = []
static var _running_preloads: Array[PreloadRequest] = []
static var _bundles_applied: bool = false
## True once a `load` ran since `init`. `apply_bundles` must come before it.
static var _load_requested: bool = false
## `<condition>:<key>` of the failures logged since `init`.
static var _logged: Dictionary[String, bool] = {}
## Engine loads started since `init`.
static var _engine_load_count: int = 0
## Set by core tests before `init`: called with the typed array `init` parsed, right after the parse.
static var _test_typed_array_parse_observer: Callable = Callable()
## Resources taken out of the cache, in the order they left it, for the leak check.
static var _leaks: Array[_LEAK] = []
## Number of `_leaks` that are audio streams with no audio mix seen since they left the cache.
static var _unmixed_audio_count: int = 0
## Source of the tick and audio server values of the leak check. Core tests may set it before `init`; `init` makes the
## engine one when it is unset.
static var _audio_clock: _AUDIO_CLOCK = null
static var _leak_check_queued: bool = false
static var _leak_check: Callable = Callable()
## Leak check, in a build with DEV code: number of cache entries by the instance ID of their resource.
static var _cached_resources: Dictionary[int, int] = {}
## Leak check, in a build with DEV code: number of cache entries whose resource file references each engine path.
static var _cached_dependencies: Dictionary[String, int] = {}


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init of an initialized module")
		return false
	# Godot 4.7.2 fills the parser's type name table without a lock on the first typed array parse; two worker
	# threads reading typed arrays for the first time at once end the process. Parsing one here, on the main
	# thread before any threaded load, fills it first. Remove when the engine fixes the race.
	var parsed: Array[int] = str_to_var("Array[int]([])")
	if _test_typed_array_parse_observer.is_valid():
		_test_typed_array_parse_observer.call(parsed)
	var keys: Dictionary[String, _KEY] = {}
	if _has_test_key_list:
		for key: String in _test_key_list:
			var entry: _KEY = _KEY.new()
			entry.path = _test_key_list[key]
			if _test_variants.has(key):
				entry.variants = _test_variants[key]
			keys[key] = entry
	elif not _read_key_list(_KEY_LIST_PATH, keys):
		LogCore.log_error(_TAG, "init could not read the resource key list file " + _KEY_LIST_PATH)
		return false
	var node: _CORE_NODE = _CORE_NODE.new()
	node.name = "ResourceCore"
	var holder: Node = Node.new()
	holder.name = "ShaderWarmup"
	holder.process_mode = Node.PROCESS_MODE_DISABLED
	node.add_child(holder)
	(Engine.get_main_loop() as SceneTree).root.add_child(node)
	_key_list = keys
	_kinds = _make_base_kinds()
	_session = RefCounted.new()
	_node = node
	_warmup_holder = holder
	_leak_check = node._on_leak_check
	_run_loading_call = _run_loading
	if _audio_clock == null:
		_audio_clock = _AUDIO_CLOCK.new()
	_global_scope = _new_scope(ScopeKind.GLOBAL, _GLOBAL_SCOPE_NAME)
	_is_initialized = true
	return true


static func release() -> void:
	if not _is_initialized:
		_test_key_list = {}
		_test_variants = {}
		_has_test_key_list = false
		_test_typed_array_parse_observer = Callable()
		_audio_clock = null
		return
	var node: _CORE_NODE = _node
	_clean_up()
	if is_instance_valid(node):
		var parent: Node = node.get_parent()
		if parent != null:
			parent.remove_child(node)
		node.queue_free()


static func is_initialized() -> bool:
	return _is_initialized


## Async. The resource of `key` as `kind`, with a reference of `scope`. The kind's fallback on failure, `null`
## before `init`, after `release` and for an invalid kind.
static func load(key: String, kind: int, scope: Scope) -> Resource:
	if not _is_initialized:
		LogCore.log_error(_TAG, "load before init or after release: " + key)
		return null
	if not _is_kind(kind):
		LogCore.log_error(_TAG, "load of an invalid kind: " + key)
		return null
	var kind_entry: _KIND = _kinds[kind]
	if not _check_scope(key, scope):
		return kind_entry.fallback
	_load_requested = true
	if _cache.has(key):
		return _take(key, _cache[key].resource, kind_entry, scope)
	var key_entry: _KEY = _find_key(key)
	if key_entry == null:
		_fail(_FAIL_UNKNOWN_KEY, key, "key is in neither the resource key list nor an applied bundle")
		return kind_entry.fallback
	var loading: _LOADING = null
	if _loading.has(key):
		loading = _loading[key]
	else:
		loading = _start_loading(key, key_entry)
		if loading == null:
			return kind_entry.fallback
	var session: RefCounted = _session
	if not loading.done:
		await loading.finished
	if session != _session:
		return kind_entry.fallback
	if scope.released:
		LogCore.log_warn(_TAG, "scope " + scope.name + " was released while " + key + " loaded")
		return kind_entry.fallback
	if loading.resource == null:
		_fail(_FAIL_ENGINE_LOAD, key, "engine load failed: " + loading.failed_path)
		return kind_entry.fallback
	return _take(key, loading.resource, kind_entry, scope)


## The cached resource of `key` as `kind`, with a reference of `scope`. No engine load. The kind's fallback on
## failure, `null` before `init`, after `release` and for an invalid kind.
static func get_loaded(key: String, kind: int, scope: Scope) -> Resource:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_loaded before init or after release: " + key)
		return null
	if not _is_kind(kind):
		LogCore.log_error(_TAG, "get_loaded of an invalid kind: " + key)
		return null
	var kind_entry: _KIND = _kinds[kind]
	if not _check_scope(key, scope):
		return kind_entry.fallback
	if not _cache.has(key):
		if _find_key(key) == null:
			_fail(_FAIL_UNKNOWN_KEY, key, "key is in neither the resource key list nor an applied bundle")
		else:
			_fail(_FAIL_NOT_LOADED, key, "get_loaded of a key that is not cached")
		return kind_entry.fallback
	return _take(key, _cache[key].resource, kind_entry, scope)


## Whether `key` is cached and its resource passes the kind check of `kind`. No log and no allocation.
static func is_loaded(key: String, kind: int) -> bool:
	if not _is_initialized or not _is_kind(kind) or not _cache.has(key):
		return false
	return _passes_kind_check(_cache[key].resource, _kinds[kind].type)


## Async. The spec operation `preload`; `preload` is a GDScript keyword. Loads every item of `request` with
## `scope` and warms up the shader warmup items. `true` when every item succeeded.
static func preload_resources(request: PreloadRequest, scope: Scope) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "preload before init or after release")
		return false
	if request == null:
		LogCore.log_error(_TAG, "preload without a request")
		return false
	if _running_preloads.has(request):
		LogCore.log_error(_TAG, "preload of a request whose preload runs")
		return false
	_running_preloads.append(request)
	var items: Array[PreloadRequest.Item] = request.items.duplicate()
	request.done_count = 0
	request.total_count = items.size()
	var session: RefCounted = _session
	var wait: _WAIT = _WAIT.new()
	wait.remaining = items.size()
	_waits.append(wait)
	for item: PreloadRequest.Item in items:
		_preload_item(request, item, scope, session, wait)
	if wait.remaining > 0:
		await wait.finished
	if session != _session:
		return false
	_waits.erase(wait)
	_running_preloads.erase(request)
	return wait.ok


## The global scope. A released scope before `init` and after `release`.
static func get_global_scope() -> Scope:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_global_scope before init or after release")
		return _released_scope(ScopeKind.GLOBAL, _GLOBAL_SCOPE_NAME)
	return _global_scope


## A new `scene`, `panel` or `popup` scope named `scope_name`. A released scope for another kind.
static func create_scope(kind: ScopeKind, scope_name: String) -> Scope:
	if not _is_initialized:
		LogCore.log_error(_TAG, "create_scope before init or after release: " + scope_name)
		return _released_scope(ScopeKind.SCENE, scope_name)
	if kind != ScopeKind.SCENE and kind != ScopeKind.PANEL and kind != ScopeKind.POPUP:
		LogCore.log_error(_TAG, "create_scope of a kind other than scene, panel and popup: " + scope_name)
		return _released_scope(ScopeKind.SCENE, scope_name)
	return _new_scope(kind, scope_name)


## Releases a `scene`, `panel` or `popup` scope.
static func release_scope(scope: Scope) -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "release_scope before init or after release")
		return
	if scope == null:
		LogCore.log_error(_TAG, "release_scope without a scope")
		return
	if scope.released or scope.kind == ScopeKind.GLOBAL or scope.kind == ScopeKind.OWNER:
		LogCore.log_error(_TAG, "release_scope of a global, owner or released scope: " + scope.name)
		return
	_release_scope(scope)


## The owner scope of `owner_object`, made on the first call. A released scope when `owner_object` is missing, is
## destroyed or is not a `Node`. `owner_object` is a `Variant`: a destroyed object passed to an `Object` parameter is
## a script error before the body runs.
# ogw:input_boundary
static func get_owner_scope(owner_object: Variant) -> Scope:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_owner_scope before init or after release")
		return _released_scope(ScopeKind.OWNER, "")
	if typeof(owner_object) != TYPE_OBJECT or not is_instance_valid(owner_object):
		LogCore.log_error(_TAG, "get_owner_scope of a missing or destroyed object")
		return _released_scope(ScopeKind.OWNER, "")
	var object: Object = owner_object
	var id: int = object.get_instance_id()
	if _owner_scopes.has(id):
		return _owner_scopes[id]
	var owner_node: Node = object as Node
	if owner_node == null:
		LogCore.log_error(_TAG, "get_owner_scope of an object that is not a Node: " + object.get_class())
		return _released_scope(ScopeKind.OWNER, "")
	var scope_name: String = String(owner_node.name)
	var watcher: _WATCHER = _WATCHER.new()
	watcher.owner_id = id
	owner_node.add_child(watcher, false, Node.INTERNAL_MODE_BACK)
	if watcher.get_parent() != owner_node:
		watcher.free()
		LogCore.log_error(_TAG, "get_owner_scope could not watch the destruction of " + scope_name)
		return _released_scope(ScopeKind.OWNER, scope_name)
	var scope: Scope = _new_scope(ScopeKind.OWNER, scope_name)
	watcher.scope = scope
	_owner_scopes[id] = scope
	_owner_watchers[id] = watcher
	return scope


## Releases the owner scope of `owner_object`. Nothing when it has none, it is releasing, or `owner_object` is missing
## or destroyed. `owner_object` is a `Variant` for the destroyed object, as in `get_owner_scope`.
# ogw:input_boundary
static func end_owner_scope(owner_object: Variant) -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "end_owner_scope before init or after release")
		return
	if typeof(owner_object) != TYPE_OBJECT or not is_instance_valid(owner_object):
		return
	var object: Object = owner_object
	var id: int = object.get_instance_id()
	if not _owner_scopes.has(id):
		return
	var scope: Scope = _owner_scopes[id]
	if scope.released:
		return
	var watcher: _WATCHER = _owner_watchers[id]
	var session: RefCounted = _session
	# The owner object keeps its scope until the release ends: `get_owner_scope` in a listener gets the releasing one.
	_release_scope(scope)
	if session != _session:
		return
	_forget_owner_scope(id, scope)
	_free_watcher(watcher)


## Adds `listener`, called with each scope that is released before the scope drops its references.
static func add_scope_release_listener(listener: Callable) -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "add_scope_release_listener before init or after release")
		return
	if _find_listener(listener) != null:
		LogCore.log_error(_TAG, "add_scope_release_listener of a registered listener")
		return
	var entry: _LISTENER = _LISTENER.new()
	entry.callback = listener
	_listeners.append(entry)


static func remove_scope_release_listener(listener: Callable) -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "remove_scope_release_listener before init or after release")
		return
	var entry: _LISTENER = _find_listener(listener)
	if entry == null:
		return
	entry.removed = true
	_listeners.erase(entry)


## A new kind of the engine type `engine_type` (a native class or a script) whose fallback is `fallback`. Again for
## a registered type, the fallback changes and the same kind returns. `INVALID_KIND` on failure.
static func register_kind(engine_type: Object, fallback: Resource) -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "register_kind before init or after release")
		return INVALID_KIND
	if engine_type == null or not (engine_type is Script or engine_type.get_class() == "GDScriptNativeClass"):
		LogCore.log_error(_TAG, "register_kind of a value that is not an engine type")
		return INVALID_KIND
	if fallback == null or not is_instance_of(fallback, engine_type):
		LogCore.log_error(_TAG, "register_kind without a fallback of the type")
		return INVALID_KIND
	for kind: int in range(BaseKind.size(), _kinds.size()):
		if _kinds[kind].type == engine_type:
			_kinds[kind].fallback = fallback
			return kind
	var entry: _KIND = _KIND.new()
	entry.type = engine_type
	entry.fallback = fallback
	_kinds.append(entry)
	return _kinds.size() - 1


## Attaches `bundles` in order, once per `init` and before any `load`. `true` when every bundle was applied.
static func apply_bundles(bundles: Array[DownloadedBundle]) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "apply_bundles before init or after release")
		return false
	if _bundles_applied or _load_requested:
		LogCore.log_error(_TAG, "apply_bundles after an earlier apply_bundles or a load")
		return false
	_bundles_applied = true
	var all_applied: bool = true
	for bundle: DownloadedBundle in bundles:
		if bundle == null:
			LogCore.log_error(_TAG, "apply_bundles skipped a missing bundle")
			all_applied = false
			continue
		var result: int = _apply_bundle(bundle)
		if result == _BUNDLE_APPLIED:
			LogCore.log_info(_TAG, "applied bundle " + bundle.name + " sha256 " + bundle.sha256)
			continue
		all_applied = false
		if result == _BUNDLE_SKIPPED_ATTACHED:
			LogCore.log_error(
				_TAG,
				(
					"apply_bundles skipped bundle " + bundle.name + " at " + bundle.path
					+ ": its key list could not be read after it was attached, so its files stay attached over the"
					+ " same paths until the process ends"
				)
			)
		else:
			LogCore.log_error(_TAG, "apply_bundles skipped bundle " + bundle.name + " at " + bundle.path)
	return all_applied


# Load


static func _is_kind(kind: int) -> bool:
	return kind >= 0 and kind < _kinds.size()


static func _check_scope(key: String, scope: Scope) -> bool:
	if scope == null:
		_fail(_FAIL_NO_SCOPE, key, "request without a scope")
		return false
	if scope.released:
		_fail(_FAIL_RELEASED_SCOPE, key, "request with the released scope " + scope.name)
		return false
	return true


static func _find_key(key: String) -> _KEY:
	if _bundle_keys.has(key):
		return _bundle_keys[key]
	if _key_list.has(key):
		return _key_list[key]
	return null


## Kind check of `resource`, then a reference of `scope` to `key`. The kind's fallback when the kind check fails.
static func _take(key: String, resource: Resource, kind_entry: _KIND, scope: Scope) -> Resource:
	if not _passes_kind_check(resource, kind_entry.type):
		_fail(_FAIL_KIND_CHECK, key, "resource of " + key + " is not of the requested kind")
		return kind_entry.fallback
	var entry: _ENTRY = null
	if _cache.has(key):
		entry = _cache[key]
	else:
		entry = _ENTRY.new()
		entry.resource = resource
		_cache[key] = entry
		_watch_cached(entry)
	var scope_id: int = scope.get_instance_id()
	if not entry.scope_ids.has(scope_id):
		entry.scope_ids[scope_id] = true
		scope.keys.append(key)
		entry.reference_count += 1
	return entry.resource


## Kind check: `resource` is of `type`. For a `ResourceVariants`, every item is. No allocation.
static func _passes_kind_check(resource: Resource, type: Object) -> bool:
	var variants: ResourceVariants = resource as ResourceVariants
	if variants == null:
		return is_instance_of(resource, type)
	for item: Resource in variants.items:
		if not is_instance_of(item, type):
			return false
	return true


## Starts the engine load of `key`: one load per variant file. `null` when it could not start; the failure is logged.
static func _start_loading(key: String, key_entry: _KEY) -> _LOADING:
	var paths: PackedStringArray = _variant_paths(key_entry)
	for path: String in paths:
		if not ResourceLoader.exists(path):
			_fail(_FAIL_ENGINE_LOAD, key, "engine load failed, no file: " + path)
			return null
	for index: int in paths.size():
		var error: Error = ResourceLoader.load_threaded_request(paths[index], "", false, ResourceLoader.CACHE_MODE_REUSE)
		if error != OK:
			# The started loads end here so no engine load request is left behind.
			for started: int in index:
				ResourceLoader.load_threaded_get(paths[started])
			_fail(_FAIL_ENGINE_LOAD, key, "engine load could not start: " + paths[index])
			return null
	_engine_load_count += 1
	var loading: _LOADING = _LOADING.new()
	loading.key = key
	loading.paths = paths
	_loading[key] = loading
	_run_loading_call.call_deferred(loading, _session)
	return loading


## Engine paths of the variant files of `key_entry`, from variant 1. A key with one variant has `path`. For a key with
## two or more, variant `<n>` (from 1) puts `.<n>` before the extension of `path`, so variant 1 is not `path` itself.
static func _variant_paths(key_entry: _KEY) -> PackedStringArray:
	if key_entry.variants < 2:
		return PackedStringArray([key_entry.path])
	var paths: PackedStringArray = PackedStringArray()
	var extension: String = key_entry.path.get_extension()
	var base: String = key_entry.path.get_basename()
	for number: int in range(1, key_entry.variants + 1):
		if extension.is_empty():
			paths.append(base + "." + str(number))
		else:
			paths.append(base + "." + str(number) + "." + extension)
	return paths


## Async. Started deferred by `_start_loading`. Waits frame by frame for every engine load of `loading`, then wakes
## its requests. Nothing when `session` ended before it started: `release` already ended the load.
static func _run_loading(loading: _LOADING, session: RefCounted) -> void:
	if session != _session:
		return
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	while _is_any_loading(loading.paths):
		await tree.process_frame
		if session != _session:
			return
	# No wait from here on: `release` ends the loads of `_loading` with `load_threaded_get` once.
	var resources: Array[Resource] = []
	for path: String in loading.paths:
		var loaded: bool = ResourceLoader.load_threaded_get_status(path) == ResourceLoader.THREAD_LOAD_LOADED
		var resource: Resource = ResourceLoader.load_threaded_get(path)
		if not loaded or resource == null:
			if loading.failed_path.is_empty():
				loading.failed_path = path
			continue
		resources.append(resource)
	if loading.failed_path.is_empty():
		if resources.size() == 1:
			loading.resource = resources[0]
		else:
			var variants: ResourceVariants = ResourceVariants.new()
			variants.items = resources
			loading.resource = variants
	_loading.erase(loading.key)
	loading.done = true
	loading.finished.emit()


static func _is_any_loading(paths: PackedStringArray) -> bool:
	for path: String in paths:
		if ResourceLoader.load_threaded_get_status(path) == ResourceLoader.THREAD_LOAD_IN_PROGRESS:
			return true
	return false


static func _fail(condition: String, key: String, message: String) -> void:
	var logged: String = condition + ":" + key
	if _logged.has(logged):
		return
	_logged[logged] = true
	LogCore.log_error(_TAG, message + " (key " + key + ")")


# Preload and shader warmup


## Async. One item of a preload. It counts the item when it ends.
static func _preload_item(
		request: PreloadRequest, item: PreloadRequest.Item, scope: Scope, session: RefCounted, wait: _WAIT
) -> void:
	var resource: Resource = await ResourceCore.load(item.key, item.kind, scope)
	if session != _session:
		return
	var ok: bool = resource != null and resource != _kinds[item.kind].fallback
	if item.shader_warmup:
		if item.kind != BaseKind.PACKED_SCENE and item.kind != BaseKind.MATERIAL:
			LogCore.log_error(_TAG, "shader warmup of a kind that cannot warm up: " + item.key)
			ok = false
		elif ok:
			ok = await _warm_up(item.key, resource, session)
			if session != _session:
				return
	request.done_count += 1
	if not ok:
		wait.ok = false
	wait.remaining -= 1
	if wait.remaining == 0:
		wait.finished.emit()


## Async. Shows an instance of `resource` under the loading screen for `_WARMUP_FRAMES` frames, then destroys it.
static func _warm_up(key: String, resource: Resource, session: RefCounted) -> bool:
	var instance: Node = _make_warmup_instance(resource)
	if instance == null:
		LogCore.log_error(_TAG, "shader warmup could not make an instance of " + key)
		return false
	_warmup_holder.add_child(instance)
	_warmups.append(instance)
	var wait: _WAIT = _WAIT.new()
	_waits.append(wait)
	_run_warmup_frames(wait, session)
	await wait.finished
	if session != _session:
		return false
	_waits.erase(wait)
	_warmups.erase(instance)
	_warmup_holder.remove_child(instance)
	instance.queue_free()
	return true


## Async. Emits `finished` of `wait` once the warmup frames are drawn.
static func _run_warmup_frames(wait: _WAIT, session: RefCounted) -> void:
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	for frame: int in _WARMUP_FRAMES:
		await tree.process_frame
		if session != _session:
			return
	wait.finished.emit()


static func _make_warmup_instance(resource: Resource) -> Node:
	if resource is PackedScene:
		return (resource as PackedScene).instantiate()
	var material: Material = resource as Material
	if material == null:
		return null
	var shader_mode: int = -1
	var shader_material: ShaderMaterial = material as ShaderMaterial
	if shader_material != null and shader_material.shader != null:
		shader_mode = shader_material.shader.get_mode()
	if material is CanvasItemMaterial or shader_mode == Shader.MODE_CANVAS_ITEM:
		var rect: ColorRect = ColorRect.new()
		rect.size = _WARMUP_RECT_SIZE
		rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
		rect.material = material
		return rect
	var quad: QuadMesh = QuadMesh.new()
	if material is ParticleProcessMaterial or shader_mode == Shader.MODE_PARTICLES:
		var particles: GPUParticles3D = GPUParticles3D.new()
		particles.process_material = material
		particles.draw_pass_1 = quad
		return particles
	var mesh: MeshInstance3D = MeshInstance3D.new()
	mesh.mesh = quad
	mesh.material_override = material
	return mesh


# Scope


static func _new_scope(kind: ScopeKind, scope_name: String) -> Scope:
	var scope: Scope = Scope.new()
	scope.kind = kind
	scope.name = scope_name
	_scopes.append(scope)
	return scope


static func _released_scope(kind: ScopeKind, scope_name: String) -> Scope:
	var scope: Scope = Scope.new()
	scope.kind = kind
	scope.name = scope_name
	scope.released = true
	return scope


## Scope release order: releasing, listeners, references, cache, released.
static func _release_scope(scope: Scope) -> void:
	scope.released = true
	var session: RefCounted = _session
	var listeners: Array[_LISTENER] = _listeners.duplicate()
	for listener: _LISTENER in listeners:
		if listener.removed:
			continue
		if not listener.callback.is_valid():
			if not listener.invalid_logged:
				listener.invalid_logged = true
				LogCore.log_error(_TAG, "scope release listener whose object is gone")
			continue
		listener.callback.call(scope)
		if session != _session:
			return
	_drop_references(scope)
	_scopes.erase(scope)


static func _drop_references(scope: Scope) -> void:
	var scope_id: int = scope.get_instance_id()
	for key: String in scope.keys:
		if not _cache.has(key):
			continue
		var entry: _ENTRY = _cache[key]
		entry.scope_ids.erase(scope_id)
		entry.reference_count -= 1
		if entry.reference_count <= 0:
			_cache.erase(key)
			_unwatch_cached(entry)
			_watch_leak(key, entry.resource, scope.name)
	scope.keys = PackedStringArray()


static func _find_listener(listener: Callable) -> _LISTENER:
	for entry: _LISTENER in _listeners:
		if entry.callback == listener:
			return entry
	return null


## The owner object of `watcher` is being destroyed.
static func _on_owner_deleted(watcher: _WATCHER) -> void:
	var scope: Scope = watcher.scope
	if scope == null or scope.released:
		return
	# The watcher is going with the owner object: nothing frees it again.
	if _owner_watchers.has(watcher.owner_id) and _owner_watchers[watcher.owner_id] == watcher:
		_owner_watchers.erase(watcher.owner_id)
	var session: RefCounted = _session
	# The owner object keeps its scope until the release ends: `get_owner_scope` in a listener gets the releasing one.
	_release_scope(scope)
	if session != _session:
		return
	_forget_owner_scope(watcher.owner_id, scope)


## Drops the owner scope record of the owner object `id` when it is still `scope`.
static func _forget_owner_scope(id: int, scope: Scope) -> void:
	if _owner_scopes.has(id) and _owner_scopes[id] == scope:
		_owner_scopes.erase(id)
		_owner_watchers.erase(id)


static func _free_watcher(watcher: _WATCHER) -> void:
	if not is_instance_valid(watcher):
		return
	watcher.scope = null
	var parent: Node = watcher.get_parent()
	if parent != null:
		parent.remove_child(watcher)
	watcher.free()


# Bundle


## Applies `bundle`. `_BUNDLE_SKIPPED_ATTACHED` when its key list could not be read after it was attached: an attached
## `.pck` stays until the process ends, so its files keep covering the same paths.
static func _apply_bundle(bundle: DownloadedBundle) -> int:
	if not UtilCore.is_snake_case(bundle.name):
		return _BUNDLE_SKIPPED
	var file_hash: FileResult = LocalDataCore.hash_file(bundle.path)
	if not file_hash.ok or file_hash.text != bundle.sha256:
		return _BUNDLE_SKIPPED
	var engine_path: String = LocalDataCore.resolve_engine_path(bundle.path)
	if engine_path.is_empty() or not ProjectSettings.load_resource_pack(engine_path, true):
		return _BUNDLE_SKIPPED
	var keys: Dictionary[String, _KEY] = {}
	if not _read_key_list(_BUNDLE_KEYS_FOLDER + bundle.name + ".json", keys):
		return _BUNDLE_SKIPPED_ATTACHED
	for key: String in keys:
		_bundle_keys[key] = keys[key]
	return _BUNDLE_APPLIED


## Reads a resource key list file into `out`. `false` when the file is missing or malformed.
static func _read_key_list(path: String, out: Dictionary[String, _KEY]) -> bool:
	if not FileAccess.file_exists(path):
		return false
	var file: FileAccess = FileAccess.open(path, FileAccess.READ)
	if file == null:
		return false
	var text: String = file.get_as_text()
	file.close()
	var json: JSON = JSON.new()
	if json.parse(text) != OK:
		return false
	return _parse_key_list(json.data, out)


# ogw:input_boundary
static func _parse_key_list(data: Variant, out: Dictionary[String, _KEY]) -> bool:
	if not data is Dictionary:
		return false
	var object: Dictionary = data
	var keys: Dictionary[String, _KEY] = {}
	for name: Variant in object:
		if not name is String:
			return false
		var value: Variant = object[name]
		if not value is Dictionary:
			return false
		var fields: Dictionary = value
		var path: Variant = fields.get("path")
		var variants: Variant = fields.get("variants")
		if not path is String:
			return false
		var count: int = 0
		if variants is int:
			count = variants
		elif variants is float:
			var number: float = variants
			if not is_finite(number) or number != floorf(number):
				return false
			count = int(number)
		else:
			return false
		if count < 1:
			return false
		var entry: _KEY = _KEY.new()
		entry.path = path
		entry.variants = count
		var key: String = name
		keys[key] = entry
	out.merge(keys, true)
	return true


# Kind


## Base kinds with fallbacks made in code or taken from the engine.
static func _make_base_kinds() -> Array[_KIND]:
	var image: Image = Image.create_empty(1, 1, false, Image.FORMAT_RGBA8)
	var scene: PackedScene = PackedScene.new()
	var scene_root: Node = Node.new()
	if scene.pack(scene_root) != OK:
		LogCore.log_error(_TAG, "init could not pack the PackedScene fallback")
	scene_root.free()
	var font: Font = ThemeDB.fallback_font
	if font == null:
		font = FontFile.new()
	var kinds: Array[_KIND] = []
	kinds.append(_kind(PackedScene, scene))
	kinds.append(_kind(Texture2D, ImageTexture.create_from_image(image)))
	kinds.append(_kind(AudioStream, AudioStreamWAV.new()))
	kinds.append(_kind(Font, font))
	kinds.append(_kind(Material, ShaderMaterial.new()))
	kinds.append(_kind(Shader, Shader.new()))
	kinds.append(_kind(Mesh, ArrayMesh.new()))
	kinds.append(_kind(Animation, Animation.new()))
	kinds.append(_kind(SpriteFrames, SpriteFrames.new()))
	kinds.append(_kind(TileSet, TileSet.new()))
	return kinds


static func _kind(type: Object, fallback: Resource) -> _KIND:
	var entry: _KIND = _KIND.new()
	entry.type = type
	entry.fallback = fallback
	return entry


# Leak check


## In a build with DEV code, watches `resource`, or every item of a `ResourceVariants`, for the leak check.
static func _watch_leak(key: String, resource: Resource, scope_name: String) -> void:
	if not CoreBuildInfo.has_dev_code or resource == null:
		return
	var variants: ResourceVariants = resource as ResourceVariants
	if variants == null:
		_watch_leak_resource(key, resource, scope_name)
		return
	for item: Resource in variants.items:
		_watch_leak_resource(key, item, scope_name)


static func _watch_leak_resource(key: String, resource: Resource, scope_name: String) -> void:
	var leak: _LEAK = _LEAK.new()
	leak.reference = weakref(resource)
	leak.key = key
	leak.scope_name = scope_name
	leak.frame = Engine.get_process_frames()
	leak.left_usec = _audio_clock.get_ticks_usec()
	leak.audio = resource is AudioStream
	if leak.audio:
		_unmixed_audio_count += 1
	_leaks.append(leak)


## Frame check: counts the last audio driver callback for the audio streams that wait for a new audio mix, then
## queues the leak check for the end of this frame when a resource is due.
static func _on_frame() -> void:
	if _leaks.is_empty():
		return
	var frame: int = Engine.get_process_frames()
	if _unmixed_audio_count > 0:
		_mark_mixed(frame)
	if _leak_check_queued:
		return
	for leak: _LEAK in _leaks:
		if _is_due(leak, frame):
			_leak_check_queued = true
			_leak_check.call_deferred()
			return


## Reads the start and the frame count of the last audio driver callback, and adds the frame count to each audio
## stream that left the cache before that start and has not counted it. A stream whose sum passed `_MIX_SIZE_FRAMES`
## gets `mixed_frame`: the audio server mixes `_MIX_SIZE_FRAMES` frames at once and hands them out over the callbacks,
## so it mixed again since the stream left. A frame sees only the last of the callbacks since the frame before, so the
## sum is a lower bound of the frames handed out.
static func _mark_mixed(frame: int) -> void:
	# Each start reads the ticks before `get_time_since_last_mix`, so it is not later than the callback start and a
	# callback that started before the drop does not count. The frame count adds the first read, taken before
	# `get_time_to_next_mix`, so it is not more than the callback's frames.
	var first_ticks: int = _audio_clock.get_ticks_usec()
	var first_since: float = _audio_clock.get_time_since_last_mix()
	var to_next: float = _audio_clock.get_time_to_next_mix()
	var second_ticks: int = _audio_clock.get_ticks_usec()
	var second_since: float = _audio_clock.get_time_since_last_mix()
	var rate: float = _audio_clock.get_mix_rate()
	var start_usec: int = first_ticks - roundi(first_since * 1000000.0)
	var same_usec: int = int(_SAME_CALLBACK_FRAMES * 1000000.0 / rate) if rate > 0.0 else 0
	if absi(second_ticks - roundi(second_since * 1000000.0) - start_usec) > same_usec:
		return
	var frames: int = floori((to_next + first_since) * rate)
	if frames <= 0:
		return
	for leak: _LEAK in _leaks:
		if not leak.audio or leak.mixed_frame >= 0 or start_usec <= leak.left_usec:
			continue
		if leak.counted_callback_usec >= 0 and absi(start_usec - leak.counted_callback_usec) <= same_usec:
			continue
		leak.counted_callback_usec = start_usec
		leak.mix_frames += frames
		if leak.mix_frames > _MIX_SIZE_FRAMES:
			leak.mixed_frame = frame
			_unmixed_audio_count -= 1


## The frame the resource left the cache ended, so the objects queued for deletion in it are freed. An audio stream
## instead waits for the end of the frame that saw the audio server mix again since it left the cache: a stopped
## playback holds its stream until the audio server mixes it out, and the main thread frees the playback in
## `AudioServer.update` at the frame end after that mix.
static func _is_due(leak: _LEAK, frame: int) -> bool:
	if leak.frame >= frame:
		return false
	if not leak.audio:
		return true
	return (leak.mixed_frame >= 0 and leak.mixed_frame < frame) or leak.reference.get_ref() == null


static func _check_leaks() -> void:
	_leak_check_queued = false
	if not _is_initialized:
		return
	_judge_leaks()


## Logs the due resources of `_leaks` that a living object still references, and drops them from `_leaks`.
static func _judge_leaks() -> void:
	if _leaks.is_empty():
		return
	var frame: int = Engine.get_process_frames()
	var leaks: Array[_LEAK] = []
	var later: Array[_LEAK] = []
	for leak: _LEAK in _leaks:
		if _is_due(leak, frame):
			leaks.append(leak)
		else:
			later.append(leak)
	_leaks = later
	_unmixed_audio_count = 0
	for leak: _LEAK in later:
		if leak.audio and leak.mixed_frame < 0:
			_unmixed_audio_count += 1
	for leak: _LEAK in leaks:
		var alive: Object = leak.reference.get_ref()
		var resource: Resource = alive as Resource
		if (
				resource == null
				or _cached_resources.has(resource.get_instance_id())
				or _cached_dependencies.has(resource.resource_path)
		):
			continue
		LogCore.log_error(_TAG, "leak: " + leak.key + " is referenced after scope " + leak.scope_name + " dropped it")


## In a build with DEV code, counts the resource of `entry`, or every item of a `ResourceVariants`, in the leak check's
## cached resources and reads the engine paths its resource file references, once while it is cached.
static func _watch_cached(entry: _ENTRY) -> void:
	if not CoreBuildInfo.has_dev_code:
		return
	var variants: ResourceVariants = entry.resource as ResourceVariants
	if variants == null:
		_watch_cached_resource(entry, entry.resource)
		return
	for item: Resource in variants.items:
		_watch_cached_resource(entry, item)


static func _watch_cached_resource(entry: _ENTRY, resource: Resource) -> void:
	var id: int = resource.get_instance_id()
	if _cached_resources.has(id):
		_cached_resources[id] += 1
	else:
		_cached_resources[id] = 1
	if resource.resource_path.is_empty():
		return
	for dependency: String in ResourceLoader.get_dependencies(resource.resource_path):
		var path: String = dependency.get_slice("::", dependency.get_slice_count("::") - 1)
		if path.is_empty() or entry.dependencies.has(path):
			continue
		entry.dependencies.append(path)
		if _cached_dependencies.has(path):
			_cached_dependencies[path] += 1
		else:
			_cached_dependencies[path] = 1


## Takes `entry`, which left the cache, out of the counts of `_watch_cached`.
static func _unwatch_cached(entry: _ENTRY) -> void:
	if not CoreBuildInfo.has_dev_code:
		return
	var variants: ResourceVariants = entry.resource as ResourceVariants
	if variants == null:
		_unwatch_cached_resource(entry.resource)
	else:
		for item: Resource in variants.items:
			_unwatch_cached_resource(item)
	for path: String in entry.dependencies:
		if _cached_dependencies.has(path):
			_cached_dependencies[path] -= 1
			if _cached_dependencies[path] <= 0:
				_cached_dependencies.erase(path)


static func _unwatch_cached_resource(resource: Resource) -> void:
	var id: int = resource.get_instance_id()
	if _cached_resources.has(id):
		_cached_resources[id] -= 1
		if _cached_resources[id] <= 0:
			_cached_resources.erase(id)


# Lifecycle


static func _on_node_exit(node: Node) -> void:
	if not _is_initialized or node != _node:
		return
	_clean_up()


## The leak check of the resources whose wait ended, the `release` processing order, then the initial values of every
## static var. The other resources of the leak check are not judged.
static func _clean_up() -> void:
	_judge_leaks()
	_is_initialized = false
	_session = null
	for loading: _LOADING in _loading.values():
		loading.finished.emit()
	for wait: _WAIT in _waits.duplicate():
		wait.finished.emit()
	for instance: Node in _warmups:
		if is_instance_valid(instance):
			var parent: Node = instance.get_parent()
			if parent != null:
				parent.remove_child(instance)
			instance.free()
	for scope: Scope in _scopes:
		scope.released = true
		scope.keys = PackedStringArray()
	for id: int in _owner_watchers:
		_free_watcher(_owner_watchers[id])
	for loading: _LOADING in _loading.values():
		for path: String in loading.paths:
			ResourceLoader.load_threaded_get(path)
	_reset()


static func _reset() -> void:
	_session = null
	_node = null
	_warmup_holder = null
	_kinds = []
	_key_list = {}
	_bundle_keys = {}
	_test_key_list = {}
	_test_variants = {}
	_has_test_key_list = false
	_global_scope = null
	_scopes = []
	_owner_scopes = {}
	_owner_watchers = {}
	_listeners = []
	_cache = {}
	_loading = {}
	_run_loading_call = Callable()
	_waits = []
	_warmups = []
	_running_preloads = []
	_bundles_applied = false
	_load_requested = false
	_logged = {}
	_engine_load_count = 0
	_test_typed_array_parse_observer = Callable()
	_leaks = []
	_unmixed_audio_count = 0
	_audio_clock = null
	_leak_check_queued = false
	_leak_check = Callable()
	_cached_resources = {}
	_cached_dependencies = {}
	_is_initialized = false
