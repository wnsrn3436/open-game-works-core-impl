extends RefCounted
## Starts and stops `LocalizationCore` with the modules it depends on, for the core tests of `LocalizationCore`.

const TAG: String = "LocalizationCore"
const RESOURCES: String = "res://core/localization_core/tests/resources/"
const BUILT_DATA: String = "res://build/data/"
## Test resources by resource key.
const FONT_MAIN: String = "font/main"
const FONT_CJK: String = "font/cjk"
## Fonts made for the font weight tests: one with a `wght` axis from 100 to 900 (default 400) and only the glyph `A`,
## 600 units wide at weight 400 and below and 400 units wider at 900, and one without a variation axis and only the
## glyph `B`, 600 units wide.
const WEIGHT_AXIS_FONT: String = RESOURCES + "font_weight_axis.tres"
const NO_WEIGHT_AXIS_FONT: String = RESOURCES + "font_no_weight_axis.tres"
## The `input_prompt` icons of the core test data.
const ICON_ESCAPE: String = "icon/key_escape"
const ICON_KEY_J: String = "icon/key_j"
const ICON_PAD_B: String = "icon/pad_b"
const ICON_PS_CIRCLE: String = "icon/ps_circle"

## A text key the tests put into the loaded translation.
const TEXT_KEY: String = "localization_test.text"


## Every test resource, keyed by resource key.
static func all_resources() -> Dictionary[String, String]:
	return {
		FONT_MAIN: RESOURCES + "font_main.tres",
		FONT_CJK: RESOURCES + "font_cjk.tres",
		ICON_ESCAPE: RESOURCES + "key_escape.tres",
		ICON_KEY_J: RESOURCES + "key_j.tres",
		ICON_PAD_B: RESOURCES + "pad_b.tres",
		ICON_PS_CIRCLE: RESOURCES + "ps_circle.tres",
	}


## Inits the modules `LocalizationCore` depends on and `LocalizationCore`, and loads the core test data from
## `data_location`. True when all succeed.
static func start(resources: Dictionary[String, String] = all_resources(), data_location: String = BUILT_DATA) -> bool:
	if not await start_dependencies(resources, data_location):
		return false
	return LocalizationCore.init()


## Inits the modules `LocalizationCore` depends on in dependency order and loads the core test data.
static func start_dependencies(resources: Dictionary[String, String] = all_resources(), data_location: String = BUILT_DATA) -> bool:
	if not LogCore.init() or not EventCore.init() or not TimeCore.init():
		return false
	return await _start_from_local_data(resources, data_location)


## A restart inside a test: releases `LocalizationCore` and the modules from `LocalDataCore` up, and inits them again
## like `start`. `LogCore`, `EventCore` and `TimeCore` keep running, because `LogCore` and `TimeCore` drop the log
## collector and the test clock UnitTestCore registers at the test setup when they are released.
static func restart(resources: Dictionary[String, String] = all_resources(), data_location: String = BUILT_DATA) -> bool:
	_stop_from_local_data()
	if not await _start_from_local_data(resources, data_location):
		return false
	return LocalizationCore.init()


static func _start_from_local_data(resources: Dictionary[String, String], data_location: String) -> bool:
	if not LocalDataCore.init():
		return false
	LocalDataCore.load_device_file()
	ResourceCoreDev.set_test_key_list(resources)
	DataCoreDev.set_test_data_location(data_location)
	if not ResourceCore.init() or not DataCore.init():
		return false
	if not await DataCore.load(null):
		return false
	return ResolutionCore.init() and InputBlockCore.init() and InputCore.init()


## Releases the modules `start` inits, in reverse order.
static func stop() -> void:
	_stop_from_local_data()
	TimeCore.release()
	EventCore.release()
	LogCore.release()


static func _stop_from_local_data() -> void:
	LocalizationCore.release()
	InputCore.release()
	InputBlockCore.release()
	ResolutionCore.release()
	DataCore.release()
	ResourceCore.release()
	LocalDataCore.release()


## `start`, the device language tag, `resolve_language` and the built-in translation. The current language ID value.
static func start_language(tag: String, resources: Dictionary[String, String] = all_resources()) -> int:
	if not await start(resources):
		return 0
	LocalizationCoreDev.set_test_device_language(tag)
	var language: int = LocalizationCore.resolve_language()
	var none: Array[DownloadedTranslation] = []
	if language == 0 or not await LocalizationCore.load_translation(none):
		return 0
	return language


static func language_id(id_name: String) -> int:
	return GameDataDev.find_id_value(id_name)


## The translation key of the `name` of a `language` row.
static func language_name_key(id_name: String) -> String:
	return GameData.LanguageTable.get_row(language_id(id_name)).name


## Puts a text into the loaded translation under `key`.
static func put_text(key: String, text: String) -> void:
	LocalizationCore._texts[key] = text
	LocalizationCore._parsed.erase(key)


static func errors(tag: String = TAG) -> int:
	return UnitTestCore.check_logs("error", tag)


static func warns(tag: String = TAG) -> int:
	return UnitTestCore.check_logs("warn", tag)


## A translation binary: the protobuf `Translation` of the entries (key, text) in order.
static func translation_binary(entries: PackedStringArray) -> PackedByteArray:
	var out: PackedByteArray = PackedByteArray()
	var i: int = 0
	while i + 1 < entries.size():
		var entry: PackedByteArray = PackedByteArray()
		_put_string(entry, 1, entries[i])
		_put_string(entry, 2, entries[i + 1])
		_put_bytes(out, 1, entry)
		i += 2
	return out


## Writes bytes to an app storage path and returns the `DownloadedTranslation` of them.
static func write_downloaded(path: String, bytes: PackedByteArray, code: String) -> DownloadedTranslation:
	var full: String = CoreBuildInfo.storage_root.path_join(path)
	if DirAccess.make_dir_recursive_absolute(full.get_base_dir()) == OK:
		var file: FileAccess = FileAccess.open(full, FileAccess.WRITE)
		if file != null:
			file.store_buffer(bytes)
			file.close()
	var downloaded: DownloadedTranslation = DownloadedTranslation.new()
	downloaded.code = code
	downloaded.path = path
	downloaded.sha256 = UtilCore.sha256_hex(bytes)
	downloaded.data_version = DataCore.get_data_version()
	return downloaded


## Copies the core test data at `BUILT_DATA` to an app storage folder without the translation binaries. The folder
## location for `start`.
static func copy_data_without_translations(folder: String) -> String:
	var to: String = CoreBuildInfo.storage_root.path_join(folder)
	if DirAccess.make_dir_recursive_absolute(to) != OK:
		return ""
	for name: String in DirAccess.get_files_at(BUILT_DATA):
		if not name.begins_with("translation_"):
			var file: FileAccess = FileAccess.open(to.path_join(name), FileAccess.WRITE)
			if file != null:
				file.store_buffer(FileAccess.get_file_as_bytes(BUILT_DATA.path_join(name)))
				file.close()
	return to + "/"


static func _put_string(out: PackedByteArray, number: int, text: String) -> void:
	_put_bytes(out, number, text.to_utf8_buffer())


static func _put_bytes(out: PackedByteArray, number: int, bytes: PackedByteArray) -> void:
	_put_varint(out, number << 3 | 2)
	_put_varint(out, bytes.size())
	out.append_array(bytes)


static func _put_varint(out: PackedByteArray, value: int) -> void:
	var rest: int = value
	while rest >= 0x80:
		out.append((rest & 0x7F) | 0x80)
		rest >>= 7
	out.append(rest)
