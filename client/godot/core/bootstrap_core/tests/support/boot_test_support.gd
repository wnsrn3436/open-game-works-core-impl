extends RefCounted
## Support of the BootstrapCore core tests: test module lists, settings, launch values, test scenes and boot
## start.

const TITLE_KEY: String = "scene/boot_test_title"
const FIRST_KEY: String = "scene/boot_test_first"
const OTHER_KEY: String = "scene/boot_test_other"
const HELD_KEY: String = "scene/boot_test_held"
const _RESOURCES: String = "res://core/bootstrap_core/tests/resources/"
const _UPDATE_SET := preload("res://core/bootstrap_core/update_set.gd")
const _BUNDLE_NAME: String = "boot_test_bundle"
const _BUNDLE_PATH: String = "update/boot_test_bundle.pck"
const _BUNDLE_KEYS_PATH: String = "update/boot_test_bundle_keys.json"

## Lifecycle client modules in the module list order rule.
const MODULE_ORDER: PackedStringArray = [
	"LogCore", "EventCore", "TimeCore", "LocalDataCore", "ResourceCore", "PoolCore", "DataCore", "UserStateCore",
	"ResolutionCore", "SafeAreaCore", "InputBlockCore", "InputCore", "LocalizationCore", "SoundCore", "TweenCore",
	"CameraCore", "UICore", "VirtualPadCore", "ScreenEffectCore", "MessageCore", "NetworkCore", "AuthCore",
	"PushCore", "PaymentCore", "AdCore", "RequirementCore", "BadgeCore", "SceneCore", "ShortcutCore",
	"CutsceneCore", "TutorialCore", "RealtimeCore", "GameUpdateCore", "QualityCore", "AccessibilityCore",
	"NativeUiCore", "NoticeCore", "ChatCore", "RemoteConfigCore",
]
## The `BootstrapCore` dependencies and their dependency closure, without `AuthCore`: a boot of this list has no
## login and sends no server request.
const BASE: PackedStringArray = [
	"LogCore", "EventCore", "TimeCore", "LocalDataCore", "ResourceCore", "PoolCore", "DataCore", "UserStateCore",
	"ResolutionCore", "SafeAreaCore", "InputBlockCore", "InputCore", "LocalizationCore", "SoundCore", "TweenCore",
	"UICore", "ScreenEffectCore", "MessageCore", "NetworkCore", "SceneCore", "GameUpdateCore",
]


## Test module list of `BASE` and `extra`, in the module list order.
static func modules(extra: PackedStringArray = PackedStringArray()) -> Array[CoreModuleEntry]:
	var names := BASE.duplicate()
	names.append_array(extra)
	var list: Array[CoreModuleEntry] = []
	for module_name: String in MODULE_ORDER:
		if module_name in names:
			list.append(entry(module_name))
	return list


static func entry(module_name: String) -> CoreModuleEntry:
	match module_name:
		"LogCore":
			return _entry(module_name, LogCore.init, LogCore.release, LogCore.is_initialized)
		"EventCore":
			return _entry(module_name, EventCore.init, EventCore.release, EventCore.is_initialized)
		"TimeCore":
			return _entry(module_name, TimeCore.init, TimeCore.release, TimeCore.is_initialized)
		"LocalDataCore":
			return _entry(module_name, LocalDataCore.init, LocalDataCore.release, LocalDataCore.is_initialized)
		"ResourceCore":
			return _entry(module_name, ResourceCore.init, ResourceCore.release, ResourceCore.is_initialized)
		"PoolCore":
			return _entry(module_name, PoolCore.init, PoolCore.release, PoolCore.is_initialized)
		"DataCore":
			return _entry(module_name, DataCore.init, DataCore.release, DataCore.is_initialized)
		"UserStateCore":
			return _entry(module_name, UserStateCore.init, UserStateCore.release, UserStateCore.is_initialized)
		"ResolutionCore":
			return _entry(module_name, ResolutionCore.init, ResolutionCore.release, ResolutionCore.is_initialized)
		"SafeAreaCore":
			return _entry(module_name, SafeAreaCore.init, SafeAreaCore.release, SafeAreaCore.is_initialized)
		"InputBlockCore":
			return _entry(module_name, InputBlockCore.init, InputBlockCore.release, InputBlockCore.is_initialized)
		"InputCore":
			return _entry(module_name, InputCore.init, InputCore.release, InputCore.is_initialized)
		"LocalizationCore":
			return _entry(module_name, LocalizationCore.init, LocalizationCore.release, LocalizationCore.is_initialized)
		"SoundCore":
			return _entry(module_name, SoundCore.init, SoundCore.release, SoundCore.is_initialized)
		"TweenCore":
			return _entry(module_name, TweenCore.init, TweenCore.release, TweenCore.is_initialized)
		"UICore":
			return _entry(module_name, UICore.init, UICore.release, UICore.is_initialized)
		"VirtualPadCore":
			return _entry(module_name, VirtualPadCore.init, VirtualPadCore.release, VirtualPadCore.is_initialized)
		"ScreenEffectCore":
			return _entry(module_name, ScreenEffectCore.init, ScreenEffectCore.release, ScreenEffectCore.is_initialized)
		"MessageCore":
			return _entry(module_name, MessageCore.init, MessageCore.release, MessageCore.is_initialized)
		"NetworkCore":
			return _entry(module_name, NetworkCore.init, NetworkCore.release, NetworkCore.is_initialized)
		"AuthCore":
			return _entry(module_name, AuthCore.init, AuthCore.release, AuthCore.is_initialized)
		"PushCore":
			return _entry(module_name, PushCore.init, PushCore.release, PushCore.is_initialized)
		"PaymentCore":
			return _entry(module_name, PaymentCore.init, PaymentCore.release, PaymentCore.is_initialized)
		"AdCore":
			return _entry(module_name, AdCore.init, AdCore.release, AdCore.is_initialized)
		"RequirementCore":
			return _entry(module_name, RequirementCore.init, RequirementCore.release, RequirementCore.is_initialized)
		"BadgeCore":
			return _entry(module_name, BadgeCore.init, BadgeCore.release, BadgeCore.is_initialized)
		"SceneCore":
			return _entry(module_name, SceneCore.init, SceneCore.release, SceneCore.is_initialized)
		"RealtimeCore":
			return _entry(module_name, RealtimeCore.init, RealtimeCore.release, RealtimeCore.is_initialized)
		"GameUpdateCore":
			return _entry(module_name, GameUpdateCore.init, GameUpdateCore.release, GameUpdateCore.is_initialized)
		"NoticeCore":
			return _entry(module_name, NoticeCore.init, NoticeCore.release, NoticeCore.is_initialized)
	return _entry(module_name, Callable(), Callable(), Callable())


## Module list names the boot `init`s, in order.
static func names(list: Array[CoreModuleEntry]) -> PackedStringArray:
	var result := PackedStringArray()
	for item: CoreModuleEntry in list:
		result.append(item.name)
	return result


## Test settings, launch values and test scenes of a dev run boot. Call before the boot.
static func prepare(launch_values: Dictionary[String, String] = {}, title_key: String = TITLE_KEY) -> void:
	UnitTestCore.set_test_settings("titleScene", title_key)
	UnitTestCore.set_test_settings("firstScene", FIRST_KEY)
	UnitTestCore.set_test_settings("BootstrapCore.realtimeRelayOnly", false)
	# The test clock moves only by `advance_clock`: a scene change of the boot does not wait for it.
	UnitTestCore.set_test_settings("SceneCore.loadingMinDisplayMs", 0)
	set_launch_values(launch_values)
	ResourceCoreDev.set_test_key_list(resource_keys())
	BootstrapCore._trace.clear()
	BootstrapCore._trace_enabled = true
	BootstrapCore._test_hold_quit = true
	BootstrapCore._quit_request_count = 0


## Launch values the dev run reads instead of the launch value file.
static func set_launch_values(values: Dictionary[String, String]) -> void:
	BootstrapCore._launch_values = values.duplicate()
	BootstrapCore._launch_values_read = true


## The test scenes, and the resources the core test data names for the boot: the `language` table font, the
## `input_prompt` table icons, the reserved sound `[ui_button_click]` and game settings `loadingScreen`.
static func resource_keys() -> Dictionary[String, String]:
	var keys: Dictionary[String, String] = {
		TITLE_KEY: _RESOURCES + "boot_test_title.tscn",
		FIRST_KEY: _RESOURCES + "boot_test_first.tscn",
		OTHER_KEY: _RESOURCES + "boot_test_other.tscn",
		HELD_KEY: _RESOURCES + "boot_test_held.tscn",
		"font/main": _RESOURCES + "boot_test_font.tres",
		"font/cjk": _RESOURCES + "boot_test_font.tres",
		"icon/key_j": _RESOURCES + "boot_test_icon_key_j.tres",
		"icon/key_escape": _RESOURCES + "boot_test_icon_key_escape.tres",
		"icon/pad_b": _RESOURCES + "boot_test_icon_pad_b.tres",
		"icon/ps_circle": _RESOURCES + "boot_test_icon_ps_circle.tres",
		"sfx/ui_button_click": _RESOURCES + "boot_test_click.tres",
		"prefab_loading": _RESOURCES + "boot_test_loading.tscn",
	}
	return keys


## Downloaded files of one bundle that `ResourceCore.apply_bundles` applies: a bundle file in the app storage
## root of `instance_id` holding an empty resource key list, and its SHA-256. The boot tests set it as
## `BootstrapCore._test_downloads`.
static func bundle_downloads(instance_id: String = "") -> _UPDATE_SET:
	var root: String = BootstrapCore._storage_root(instance_id)
	DirAccess.make_dir_recursive_absolute((root + _BUNDLE_PATH).get_base_dir())
	var keys: FileAccess = FileAccess.open(root + _BUNDLE_KEYS_PATH, FileAccess.WRITE)
	if keys != null:
		keys.store_string("{}")
		keys.close()
	var packer: PCKPacker = PCKPacker.new()
	if packer.pck_start(root + _BUNDLE_PATH) == OK:
		packer.add_file("res://bundle_keys/" + _BUNDLE_NAME + ".json", root + _BUNDLE_KEYS_PATH)
		packer.flush()
	var bundle := DownloadedBundle.new()
	bundle.name = _BUNDLE_NAME
	bundle.path = _BUNDLE_PATH
	bundle.sha256 = FileAccess.get_sha256(root + _BUNDLE_PATH)
	var downloads := _UPDATE_SET.new()
	downloads.bundles.append(bundle)
	return downloads


## Downloaded data of `version` in the app storage folder `folder`: the built-in table binaries, with the bytes of
## `extra_row` more rows in `experiment.bin`. `LocalDataCore` is initialized. `DataCore.load` takes it when `version`
## has the built-in protocol hash.
static func data_downloads(folder: String, version: String, extra_row: bool) -> _UPDATE_SET:
	var data := DownloadedData.new()
	data.data_version = version
	var location := DataCore.get_builtin_location()
	for file_name: String in DirAccess.get_files_at(location):
		if not file_name.ends_with(".bin") or file_name.begins_with("translation_"):
			continue
		var bytes := FileAccess.get_file_as_bytes(location.path_join(file_name))
		if extra_row and file_name == "experiment.bin":
			bytes.append_array(_extra_experiment_row())
		var path := folder.path_join(file_name)
		LocalDataCore.write_file(path, bytes)
		data.files[path] = UtilCore.sha256_hex(bytes)
	var downloads := _UPDATE_SET.new()
	downloads.data = data
	return downloads


## A data version with the protocol hash of the built-in data and a data hash made of `seed_text`.
static func data_version(seed_text: String) -> String:
	var builtin := DataCore.get_builtin_data_version()
	return builtin.left(64) + "-" + UtilCore.sha256_hex(seed_text.to_utf8_buffer())


## One more `experiment` row, ID value 2000000000, as the bytes of one more field 1 of a table binary.
static func _extra_experiment_row() -> PackedByteArray:
	var row := PackedByteArray([0x08])
	row.append_array(_varint(2000000000))
	var bytes := PackedByteArray([0x0A])
	bytes.append_array(_varint(row.size()))
	bytes.append_array(row)
	return bytes


## Downloaded translation of the current language in the app storage path `path`: the built-in translation binary
## with one more entry (`key`, `text`). `LocalDataCore` is initialized and `DataCore` loaded.
static func translation_downloads(path: String, key: String, text: String) -> _UPDATE_SET:
	var code := LocalizationCore.get_language_code()
	var location := DataCore.get_builtin_location().path_join("translation_%s.bin" % code.to_lower())
	var bytes := FileAccess.get_file_as_bytes(location)
	var entry := _length_delimited(1, key.to_utf8_buffer())
	entry.append_array(_length_delimited(2, text.to_utf8_buffer()))
	bytes.append_array(_length_delimited(1, entry))
	LocalDataCore.write_file(path, bytes)
	var translation := DownloadedTranslation.new()
	translation.code = code
	translation.path = path
	translation.sha256 = UtilCore.sha256_hex(bytes)
	translation.data_version = DataCore.get_data_version()
	var downloads := _UPDATE_SET.new()
	downloads.translations.append(translation)
	return downloads


static func _length_delimited(number: int, bytes: PackedByteArray) -> PackedByteArray:
	var out := _varint(number << 3 | 2)
	out.append_array(_varint(bytes.size()))
	out.append_array(bytes)
	return out


static func _varint(value: int) -> PackedByteArray:
	var out := PackedByteArray()
	var rest := value
	while rest >= 0x80:
		out.append((rest & 0x7F) | 0x80)
		rest = rest >> 7
	out.append(rest)
	return out


## Starts a test boot. The boots after a restart or an update reboot get the test scenes too.
static func start(
		content: ContentEntry,
		list: Array[CoreModuleEntry],
		realtime: RefCounted = null,
		update_downloads: BootTestReplacements.UpdateDownloads = null
) -> void:
	if realtime == null:
		UnitTestCore.start_test_boot(content, list, null, "", update_downloads)
	else:
		@warning_ignore("unsafe_call_argument")
		UnitTestCore.start_test_boot(content, list, realtime, "", update_downloads)
	var replacements := BootstrapCore._replacements as BootTestReplacements
	if replacements != null:
		replacements._resource_keys = resource_keys()


## Waits until the boot stage is `stage`, then one frame more for the work the boot does in the frame it got there.
## The boot gets there through threaded loads and requests, so the stage ends the wait, not a frame count. A shutdown
## of the boot, as at the test time limit, ends it too. Returns whether the boot got to `stage`.
static func wait_stage(stage: BootstrapCore.BootStage) -> bool:
	while BootstrapCore.boot_stage() != stage:
		if BootstrapCore.boot_stage() == BootstrapCore.BootStage.NONE:
			return false
		await UnitTestCore.wait_frames(1)
	await UnitTestCore.wait_frames(1)
	return true


## Whether the reason tag `boot` block of `BootstrapCore` is active.
static func boot_block_active() -> bool:
	return BootstrapCore._has_boot_block and InputBlockCore.is_active(BootstrapCore._boot_block)


## The trace entries from the first `from` entry to the first `to` entry after it, both left out.
static func trace_between(from: String, to: String) -> PackedStringArray:
	var result := PackedStringArray()
	var start := BootstrapCore._trace.find(from)
	if start < 0:
		return result
	for i: int in range(start + 1, BootstrapCore._trace.size()):
		if BootstrapCore._trace[i] == to:
			break
		result.append(BootstrapCore._trace[i])
	return result


## Trace entries of the failure popups `BootstrapCore` asked `UICore` to open, in order.
static func popups() -> PackedStringArray:
	var result := PackedStringArray()
	for operation: String in BootstrapCore._trace:
		if operation.begins_with("UICore.open_system_popup"):
			result.append(operation)
	return result


## The trace entry of a failure popup with body `body`, button labels `buttons` and format argument text `args`.
static func popup(body: String, buttons: PackedStringArray, args: String = "") -> String:
	return "UICore.open_system_popup body=%s buttons=%s args=%s" % [body, ",".join(buttons), args]


## Presses button `index` of the top system popup with real input: a direction key starts the focus mode on the
## first button, Tab moves the focus to the next button and Enter presses it. The test clock first moves by
## `UICore.buttonClickIntervalMs`, so the press is not inside the click interval of an earlier press.
static func press_popup_button(index: int) -> void:
	UnitTestCore.advance_clock(CoreSettings.get_int("UICore.buttonClickIntervalMs"), false)
	_key(KEY_DOWN)
	await UnitTestCore.wait_frames(1)
	for i: int in index:
		_key(KEY_TAB)
		await UnitTestCore.wait_frames(1)
	_key(KEY_ENTER)
	await UnitTestCore.wait_frames(2)


static func _key(code: Key) -> void:
	for pressed: bool in [true, false]:
		var event := InputEventKey.new()
		event.keycode = code
		event.physical_keycode = code
		event.pressed = pressed
		InputCoreDev.inject_device_input(event)


## How many trace entries are `operation`.
static func count(operation: String) -> int:
	return BootstrapCore._trace.count(operation)


static func _entry(module_name: String, init: Callable, release: Callable, is_initialized: Callable) -> CoreModuleEntry:
	var item := CoreModuleEntry.new()
	item.name = module_name
	item.init = init
	item.release = release
	item.is_initialized = is_initialized
	return item
