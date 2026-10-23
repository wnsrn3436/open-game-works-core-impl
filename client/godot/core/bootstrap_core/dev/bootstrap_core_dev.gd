class_name BootstrapCoreDev
extends "res://core/bootstrap_core/bootstrap_dev_hooks.gd"
## DEV entry of `BootstrapCore`: its `## DEV` operations and the DEV code of the boot. STG and PROD builds do not
## hold this file.

const _LAUNCH_VALUES_ARG: String = "--launch-values="
const _EXPORT_LAUNCH_VALUES_PATH: String = "res://generated/launch_values.json"
const _PLATFORMS: PackedStringArray = ["android", "ios", "web", "windows", "macos", "linux"]
const _DEV_ENVIRONMENTS: PackedStringArray = ["DEV", "STG", "PROD"]
const _INSTANCE_ID_CHARS: String = "abcdefghijklmnopqrstuvwxyz0123456789_-"
const _DEV_ACCOUNT_CHARS: String = "abcdefghijklmnopqrstuvwxyz0123456789_"
## DEV registration list the harness tool generates in the game.
const _DEV_REGISTRATION_PATH: String = "res://dev/generated/dev_registration.gd"


## Value of launch value `value_name`. Empty when there is none.
static func get_launch_value(value_name: String) -> String:
	_read_launch_values()
	if BootstrapCore._launch_values.has(value_name):
		return BootstrapCore._launch_values[value_name]
	return ""


## Whether the boot of the current `boot_stage` is an update reboot.
static func is_update_reboot() -> bool:
	return BootstrapCore._is_update_reboot


## Puts the boot and every module back to the state before the first `start_boot`, for the next test.
static func shutdown() -> void:
	BootstrapCore._shutdown()


func make_dev_build_info() -> BuildInfo:
	var info := BuildInfo.new()
	info.environment = "LOCAL"
	var platform := get_launch_value("OGW_PLATFORM")
	if not platform.is_empty() and not platform in _PLATFORMS:
		BootstrapCore._log_error("launch value OGW_PLATFORM %s is not a platform" % platform)
		return null
	info.platform = platform if not platform.is_empty() else CoreBuildInfo.os_platform()
	var replacements := BootstrapCore._replacements as BootTestReplacements
	if replacements != null and not replacements.server_url.is_empty():
		info.server_url = replacements.server_url
	else:
		info.server_url = get_launch_value("OGW_SERVER_URL")
	if info.server_url.is_empty():
		BootstrapCore._log_error("dev run has no server URL")
		return null
	var instance_id := get_launch_value("OGW_INSTANCE_ID")
	if not _only_chars(instance_id, _INSTANCE_ID_CHARS):
		BootstrapCore._log_error("launch value OGW_INSTANCE_ID has a character outside [a-z0-9_-]")
		return null
	var account := get_launch_value("OGW_DEV_ACCOUNT")
	if not _only_chars(account, _DEV_ACCOUNT_CHARS):
		BootstrapCore._log_error("launch value OGW_DEV_ACCOUNT has a character outside [a-z0-9_]")
		return null
	info.instance_id = instance_id
	if not instance_id.is_empty() and not account.is_empty():
		info.instance_id = "%s.%s" % [instance_id, account]
	for environment: String in _DEV_ENVIRONMENTS:
		var key := "environments.%s.adapters" % environment
		if not CoreSettings.has_key(key):
			continue
		if not CoreSettings.has_string_map(key):
			BootstrapCore._log_error("setting %s is not an object of strings" % key)
			return null
		for adapter_key: String in CoreSettings.get_string_map(key).keys():
			info.adapters[adapter_key] = "fake"
	return info


func test_update_downloads() -> _UPDATE_SET:
	var replacements := BootstrapCore._replacements as BootTestReplacements
	if replacements == null or replacements.update_downloads == null:
		return null
	var downloads := _UPDATE_SET.new()
	downloads.data = replacements.update_downloads.data
	downloads.translations = replacements.update_downloads.translations.duplicate()
	downloads.bundles = replacements.update_downloads.bundles.duplicate()
	return downloads


func apply_test_replacements() -> void:
	var replacements := BootstrapCore._replacements as BootTestReplacements
	if replacements == null:
		return
	if replacements.test_clock != null:
		if BootstrapCore._has("TimeCore"):
			BootstrapCore._trace_call("TimeCore.set_test_clock")
			@warning_ignore("unsafe_call_argument")
			TimeCoreDev.set_test_clock(replacements.test_clock)
		if BootstrapCore._has("LogCore"):
			BootstrapCore._trace_call("LogCore.set_test_clock")
			@warning_ignore("unsafe_call_argument")
			LogCoreDev.set_test_clock(replacements.test_clock)
	if replacements.network_transport != null and BootstrapCore._has("NetworkCore"):
		BootstrapCore._trace_call("NetworkCore.set_transport")
		NetworkCoreDev.set_transport(replacements.network_transport)
	if replacements.log_listener.is_valid() and BootstrapCore._has("LogCore"):
		BootstrapCore._trace_call("LogCore.set_log_listener")
		LogCoreDev.set_log_listener(replacements.log_listener)
	if not replacements._resource_keys.is_empty() and BootstrapCore._has("ResourceCore"):
		ResourceCoreDev.set_test_key_list(replacements._resource_keys)


func pass_realtime_transport() -> bool:
	var replacements := BootstrapCore._replacements as BootTestReplacements
	if replacements == null or replacements.realtime_transport == null:
		return false
	BootstrapCore._trace_call("RealtimeCore.set_transport")
	@warning_ignore("unsafe_call_argument")
	RealtimeCore.set_transport(replacements.realtime_transport)
	return true


func pass_dev_token_storage() -> void:
	BootstrapCore._trace_call("AuthCore.use_dev_token_storage")
	AuthCoreDev.use_dev_token_storage()


func make_fake_social_adapter() -> SocialAdapter:
	return FakeSocialAdapter.new()


func make_fake_push_adapter() -> PushAdapter:
	return FakePushAdapter.new()


func make_fake_notification_adapter() -> NotificationAdapter:
	return FakeNotificationAdapter.new()


func make_fake_store_adapter(store: CoreContract.IapStore) -> StoreAdapter:
	return FakeStoreAdapter.new(store)


func make_fake_ads_adapter() -> AdsAdapter:
	return FakeAdsAdapter.new()


func make_fake_native_ui_adapter() -> NativeUiAdapter:
	return FakeNativeUiAdapter.new()


func wrap_realtime_transport(p2p: RealtimeTransport) -> RealtimeTransport:
	if BootstrapCore._is_dev_run:
		BootstrapCore._realtime_transport_kind = "lockstep(sim(%s))" % BootstrapCore._realtime_transport_kind
		return LockstepRealtimeTransport.new(SimRealtimeTransport.new(p2p))
	BootstrapCore._realtime_transport_kind = "lockstep(%s)" % BootstrapCore._realtime_transport_kind
	return LockstepRealtimeTransport.new(p2p)


func after_init_modules() -> void:
	if not BootstrapCore._is_dev_run or not BootstrapCore._has("VirtualPadCore"):
		return
	var platform := BootstrapCore._build_info.platform
	if platform == "android" or platform == "ios":
		BootstrapCore._trace_call("VirtualPadCore.set_test_touch_support")
		VirtualPadCoreDev.set_test_touch_support(true)


func after_server_info() -> void:
	if not BootstrapCore._has("NetworkCore"):
		return
	var dev_access := BootstrapCore._dev_access
	if BootstrapCore._is_dev_run:
		dev_access = get_launch_value("OGW_DEV_ACCESS")
	BootstrapCore._trace_call("NetworkCore.set_dev_access")
	NetworkCoreDev.set_dev_access(dev_access)


## Calls `register_all()` of the DEV registration list. A game without the file has nothing to register. A boot
## without an initialized `QACore` (a test boot whose module list has no `QACore`) has nowhere to register.
func after_derived_containers() -> void:
	if not QACore.is_initialized() or not ResourceLoader.exists(_DEV_REGISTRATION_PATH):
		return
	var script := load(_DEV_REGISTRATION_PATH) as GDScript
	var registration: DevRegistrationList = null
	if script != null:
		var created: Object = script.new()
		registration = created as DevRegistrationList
	if registration == null:
		BootstrapCore._log_error("%s is not a DevRegistrationList script" % _DEV_REGISTRATION_PATH)
		return
	registration.register_all()


## `QACore`, the DEV module of a DEV build module list.
func dev_modules() -> Array[CoreModuleEntry]:
	var entry := CoreModuleEntry.new()
	entry.name = "QACore"
	entry.init = QACore.init
	entry.release = QACore.release
	entry.is_initialized = QACore.is_initialized
	var list: Array[CoreModuleEntry] = [entry]
	return list


func dev_account() -> String:
	if not BootstrapCore._is_dev_run:
		return ""
	return get_launch_value("OGW_DEV_ACCOUNT")


func dev_login() -> LoginResult:
	var result: LoginResult = await AuthCoreDev.dev_login(dev_account())
	return result


static func _only_chars(text: String, allowed: String) -> bool:
	for i: int in text.length():
		if allowed.find(text[i]) < 0:
			return false
	return true


static func _read_launch_values() -> void:
	if BootstrapCore._launch_values_read:
		return
	BootstrapCore._launch_values_read = true
	for arg: String in OS.get_cmdline_user_args():
		if arg.begins_with(_LAUNCH_VALUES_ARG):
			_merge_launch_values(arg.substr(_LAUNCH_VALUES_ARG.length()))
	_merge_launch_values(_EXPORT_LAUNCH_VALUES_PATH)


## Adds the values of the launch value file at `path` whose names are not read yet.
# ogw:input_boundary
static func _merge_launch_values(path: String) -> void:
	if path.is_empty() or not FileAccess.file_exists(path):
		return
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not parsed is Dictionary:
		BootstrapCore._log_error("launch value file %s is not a JSON object" % path)
		return
	var values: Dictionary = parsed
	for value_name: Variant in values.keys():
		var value: Variant = values[value_name]
		if value_name is String and value is String and not BootstrapCore._launch_values.has(value_name):
			var name_text: String = value_name
			var value_text: String = value
			BootstrapCore._launch_values[name_text] = value_text
