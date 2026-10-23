class_name BootstrapCore
extends RefCounted
## Build info, the boot order from app start to the first scene, the `init` and `release` order of the modules, the
## content entry, the fatal error screen, restart without running the app again, and app exit. Not in the module
## list and has no lifecycle.

enum BootStage {
	NONE,
	INIT_MODULES,
	LOAD_DATA,
	PREPARE,
	TITLE_SCENE,
	UPDATE,
	APPLY_UPDATE,
	CONTENT_INIT,
	LOGIN,
	AFTER_LOGIN,
	FIRST_SCENE,
	DONE,
	HALTED,
}

const _TAG: String = "BootstrapCore"
const _BUILD_INFO_PATH: String = "res://generated/build_info.json"
const _BLOCK_REASON: String = "boot"
const _FATAL_SCREEN_TEXT: String = "The game could not start. Close the app and open it again."
## Canvas layer of the fatal screen while `UICore` is not initialized: there is no UI layer, and it is above the
## world. While `UICore` is initialized the fatal screen is on the `Fatal` UI layer, under the `Debug` layer.
const _FATAL_SCREEN_LAYER: int = 127
const _FATAL_SCREEN_NAME: String = "BootstrapFatalScreen"
const _ENVIRONMENTS: PackedStringArray = ["LOCAL", "DEV", "STG", "PROD"]
const _PLATFORMS: PackedStringArray = ["android", "ios", "web", "windows", "macos", "linux"]
const _STAGE_NAMES: PackedStringArray = [
	"None",
	"InitModules",
	"LoadData",
	"Prepare",
	"TitleScene",
	"Update",
	"ApplyUpdate",
	"ContentInit",
	"Login",
	"AfterLogin",
	"FirstScene",
	"Done",
	"Halted",
]
## Adapter keys and adapter names of the module specs.
const _FAKE_ADAPTER: String = "fake"
const _ADAPTER_LOGIN_APPLE: String = "login-apple"
const _ADAPTER_LOGIN_GOOGLE: String = "login-google"
const _ADAPTER_PUSH_FCM: String = "push-fcm"
const _ADAPTER_PUSH_APNS: String = "push-apns"
const _ADAPTER_PUSH_APNS_SANDBOX: String = "push-apns-sandbox"
const _ADAPTER_IAP_APPLE: String = "iap-apple"
const _ADAPTER_IAP_GOOGLE: String = "iap-google"
const _ADAPTER_ADS: String = "ads"
const _ADAPTER_ADS_ADMOB: String = "ads-admob"
const _NATIVE_UI_PLUGIN_PLATFORMS: PackedStringArray = ["android", "ios", "macos"]
const _SETTING_TITLE_SCENE: String = "titleScene"
const _SETTING_FIRST_SCENE: String = "firstScene"
const _SETTING_RELAY_ONLY: String = "BootstrapCore.realtimeRelayOnly"
const _UNIT_TEST_CORE: String = "UnitTestCore"

const _FAILURE_POPUP_NONE: int = 0
const _FAILURE_POPUP_OPENING: int = 1
const _FAILURE_POPUP_OPEN: int = 2

const _CORE_NODE := preload("res://core/bootstrap_core/bootstrap_core_node.gd")
const _DEV_HOOKS := preload("res://core/bootstrap_core/bootstrap_dev_hooks.gd")
const _UPDATE_SET := preload("res://core/bootstrap_core/update_set.gd")

static var _node: _CORE_NODE = null
static var _dev: _DEV_HOOKS = null
static var _dev_searched: bool = false
## Current boot. A new object on every halt, so a boot that waited on an operation stops when it resumes.
static var _session: RefCounted = RefCounted.new()
static var _stage: BootStage = BootStage.NONE
static var _started: bool = false
static var _content: ContentEntry = null
static var _modules: Array[CoreModuleEntry] = []
static var _entries: Dictionary[String, CoreModuleEntry] = {}
static var _replacements: RefCounted = null
static var _build_info: BuildInfo = null
static var _is_dev_run: bool = false
static var _dev_access: String = ""
static var _update_set: _UPDATE_SET = _UPDATE_SET.new()
static var _is_update_reboot: bool = false
static var _title_scene: String = ""
static var _relay_only: bool = false
static var _boot_entry_scene: Node = null
static var _boot_started_ms: int = 0
static var _stage_started_ms: int = 0
static var _content_inited: bool = false
static var _ui_ready: bool = false
static var _has_boot_block: bool = false
static var _boot_block: int = 0
static var _restart_pending: bool = false
static var _exited: bool = false
static var _fatal_screen: Node = null
static var _fatal_screen_shown: bool = false
static var _failure_popup: int = _FAILURE_POPUP_NONE
static var _popup_serial: int = 0
static var _popup_pressed: bool = false
static var _login_result: LoginResult = null
static var _collecting_logs: bool = false
static var _pending_log_errors: Array[bool] = []
static var _pending_log_messages: PackedStringArray = PackedStringArray()

## DEV state. Launch values by name, read once from the launch value file.
static var _launch_values: Dictionary[String, String] = {}
static var _launch_values_read: bool = false
## Core test state. When true, a process end request is counted instead of sent to the engine.
static var _test_hold_quit: bool = false
static var _quit_request_count: int = 0
## Core test state. Each operation `BootstrapCore` calls on another module, as `<Module>.<operation>`, in call
## order. Kept only while `_trace_enabled` is true.
static var _trace_enabled: bool = false
static var _trace: PackedStringArray = PackedStringArray()
## Core test state. The adapter of the last `set_*_adapter` call `BootstrapCore` made on another module while
## `_trace_enabled` is true, by its trace entry (`AuthCore.set_social_adapter:<provider>` for a social adapter), and
## the ad units it passed with the ads adapter.
static var _traced_adapters: Dictionary[String, RefCounted] = {}
static var _traced_ad_units: Dictionary[int, String] = {}
## Core test state. The realtime transport of the last boot, as `p2p relay_only=<bool>` wrapped by the DEV code, or
## empty when the test realtime transport was passed.
static var _realtime_transport_kind: String = ""
## Core test state. When not null, `ApplyUpdate` takes this set as the files `GameUpdateCore` downloaded, before the
## update downloads of the held test replacements.
static var _test_downloads: _UPDATE_SET = null
## Core test state. When not empty, `InitModules` 1 reads the build info file at this path instead of the build info
## file of the build.
static var _test_build_info_path: String = ""


## Starts the boot. `modules` empty means the generated module list. `replacements` holds the test replacements
## and works only in a build with DEV code. A build with DEV code adds its DEV modules at the end of the module list
## of a boot without test replacements.
static func start_boot(
		content: ContentEntry,
		modules: Array[CoreModuleEntry] = [],
		replacements: RefCounted = null
) -> void:
	_ensure_node()
	_find_dev()
	if _exited:
		return
	if _started:
		LogCore.log_error(_TAG, "start_boot called again without shutdown")
		return
	if content == null:
		LogCore.log_error(_TAG, "start_boot without a content entry")
		return
	_started = true
	_content = content
	_pending_log_errors.clear()
	_pending_log_messages.clear()
	if modules.is_empty():
		_modules = _generated_modules()
		var tree := Engine.get_main_loop() as SceneTree
		_boot_entry_scene = tree.current_scene
	else:
		_modules = modules.duplicate()
	if replacements != null:
		if _dev == null:
			_pending_log_errors.append(true)
			_pending_log_messages.append("start_boot received test replacements in a build without DEV code")
		else:
			_replacements = replacements
	elif _dev != null:
		_add_dev_modules()
	_entries.clear()
	for entry: CoreModuleEntry in _modules:
		_entries[entry.name] = entry
	_run_boot(false)


## Adds the DEV modules the module list does not hold at its end.
static func _add_dev_modules() -> void:
	for dev_entry: CoreModuleEntry in _dev.dev_modules():
		var held := false
		for entry: CoreModuleEntry in _modules:
			if entry.name == dev_entry.name:
				held = true
		if not held:
			_modules.append(dev_entry)


## Asks for a restart from the content code.
static func request_restart() -> void:
	_on_restart_request("content")


## Reports an unrecoverable failure from the content code. `reason` is English.
static func report_fatal(reason: String) -> void:
	_fatal("content", reason)


## Current boot stage.
static func boot_stage() -> BootStage:
	return _stage


## Build info read in `InitModules` 1. All fields empty before it is read.
static func get_build_info() -> BuildInfo:
	if _build_info == null:
		return BuildInfo.new()
	return _build_info.duplicate_info()


## Game settings `firstScene`. Empty when it cannot be read.
static func get_first_scene() -> String:
	return CoreSettings.get_string(_SETTING_FIRST_SCENE)


# --- boot order ---


static func _run_boot(update_reboot: bool) -> void:
	_session = RefCounted.new()
	var session: RefCounted = _session
	_boot_started_ms = Time.get_ticks_msec()
	_restart_pending = false
	_is_update_reboot = update_reboot
	_content_inited = false
	_ui_ready = false
	_fatal_screen_shown = false
	_failure_popup = _FAILURE_POPUP_NONE
	_login_result = null
	if not _init_modules() or session != _session:
		return
	await _load_data(session)
	if session != _session:
		return
	await _prepare(session)
	if session != _session:
		return
	var titled: bool = await _title_scene_stage(session)
	if not titled:
		return
	if not _is_update_reboot:
		var updated: bool = await _update_stage(session)
		if session != _session:
			return
		if updated and _apply_update_stage():
			return
	if not _content_init_stage() or session != _session:
		return
	var logged_in: bool = await _login_stage(session)
	if not logged_in:
		return
	_after_login_stage()
	if session != _session:
		return
	var first: bool = await _first_scene_stage(session)
	if not first:
		return
	_stage = BootStage.DONE
	if _is_initialized("EventCore"):
		var event := EventCore.acquire(BootCompletedEvent) as BootCompletedEvent
		if event != null:
			event.duration_ms = Time.get_ticks_msec() - _boot_started_ms
			EventCore.publish(event)


static func _init_modules() -> bool:
	var session: RefCounted = _session
	_begin_stage(BootStage.INIT_MODULES)
	_collecting_logs = true
	_find_dev()
	var ok := true
	if _build_info == null:
		ok = _read_build_info()
	if ok:
		CoreBuildInfo.platform = _build_info.platform
		CoreBuildInfo.storage_root = _storage_root(_build_info.instance_id)
		ok = _read_settings()
	if not ok:
		_collecting_logs = false
		if _entries.has("LogCore"):
			_trace_call("LogCore.init")
			_to_bool(_entries["LogCore"].init.call())
		_flush_pending_logs()
		_fatal(_TAG, "build info or settings could not be read")
		return false
	_pass_adapters()
	for entry: CoreModuleEntry in _modules:
		_trace_call("%s.init" % entry.name)
		var inited := _to_bool(entry.init.call())
		if entry.name == "LogCore" and inited:
			_collecting_logs = false
			_flush_pending_logs()
		if not inited:
			_collecting_logs = false
			_flush_pending_logs()
			if session == _session:
				_fatal(entry.name, "init failed")
			return false
		if entry.name == "EventCore":
			EventCore.subscribe(RestartRequestedEvent, _node._on_restart_requested)
			EventCore.subscribe(FatalErrorRequestedEvent, _node._on_fatal_requested)
		elif entry.name == "UICore":
			EventCore.subscribe(ExitConfirmedEvent, _node._on_exit_confirmed)
		if session != _session:
			_collecting_logs = false
			_flush_pending_logs()
			return false
	_collecting_logs = false
	_flush_pending_logs()
	# A halt stops the operations after it: each check follows one operation or DEV call that may halt the boot.
	if _dev != null:
		_dev.after_init_modules()
		if session != _session:
			return false
	if _has("LocalDataCore"):
		_trace_call("LocalDataCore.load_device_file")
		LocalDataCore.load_device_file()
		if session != _session:
			return false
	if _has("NetworkCore"):
		_trace_call("NetworkCore.set_server_info")
		var server_info_set := NetworkCore.set_server_info(_build_info.server_url, _build_info.app_version, _build_info.platform)
		if session != _session:
			return false
		if not server_info_set:
			_fatal("NetworkCore", "set_server_info failed")
			return false
	if _dev != null:
		_dev.after_server_info()
		if session != _session:
			return false
	if _has("ResolutionCore"):
		_trace_call("ResolutionCore.apply_saved_screen_mode")
		ResolutionCore.apply_saved_screen_mode()
		if session != _session:
			return false
	if _has("InputCore"):
		_trace_call("InputCore.load_keys")
		InputCore.load_keys()
		if session != _session:
			return false
	if _has("SoundCore"):
		_trace_call("SoundCore.load_volume_settings")
		SoundCore.load_volume_settings()
		if session != _session:
			return false
	if _has("QualityCore"):
		_trace_call("QualityCore.apply_saved_level")
		QualityCore.apply_saved_level()
		if session != _session:
			return false
	if _has("AccessibilityCore"):
		_trace_call("AccessibilityCore.apply_saved_settings")
		AccessibilityCore.apply_saved_settings()
		if session != _session:
			return false
	if not _update_set.bundles.is_empty() and _has("ResourceCore"):
		_trace_call("ResourceCore.apply_bundles")
		ResourceCore.apply_bundles(_update_set.bundles)
		if session != _session:
			return false
	if _has("ResolutionCore"):
		_trace_call("ResolutionCore.load_fill_image")
		ResolutionCore.load_fill_image()
		if session != _session:
			return false
	_end_stage()
	return true


static func _load_data(session: RefCounted) -> void:
	_begin_stage(BootStage.LOAD_DATA)
	if _has("DataCore"):
		_trace_call("DataCore.load")
		var loaded: bool = await DataCore.load(_update_set.data)
		if session != _session:
			return
		if not loaded:
			_fatal("DataCore", "load failed")
			return
	if _has("LocalizationCore"):
		_trace_call("LocalizationCore.resolve_language")
		var language := LocalizationCore.resolve_language()
		if session != _session:
			return
		if language == 0:
			_fatal("LocalizationCore", "resolve_language failed")
			return
		_trace_call("LocalizationCore.load_translation")
		var translated: bool = await LocalizationCore.load_translation(_update_set.translations)
		if session != _session:
			return
		if not translated:
			_fatal("LocalizationCore", "load_translation failed")
			return
		_trace_call("LocalizationCore.load_fonts")
		await LocalizationCore.load_fonts()
		if session != _session:
			return
		_trace_call("LocalizationCore.load_prompt_icons")
		await LocalizationCore.load_prompt_icons()
		if session != _session:
			return
	_end_stage()


static func _prepare(session: RefCounted) -> void:
	_begin_stage(BootStage.PREPARE)
	_set_boot_block()
	if _has("UICore"):
		_trace_call("UICore.prepare")
		var ui_ok: bool = await UICore.prepare()
		if session != _session:
			return
		if not ui_ok:
			_log_error("UICore prepare failed")
	if _has("MessageCore"):
		_trace_call("MessageCore.prepare")
		var message_ok: bool = await MessageCore.prepare()
		if session != _session:
			return
		if not message_ok:
			_log_error("MessageCore prepare failed")
	if _has("BadgeCore"):
		_trace_call("BadgeCore.prepare")
		var badge_ok: bool = await BadgeCore.prepare()
		if session != _session:
			return
		if not badge_ok:
			_log_error("BadgeCore prepare failed")
	_ui_ready = true
	_release_boot_block()
	_end_stage()


static func _title_scene_stage(session: RefCounted) -> bool:
	_begin_stage(BootStage.TITLE_SCENE)
	if _has("SceneCore"):
		_trace_call("SceneCore.boot_change_scene")
		var changed: bool = await SceneCore.boot_change_scene(_title_scene, null)
		if session != _session:
			return false
		if not changed:
			_fatal("SceneCore", "boot_change_scene failed")
			return false
		if is_instance_valid(_boot_entry_scene):
			_boot_entry_scene.queue_free()
		_boot_entry_scene = null
	_end_stage()
	return true


## Returns whether `check_update` succeeded.
static func _update_stage(session: RefCounted) -> bool:
	_begin_stage(BootStage.UPDATE)
	if not _has("GameUpdateCore"):
		_end_stage()
		return false
	var source := UpdateSource.new()
	source.app_version = _build_info.app_version
	source.environment = _build_info.environment
	source.platform = _build_info.platform
	source.game_update_url = _build_info.game_update_url
	source.update_trust_keys = _build_info.update_trust_keys.duplicate()
	_trace_call("GameUpdateCore.check_update")
	var checked: bool = await GameUpdateCore.check_update(source)
	if session != _session:
		return false
	if not checked:
		_log_error("check_update failed")
	_end_stage()
	return checked


## Returns whether it started an update reboot.
static func _apply_update_stage() -> bool:
	_begin_stage(BootStage.APPLY_UPDATE)
	_set_boot_block()
	_trace_call("GameUpdateCore.downloaded_data")
	var data: DownloadedData = GameUpdateCore.downloaded_data()
	_trace_call("GameUpdateCore.downloaded_translations")
	var translations: Array[DownloadedTranslation] = GameUpdateCore.downloaded_translations()
	_trace_call("GameUpdateCore.downloaded_bundles")
	var bundles: Array[DownloadedBundle] = GameUpdateCore.downloaded_bundles()
	var test_downloads: _UPDATE_SET = _test_downloads
	if test_downloads == null and _dev != null:
		test_downloads = _dev.test_update_downloads()
	if test_downloads != null:
		data = test_downloads.data
		translations = test_downloads.translations
		bundles = test_downloads.bundles
	if not _update_set.same_as(data, translations, bundles):
		var next := _UPDATE_SET.new()
		next.data = data
		next.translations = translations
		next.bundles = bundles
		_update_set = next
		_halt()
		_teardown()
		_run_boot(true)
		return true
	_release_boot_block()
	_end_stage()
	return false


## Returns false when the boot halted in it.
static func _content_init_stage() -> bool:
	var session: RefCounted = _session
	_begin_stage(BootStage.CONTENT_INIT)
	_set_boot_block()
	_content_inited = true
	_trace_call("content.content_init")
	var mark: int = CoreScriptErrors.begin()
	var inited := _to_bool(_content.content_init.call())
	var threw: bool = CoreScriptErrors.end(mark)
	if session != _session:
		return false
	if threw:
		_log_error("content_init threw")
	elif not inited:
		_log_error("content_init failed")
	if _has("DataCore"):
		_trace_call("DataCore.build_derived_containers")
		var built := DataCore.build_derived_containers()
		if session != _session:
			return false
		if not built:
			_fatal("DataCore", "build_derived_containers failed")
			return false
	if _dev != null:
		_dev.after_derived_containers()
		if session != _session:
			return false
	_release_boot_block()
	_end_stage()
	return true


static func _login_stage(session: RefCounted) -> bool:
	_begin_stage(BootStage.LOGIN)
	if _has("NoticeCore"):
		_trace_call("NoticeCore.wait_maintenance_clear")
		await NoticeCore.wait_maintenance_clear()
		if session != _session:
			return false
	if _has("AuthCore"):
		var result: LoginResult = null
		if _dev != null and _dev.dev_account() != "":
			_trace_call("AuthCore.dev_login")
			result = await _dev.dev_login()
		else:
			_trace_call("AuthCore.boot_login")
			result = await AuthCore.boot_login()
		if session != _session:
			return false
		if result == null or result.status != AuthCore.LoginStatus.SUCCESS:
			_login_failed(result)
			return false
	_end_stage()
	return true


## `AfterLogin`. A halt from one of its calls skips the calls after it.
static func _after_login_stage() -> void:
	var session: RefCounted = _session
	_begin_stage(BootStage.AFTER_LOGIN)
	_set_boot_block()
	if _has("LocalDataCore") and _has("AuthCore"):
		_trace_call("LocalDataCore.load_user_file")
		LocalDataCore.load_user_file(AuthCore.get_user_id())
	if session == _session and _has("BadgeCore"):
		_trace_call("BadgeCore.load_saved")
		BadgeCore.load_saved()
	if session == _session and _has("PaymentCore"):
		_trace_call("PaymentCore.recover_purchases")
		PaymentCore.recover_purchases()
	if session == _session and _has("AdCore"):
		_trace_call("AdCore.start")
		AdCore.start()
	if session == _session and _has("ChatCore"):
		_trace_call("ChatCore.start")
		ChatCore.start()
	if session != _session:
		return
	_release_boot_block()
	_end_stage()


static func _first_scene_stage(session: RefCounted) -> bool:
	_begin_stage(BootStage.FIRST_SCENE)
	_trace_call("content.select_first_scene")
	var mark: int = CoreScriptErrors.begin()
	var scene_key := _to_string_value(_content.select_first_scene.call())
	var threw: bool = CoreScriptErrors.end(mark)
	if session != _session:
		return false
	if threw:
		_log_error("select_first_scene threw; game settings firstScene is used")
		scene_key = get_first_scene()
	elif scene_key.is_empty():
		_log_error("select_first_scene failed; game settings firstScene is used")
		scene_key = get_first_scene()
	if _has("SceneCore"):
		_trace_call("SceneCore.change_scene")
		var changed: bool = await SceneCore.change_scene(scene_key, null)
		if session != _session:
			return false
		if not changed:
			_fatal("SceneCore", "change_scene to the first scene failed")
			return false
	_end_stage()
	return true


static func _begin_stage(stage: BootStage) -> void:
	_stage = stage
	_trace_call("stage:%s" % _STAGE_NAMES[stage])
	_stage_started_ms = Time.get_ticks_msec()


static func _end_stage() -> void:
	var elapsed := Time.get_ticks_msec() - _stage_started_ms
	_log_info("stage %s %d ms" % [_STAGE_NAMES[_stage], elapsed])


# --- InitModules 1 and 2 ---


## Reads the build info into `_build_info`. Returns false after leaving the error log.
static func _read_build_info() -> bool:
	var path := _BUILD_INFO_PATH if _test_build_info_path.is_empty() else _test_build_info_path
	if FileAccess.file_exists(path):
		_is_dev_run = false
		var info := _parse_build_info(FileAccess.get_file_as_string(path))
		if info == null:
			_log_error("build info file %s has a wrong format" % path)
			return false
		_build_info = info
		return true
	if _dev == null:
		_log_error("build info file %s could not be read" % path)
		return false
	_is_dev_run = true
	var dev_info := _dev.make_dev_build_info()
	if dev_info == null:
		return false
	_build_info = dev_info
	return true


# ogw:input_boundary
static func _parse_build_info(text: String) -> BuildInfo:
	var parsed: Variant = JSON.parse_string(text)
	if not parsed is Dictionary:
		return null
	var map: Dictionary = parsed
	var info := BuildInfo.new()
	for key: String in ["app_id", "app_version", "environment", "platform", "server_url", "game_update_url", "instance_id"]:
		if not map.get(key) is String:
			return null
	info.app_id = map["app_id"]
	info.app_version = map["app_version"]
	info.environment = map["environment"]
	info.platform = map["platform"]
	info.server_url = map["server_url"]
	info.game_update_url = map["game_update_url"]
	info.instance_id = map["instance_id"]
	if not _is_version(info.app_version) or not info.environment in _ENVIRONMENTS or not info.platform in _PLATFORMS:
		return null
	var keys: Variant = map.get("update_trust_keys")
	if not keys is Array:
		return null
	for item: Variant in keys:
		if not item is Dictionary:
			return null
		var pair: Dictionary = item
		var key_id: Variant = pair.get("key_id")
		var public_key: Variant = pair.get("public_key")
		if not key_id is String or not public_key is String:
			return null
		var key_id_text: String = key_id
		var public_key_text: String = public_key
		info.update_trust_keys[key_id_text] = public_key_text
	var adapters: Variant = map.get("adapters")
	if not adapters is Dictionary:
		return null
	var adapter_map: Dictionary = adapters
	for adapter_key: Variant in adapter_map.keys():
		var adapter_name: Variant = adapter_map[adapter_key]
		if not adapter_key is String or not adapter_name is String:
			return null
		var adapter_key_text: String = adapter_key
		var adapter_name_text: String = adapter_name
		info.adapters[adapter_key_text] = adapter_name_text
	var units: Variant = map.get("ad_units")
	if not units is Dictionary:
		return null
	var unit_map: Dictionary = units
	for placement: Variant in unit_map.keys():
		var unit_id: Variant = unit_map[placement]
		if not placement is String or not unit_id is String:
			return null
		var placement_text: String = placement
		var unit_id_text: String = unit_id
		if not placement_text.is_valid_int():
			return null
		info.ad_units[placement_text.to_int()] = unit_id_text
	var dev_access: Variant = map.get("dev_access", "")
	if not dev_access is String:
		return null
	_dev_access = dev_access
	return info


static func _is_version(text: String) -> bool:
	var parts := text.split(".")
	if parts.size() != 3:
		return false
	for part: String in parts:
		if part.is_empty() or not part.is_valid_int() or part.begins_with("-") or part.begins_with("+"):
			return false
	return true


## Reads this module's settings for this boot. Returns false after leaving the error log.
static func _read_settings() -> bool:
	var ok := true
	for key: String in [_SETTING_TITLE_SCENE, _SETTING_FIRST_SCENE]:
		if not CoreSettings.has_string(key):
			_log_error("setting %s is missing or not a string" % key)
			ok = false
	if not CoreSettings.has_bool(_SETTING_RELAY_ONLY):
		_log_error("setting %s is missing or not a boolean" % _SETTING_RELAY_ONLY)
		ok = false
	if not ok:
		return false
	_title_scene = CoreSettings.get_string(_SETTING_TITLE_SCENE)
	_relay_only = CoreSettings.get_bool(_SETTING_RELAY_ONLY)
	return true


static func _storage_root(instance_id: String) -> String:
	if instance_id.is_empty():
		return CoreBuildInfo.DEFAULT_STORAGE_ROOT
	return "%sinstances/%s/" % [CoreBuildInfo.DEFAULT_STORAGE_ROOT, instance_id]


static func _storage_scope() -> String:
	var scope := "%s.%s" % [_build_info.app_id, _build_info.environment]
	if not _build_info.instance_id.is_empty():
		scope = "%s.%s" % [scope, _build_info.instance_id]
	return scope


## `InitModules` 2: the adapters, the realtime transport and the test replacements, before every module `init`.
static func _pass_adapters() -> void:
	if _has("AuthCore"):
		_trace_call("AuthCore.set_storage_scope")
		AuthCore.set_storage_scope(_storage_scope())
		if _dev != null:
			_dev.pass_dev_token_storage()
		_pass_social_adapter(_ADAPTER_LOGIN_APPLE, CoreContract.LoginProvider.LOGIN_PROVIDER_APPLE, ["ios", "macos"])
		_pass_social_adapter(_ADAPTER_LOGIN_GOOGLE, CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE, _PLATFORMS)
	if _has("PushCore"):
		_pass_push_adapter()
		_pass_notification_adapter()
	if _has("PaymentCore"):
		_pass_store_adapter()
	if _has("AdCore"):
		_pass_ads_adapter()
	if _has("RealtimeCore"):
		_pass_realtime_transport()
	if _has("NativeUiCore"):
		_pass_native_adapter()
	if _dev != null:
		_dev.apply_test_replacements()


## `AuthCore` social adapter of adapter key `key`: `fake` is the DEV fake adapter, the key itself is the real adapter
## on `platforms`.
static func _pass_social_adapter(key: String, provider: CoreContract.LoginProvider, platforms: PackedStringArray) -> void:
	if not _build_info.adapters.has(key):
		return
	var value: String = _build_info.adapters[key]
	var adapter: SocialAdapter = null
	if value == _FAKE_ADAPTER:
		if _dev != null:
			adapter = _dev.make_fake_social_adapter()
	elif value == key and _build_info.platform in platforms:
		if key == _ADAPTER_LOGIN_APPLE:
			adapter = LoginAppleAdapter.new()
		else:
			adapter = LoginGoogleAdapter.new()
	else:
		return
	if adapter == null:
		_adapter_not_passed(key, value)
		return
	_trace_call("AuthCore.set_social_adapter")
	_trace_adapter("AuthCore.set_social_adapter:%d" % provider, adapter)
	AuthCore.set_social_adapter(provider, adapter)


## `PushCore` push adapter: adapter key `push-fcm` on `android`, `push-apns` on `ios`.
static func _pass_push_adapter() -> void:
	var key := ""
	if _build_info.platform == "android":
		key = _ADAPTER_PUSH_FCM
	elif _build_info.platform == "ios":
		key = _ADAPTER_PUSH_APNS
	if key.is_empty() or not _build_info.adapters.has(key):
		return
	var value: String = _build_info.adapters[key]
	var adapter: PushAdapter = null
	if value == _FAKE_ADAPTER:
		if _dev != null:
			adapter = _dev.make_fake_push_adapter()
	elif key == _ADAPTER_PUSH_FCM and value == _ADAPTER_PUSH_FCM:
		adapter = PushFcmAdapter.new()
	elif key == _ADAPTER_PUSH_APNS and (value == _ADAPTER_PUSH_APNS or value == _ADAPTER_PUSH_APNS_SANDBOX):
		adapter = PushApnsAdapter.new()
	else:
		return
	if adapter == null:
		_adapter_not_passed(key, value)
		return
	_trace_call("PushCore.set_push_adapter")
	_trace_adapter("PushCore.set_push_adapter", adapter)
	PushCore.set_push_adapter(adapter)


## `PushCore` notification adapter: the DEV fake adapter in a dev run, the platform adapter on `android` and `ios`.
static func _pass_notification_adapter() -> void:
	var adapter: NotificationAdapter = null
	if _is_dev_run:
		if _dev != null:
			adapter = _dev.make_fake_notification_adapter()
	elif _build_info.platform == "android" or _build_info.platform == "ios":
		adapter = NativeNotificationAdapter.new()
	if adapter == null:
		return
	_trace_call("PushCore.set_notification_adapter")
	PushCore.set_notification_adapter(adapter)


## `PaymentCore` store adapter: adapter key `iap-apple` (store `APPLE`) on `ios` and `macos`, `iap-google` (store
## `GOOGLE`) on `android`. `fake` is the DEV fake adapter of that store, any other value the plugin store adapter.
static func _pass_store_adapter() -> void:
	var key := ""
	var store := CoreContract.IapStore.IAP_STORE_GOOGLE
	if _build_info.platform == "ios" or _build_info.platform == "macos":
		key = _ADAPTER_IAP_APPLE
		store = CoreContract.IapStore.IAP_STORE_APPLE
	elif _build_info.platform == "android":
		key = _ADAPTER_IAP_GOOGLE
	if key.is_empty() or not _build_info.adapters.has(key):
		return
	var value: String = _build_info.adapters[key]
	var adapter: StoreAdapter = null
	if value == _FAKE_ADAPTER:
		if _dev != null:
			adapter = _dev.make_fake_store_adapter(store)
	else:
		adapter = PluginStoreAdapter.new(store)
	if adapter == null:
		_adapter_not_passed(key, value)
		return
	_trace_call("PaymentCore.set_store_adapter")
	_trace_adapter("PaymentCore.set_store_adapter", adapter)
	PaymentCore.set_store_adapter(adapter)


## `AdCore` ads adapter of adapter key `ads` with the build info `ad_units`: `fake` is the DEV fake adapter on every
## platform, `ads-admob` is the `admob` adapter on `ios` and `android`.
static func _pass_ads_adapter() -> void:
	if not _build_info.adapters.has(_ADAPTER_ADS):
		return
	var value: String = _build_info.adapters[_ADAPTER_ADS]
	var adapter: AdsAdapter = null
	if value == _FAKE_ADAPTER:
		if _dev != null:
			adapter = _dev.make_fake_ads_adapter()
	elif value == _ADAPTER_ADS_ADMOB and (_build_info.platform == "ios" or _build_info.platform == "android"):
		adapter = AdmobAdapter.new()
	else:
		return
	if adapter == null:
		_adapter_not_passed(_ADAPTER_ADS, value)
		return
	_trace_call("AdCore.set_ads_adapter")
	_trace_adapter("AdCore.set_ads_adapter", adapter)
	if _trace_enabled:
		_traced_ad_units = _build_info.ad_units.duplicate()
	AdCore.set_ads_adapter(adapter, _build_info.ad_units.duplicate())


## `RealtimeCore` transport: the test realtime transport as it is, or the P2P transport the DEV code wraps. The P2P
## transport is relay-only by `BootstrapCore.realtimeRelayOnly` outside a dev run.
static func _pass_realtime_transport() -> void:
	_realtime_transport_kind = ""
	if _dev != null and _dev.pass_realtime_transport():
		return
	var relay_only := false if _is_dev_run else _relay_only
	var transport: RealtimeTransport = P2pRealtimeTransport.new(_build_info.server_url, _build_info.app_version, relay_only)
	_realtime_transport_kind = "p2p relay_only=%s" % relay_only
	if _dev != null:
		transport = _dev.wrap_realtime_transport(transport)
	_trace_call("RealtimeCore.set_transport")
	RealtimeCore.set_transport(transport)


## `NativeUiCore` native adapter: the DEV fake adapter in a dev run, else the adapter of the build info platform.
static func _pass_native_adapter() -> void:
	var adapter: NativeUiAdapter = null
	if _is_dev_run:
		if _dev != null:
			adapter = _dev.make_fake_native_ui_adapter()
	elif _build_info.platform in _NATIVE_UI_PLUGIN_PLATFORMS:
		adapter = NativeUiPluginAdapter.new()
	elif _build_info.platform == "web" and OS.get_name() == "Web":
		adapter = NativeUiWebAdapter.new()
	if adapter == null:
		return
	_trace_call("NativeUiCore.set_native_adapter")
	NativeUiCore.set_native_adapter(adapter)


static func _adapter_not_passed(key: String, value: String) -> void:
	_log_error("adapter %s=%s could not be passed" % [key, value])


# --- boot block ---


static func _set_boot_block() -> void:
	if _has_boot_block or not _is_initialized("InputBlockCore"):
		return
	_trace_call("InputBlockCore.block")
	if _is_initialized("UICore"):
		_boot_block = InputBlockCore.block(_BLOCK_REASON, UICore.get_block_pass_list())
	else:
		_boot_block = InputBlockCore.block(_BLOCK_REASON)
	_has_boot_block = true


static func _release_boot_block() -> void:
	if not _has_boot_block:
		return
	_has_boot_block = false
	if _is_initialized("InputBlockCore") and InputBlockCore.is_active(_boot_block):
		_trace_call("InputBlockCore.unblock")
		InputBlockCore.unblock(_boot_block)


# --- login failure ---


static func _login_failed(result: LoginResult) -> void:
	_halt()
	_login_result = result
	var status := AuthCore.LoginStatus.FAILED
	if result != null:
		status = result.status
	if status == AuthCore.LoginStatus.BANNED:
		var args := FormatArgs.new()
		args.set_string("user_id", str(result.user_id))
		args.set_int("until_at", result.ban_until_at)
		args.set_string("url", result.deletion_url)
		var body := ReservedString.bootstrap_banned()
		if result.ban_until_at == 0:
			body = ReservedString.bootstrap_banned_permanent()
		var args_text := ""
		if _trace_enabled:
			args_text = "user_id=%d until_at=%d url=%s" % [result.user_id, result.ban_until_at, result.deletion_url]
		_open_failure_popup(body, args, true, true, args_text)
	elif status == AuthCore.LoginStatus.AGE_BLOCKED:
		_open_failure_popup(ReservedString.bootstrap_age_blocked(), null, false, true)
	else:
		_open_failure_popup(ReservedString.bootstrap_login_failed(), null, false, true)


static func _on_deletion_pressed() -> void:
	_popup_pressed = true
	if not _is_initialized("AuthCore"):
		return
	var session: RefCounted = _session
	_trace_call("AuthCore.issue_deletion_code")
	var code: DeletionCodeResult = await AuthCore.issue_deletion_code()
	if session != _session:
		return
	if code.ok:
		var args := FormatArgs.new()
		var user_id := 0
		if _login_result != null:
			user_id = _login_result.user_id
		args.set_string("user_id", str(user_id))
		args.set_string("code", code.code)
		args.set_int("expires_at", code.expires_at)
		args.set_string("url", code.url)
		var args_text := ""
		if _trace_enabled:
			args_text = "user_id=%d code=%s expires_at=%d url=%s" % [user_id, code.code, code.expires_at, code.url]
		_open_failure_popup(ReservedString.bootstrap_banned_deletion_code(), args, false, true, args_text)
	else:
		_open_failure_popup(ReservedString.bootstrap_banned_deletion_failed(), null, false, true)


# --- fatal error ---


## Fatal error processing for a failure reported by `module`.
static func _fatal(module: String, reason: String) -> void:
	if not _started or _restart_pending or _exited:
		return
	_log_error("fatal from %s: %s" % [module, reason])
	_halt()
	_release_boot_block()
	if _ui_ready:
		_open_fatal_popup()
	else:
		_show_fatal_screen()


static func _open_fatal_popup() -> void:
	if _failure_popup != _FAILURE_POPUP_NONE:
		return
	_open_failure_popup(ReservedString.bootstrap_fatal_error(), null, false, false)


## Opens a failure popup: the fatal popup, the login failure popup or the deletion code popup. Its buttons are
## `[bootstrap_banned_deletion]` when `with_deletion` and then `[bootstrap_restart]`. Back input does not close it.
## Not opening it is fatal for a login failure popup, and the fatal screen for the fatal popup.
static func _open_failure_popup(
		body: String,
		args: FormatArgs,
		with_deletion: bool,
		login_failure: bool,
		args_text: String = ""
) -> void:
	_popup_serial += 1
	var serial := _popup_serial
	_popup_pressed = false
	_failure_popup = _FAILURE_POPUP_OPENING
	var param := SystemPopupParam.new()
	param.body = body
	if args != null:
		param.format_args = args
	if with_deletion:
		param.buttons.append(_popup_button(ReservedString.bootstrap_banned_deletion(), _node._on_deletion_pressed))
	param.buttons.append(_popup_button(ReservedString.bootstrap_restart(), _node._on_restart_pressed))
	param.back_button = -1
	var opened := false
	if _is_initialized("UICore"):
		if _trace_enabled:
			var labels := ReservedString.bootstrap_restart()
			if with_deletion:
				labels = "%s,%s" % [ReservedString.bootstrap_banned_deletion(), labels]
			_trace_call("UICore.open_system_popup body=%s buttons=%s args=%s" % [body, labels, args_text])
		opened = await UICore.open_system_popup(param, _node._on_failure_popup_hidden.bind(serial))
	if serial != _popup_serial:
		return
	if opened:
		_failure_popup = _FAILURE_POPUP_OPEN
		return
	_failure_popup = _FAILURE_POPUP_NONE
	if login_failure:
		_fatal(_TAG, "login failure popup could not be opened")
	else:
		_log_error("fatal popup could not be opened")
		_show_fatal_screen()


static func _popup_button(label: String, callback: Callable) -> SystemPopupButton:
	var button := SystemPopupButton.new()
	button.label = label
	button.callback = callback
	return button


## Hidden callback of the failure popup `serial`. A popup that a restart, an exit or a newer popup replaced does
## nothing.
static func _on_failure_popup_hidden(serial: int) -> void:
	if serial != _popup_serial:
		return
	_failure_popup = _FAILURE_POPUP_NONE
	_node._after_failure_popup_hidden.call_deferred(serial)


## A failure popup closed without a button starts a restart.
static func _after_failure_popup_hidden(serial: int) -> void:
	if serial != _popup_serial or _popup_pressed:
		return
	_on_restart_request(_TAG)


static func _on_restart_pressed() -> void:
	_popup_pressed = true
	_on_restart_request(_TAG)


static func _show_fatal_screen() -> void:
	if _fatal_screen_shown or _node == null:
		return
	_fatal_screen_shown = true
	var screen: Node = null
	var parent: Node = _node
	if _is_initialized("UICore"):
		var holder := Control.new()
		holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
		holder.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		screen = holder
		parent = UICore.get_layer(UICore.UILayer.FATAL)
	else:
		var layer := CanvasLayer.new()
		layer.layer = _FATAL_SCREEN_LAYER
		screen = layer
	screen.name = _FATAL_SCREEN_NAME
	var background := ColorRect.new()
	background.color = Color.BLACK
	background.mouse_filter = Control.MOUSE_FILTER_IGNORE
	background.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var label := Label.new()
	label.text = _FATAL_SCREEN_TEXT
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	label.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	screen.add_child(background)
	screen.add_child(label)
	parent.add_child(screen)
	_fatal_screen = screen


static func _hide_fatal_screen() -> void:
	if is_instance_valid(_fatal_screen):
		var parent := _fatal_screen.get_parent()
		if parent != null:
			parent.remove_child(_fatal_screen)
		_fatal_screen.queue_free()
	_fatal_screen = null


# --- restart ---


## Restart request from `module`: halts now and runs the restart on the next frame.
static func _on_restart_request(_module: String) -> void:
	if not _started or _restart_pending or _exited:
		return
	_halt()
	_restart_pending = true
	_run_restart(_session)


static func _run_restart(session: RefCounted) -> void:
	var tree := Engine.get_main_loop() as SceneTree
	await tree.process_frame
	if session != _session or not _restart_pending:
		return
	_teardown()
	_run_boot(false)


## Restart processing 1 to 5: release the blocks, close the popups and messages, reverse release, and remove the
## fatal screen.
static func _teardown() -> void:
	_popup_serial += 1
	_failure_popup = _FAILURE_POPUP_NONE
	_has_boot_block = false
	if _is_initialized("InputBlockCore"):
		_trace_call("InputBlockCore.release_all")
		InputBlockCore.release_all()
	if _is_initialized("UICore"):
		_trace_call("UICore.close_all_popups")
		UICore.close_all_popups()
	if _is_initialized("MessageCore"):
		_trace_call("MessageCore.close_all")
		MessageCore.close_all()
	_reverse_release()
	_hide_fatal_screen()


## `content_release` when this boot called `content_init`, then `release` of the module list in reverse order.
static func _reverse_release() -> void:
	_has_boot_block = false
	if _content_inited:
		_content_inited = false
		_trace_call("content.content_release")
		_call_content_release()
	for i: int in range(_modules.size() - 1, -1, -1):
		var entry: CoreModuleEntry = _modules[i]
		if _to_bool(entry.is_initialized.call()):
			_trace_call("%s.release" % entry.name)
			entry.release.call()


# --- app exit ---


## Exit request: the OS app exit request, or `UICore.ExitConfirmedEvent` when `confirmed`.
static func _on_exit_request(confirmed: bool) -> void:
	if _exited:
		return
	_exited = true
	if not _started:
		return
	_halt()
	_restart_pending = false
	if _is_initialized("EventCore"):
		_trace_call("EventCore.publish(AppQuitEvent)")
		var event := EventCore.acquire(AppQuitEvent) as AppQuitEvent
		if event != null:
			EventCore.publish(event)
	if _is_initialized("LogCore"):
		_trace_call("LogCore.notify_app_state")
		LogCore.notify_app_state(LogCore.AppState.QUIT)
	if _is_initialized("LocalDataCore"):
		_trace_call("LocalDataCore.flush")
		LocalDataCore.flush()
	_popup_serial += 1
	_reverse_release()
	_hide_fatal_screen()
	if confirmed:
		_request_quit()


static func _request_quit() -> void:
	if _test_hold_quit:
		_quit_request_count += 1
		return
	var tree := Engine.get_main_loop() as SceneTree
	tree.quit()


# --- DEV shutdown ---


## `shutdown`: back to the state before the first `start_boot`. Releases every lifecycle module but `UnitTestCore`.
static func _shutdown() -> void:
	_ensure_node()
	_find_dev()
	_halt()
	_stage = BootStage.NONE
	_restart_pending = false
	_popup_serial += 1
	_failure_popup = _FAILURE_POPUP_NONE
	_has_boot_block = false
	if _content_inited:
		_content_inited = false
		_call_content_release()
	var released: Dictionary[String, bool] = {}
	for i: int in range(_modules.size() - 1, -1, -1):
		var entry: CoreModuleEntry = _modules[i]
		if not _shutdown_known(entry.name):
			_release_entry(entry, released)
	var all_modules := _generated_modules()
	if _dev != null:
		all_modules.append_array(_dev.dev_modules())
	for i: int in range(all_modules.size() - 1, -1, -1):
		_release_entry(all_modules[i], released)
	_hide_fatal_screen()
	_update_set = _UPDATE_SET.new()
	_build_info = null
	_replacements = null
	_is_dev_run = false
	_dev_access = ""
	_started = false
	_exited = false
	_content = null
	_modules = []
	_entries.clear()
	_boot_entry_scene = null
	_ui_ready = false
	_login_result = null
	_is_update_reboot = false
	_launch_values.clear()
	_launch_values_read = false
	_test_downloads = null
	_test_build_info_path = ""
	_trace_enabled = false
	_traced_adapters.clear()
	_traced_ad_units.clear()
	_realtime_transport_kind = ""
	CoreBuildInfo.platform = CoreBuildInfo.os_platform()
	CoreBuildInfo.storage_root = CoreBuildInfo.DEFAULT_STORAGE_ROOT


static func _shutdown_known(module_name: String) -> bool:
	for entry: CoreModuleEntry in _generated_modules():
		if entry.name == module_name:
			return true
	return false


static func _release_entry(entry: CoreModuleEntry, released: Dictionary[String, bool]) -> void:
	if entry.name == _UNIT_TEST_CORE or released.has(entry.name):
		return
	released[entry.name] = true
	if _to_bool(entry.is_initialized.call()):
		entry.release.call()


# --- helpers ---


static func _ensure_node() -> void:
	if is_instance_valid(_node):
		return
	_node = _CORE_NODE.new()
	_node.name = "BootstrapCore"
	_node.process_mode = Node.PROCESS_MODE_ALWAYS
	var tree := Engine.get_main_loop() as SceneTree
	tree.root.add_child(_node)


static func _find_dev() -> void:
	if _dev_searched:
		return
	_dev_searched = true
	if not ResourceLoader.exists(CoreBuildInfo.DEV_ENTRY_PATH):
		return
	var script := load(CoreBuildInfo.DEV_ENTRY_PATH) as GDScript
	if script == null:
		return
	var created: Object = script.new()
	_dev = created as _DEV_HOOKS


## The module list the harness tool generated in `res://generated/core_modules.gd`.
static func _generated_modules() -> Array[CoreModuleEntry]:
	return CoreModules.modules()


static func _halt() -> void:
	_stage = BootStage.HALTED
	_session = RefCounted.new()


static func _has(module_name: String) -> bool:
	return _entries.has(module_name)


static func _is_initialized(module_name: String) -> bool:
	if not _entries.has(module_name):
		return false
	return _to_bool(_entries[module_name].is_initialized.call())


static func _trace_call(operation: String) -> void:
	if _trace_enabled:
		_trace.append(operation)


static func _trace_adapter(entry: String, adapter: RefCounted) -> void:
	if _trace_enabled:
		_traced_adapters[entry] = adapter


static func _log_info(message: String) -> void:
	if _collecting_logs:
		_pending_log_errors.append(false)
		_pending_log_messages.append(message)
		return
	LogCore.log_info(_TAG, message)


static func _log_error(message: String) -> void:
	if _collecting_logs:
		_pending_log_errors.append(true)
		_pending_log_messages.append(message)
		return
	LogCore.log_error(_TAG, message)


static func _flush_pending_logs() -> void:
	for i: int in _pending_log_messages.size():
		if _pending_log_errors[i]:
			LogCore.log_error(_TAG, _pending_log_messages[i])
		else:
			LogCore.log_info(_TAG, _pending_log_messages[i])
	_pending_log_errors.clear()
	_pending_log_messages.clear()


## `content_release` of the content entry. A throw (a GDScript runtime error during the call) logs an error and the
## release goes on.
static func _call_content_release() -> void:
	var mark: int = CoreScriptErrors.begin()
	_content.content_release.call()
	if CoreScriptErrors.end(mark):
		_log_error("content_release threw")


# ogw:input_boundary
static func _to_bool(value: Variant) -> bool:
	if value is bool:
		return value
	return false


# ogw:input_boundary
static func _to_string_value(value: Variant) -> String:
	if value is String:
		return value
	return ""
