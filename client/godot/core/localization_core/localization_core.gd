class_name LocalizationCore
extends RefCounted
## Current language, translation lookup, format arguments, input prompt tokens, the default font and the heading font
## of the language and the text scale of UI text elements.

const _CORE_NODE := preload("res://core/localization_core/localization_core_node.gd")
const _TEXT_FORMAT := preload("res://core/localization_core/text_format.gd")
const _TRANSLATION_BINARY := preload("res://core/localization_core/translation_binary.gd")

const _TAG: String = "LocalizationCore"
const _LANGUAGE_KEY: String = "LocalizationCore.language"
const _SOURCE_LANGUAGE_SETTING: String = "sourceLanguage"
const _SUPPORTED_LANGUAGES_SETTING: String = "supportedLanguages"
const _DOWNLOADED_MAX_BYTES_SETTING: String = "LocalizationCore.downloadedFileMaxBytes"
const _MAX_FORMATTED_LENGTH_SETTING: String = "LocalizationCore.maxFormattedLength"
const _BODY_FONT_WEIGHT_SETTING: String = "LocalizationCore.bodyFontWeight"
const _HEADING_FONT_WEIGHT_SETTING: String = "LocalizationCore.headingFontWeight"
## What DEV builds put in place of a missing key, an error slot and an input prompt token without a prompt.
const _DEV_MARK: String = "‼ "
const _FONT_KIND: int = ResourceCore.BaseKind.FONT
const _ICON_KIND: int = ResourceCore.BaseKind.TEXTURE_2D
const _DEFAULT_TEXT_SCALE: int = 1000
const _RICH_FONT_SIZE: StringName = &"normal_font_size"
const _FONT_SIZE: StringName = &"font_size"
const _FONT: StringName = &"font"
const _RICH_FONT: StringName = &"normal_font"
## The theme type variations of the `heading` text style and the base type of each.
const _HEADING_TYPES: Dictionary[StringName, StringName] = {
	&"HeadingLabel": &"Label",
	&"HeadingButton": &"Button",
	&"HeadingRichTextLabel": &"RichTextLabel",
}
## What `_weight_axis` returns for a font without a `wght` axis: a minimum above the maximum.
const _NO_WEIGHT_AXIS: Vector2i = Vector2i(1, 0)
## `bind_text` drops the bindings of freed elements when the bindings reach this size, and then twice the size left.
const _MIN_BINDING_SWEEP_SIZE: int = 64

static var _is_initialized: bool = false
static var _node: _CORE_NODE = null
## New at every `init`; an async operation that comes back to another session stops.
static var _session: RefCounted = null
static var _source_language: String = ""
static var _downloaded_max_bytes: int = 0
static var _max_formatted_length: int = 0
static var _body_font_weight: int = 0
static var _heading_font_weight: int = 0
static var _resolve_called: bool = false
## ID value and `code` of the current language; 0 and empty before `resolve_language` picks one.
static var _language: int = 0
static var _language_code: String = ""
## Text by built translation key of the loaded translation binary.
static var _texts: Dictionary[String, String] = {}
## `_TEXT_FORMAT.Parsed` by translation key.
static var _parsed: Dictionary[String, RefCounted] = {}
## Missing keys and actions without a prompt that were logged since the last translation load.
static var _missing_logged: Dictionary[String, bool] = {}
static var _prompt_logged: Dictionary[String, bool] = {}
static var _translation_loading: bool = false
static var _fonts_loading: bool = false
static var _icons_loading: bool = false
## `resource_path` of each prompt icon `load_prompt_icons` loaded, by resource key.
static var _icon_paths: Dictionary[String, String] = {}
## The theme whose `default_font` `load_fonts` set to the font chain, its `default_font` before that, and the chain.
static var _font_theme: Theme = null
static var _saved_default_font: Font = null
static var _chain: Font = null
## The heading font chain `load_fonts` set as the font of the `_HEADING_TYPES` in `_font_theme`.
static var _heading_chain: Font = null
## The `_HEADING_TYPES` `_font_theme` had before the first `load_fonts`: the base type of each (empty when it was no
## type variation), and the font item of its own of each that had one (null when that item held no font).
static var _saved_heading_bases: Dictionary[StringName, StringName] = {}
static var _saved_heading_fonts: Dictionary[StringName, Font] = {}
static var _text_scale: int = _DEFAULT_TEXT_SCALE
## First font size of each UI text element in the tree, by instance ID.
static var _first_font_sizes: Dictionary[int, int] = {}
## Translation key of each bound UI text element, by instance ID.
static var _bindings: Dictionary[int, String] = {}
## `_bindings` size at which `bind_text` next drops the bindings of freed elements.
static var _binding_sweep_size: int = _MIN_BINDING_SWEEP_SIZE
static var _prompt: InputPrompt = null
## True when the last `_prompt_text` made an inline icon.
static var _prompt_was_icon: bool = false
## DEV `set_test_device_language`: used in place of the device language tag when not empty.
static var _test_device_language: String = ""
## Core test: the device timezone offset in place of the device's when set.
static var _test_timezone_offset_set: bool = false
static var _test_timezone_offset_ms: int = 0


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init called while initialized")
		return false
	if not _read_settings():
		return false
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree == null:
		LogCore.log_error(_TAG, "init found no SceneTree")
		return false
	_session = RefCounted.new()
	_prompt = InputPrompt.new()
	_node = _CORE_NODE.new()
	_node.name = _TAG
	tree.root.add_child(_node)
	if not EventCore.subscribe(InputPromptChangedEvent, _node._on_input_prompt_changed):
		LogCore.log_error(_TAG, "init could not subscribe to InputPromptChangedEvent")
		_clean_up(true)
		return false
	if tree.node_added.connect(_node._on_node_added) != OK or tree.node_removed.connect(_node._on_node_removed) != OK:
		LogCore.log_error(_TAG, "init could not connect the SceneTree node signals")
		_clean_up(true)
		return false
	_is_initialized = true
	_track_tree(tree.root)
	return true


static func release() -> void:
	_test_device_language = ""
	if not _is_initialized:
		return
	_clean_up(true)


static func is_initialized() -> bool:
	return _is_initialized


## Picks the current language once after `init`: the saved language, then the device language tag, then game
## settings `sourceLanguage`. 0 when none matches.
static func resolve_language() -> int:
	if not _check_initialized("resolve_language"):
		return 0
	if _resolve_called:
		LogCore.log_error(_TAG, "resolve_language called again after init")
		return _language
	_resolve_called = true
	var picked: int = _saved_language()
	if picked == 0:
		for candidate: String in _tag_candidates(_device_language_tag()):
			picked = _find_language(candidate, true)
			if picked != 0:
				break
	if picked == 0:
		picked = _find_language(_source_language, false)
	if picked == 0:
		LogCore.log_error(_TAG, "resolve_language found no language for the saved language, the device language and sourceLanguage " + _source_language)
		return 0
	_language = picked
	_language_code = GameData.LanguageTable.get_row(picked).code
	return _language


## Loads the translation binary of the current language: the downloaded one of its `code` when it passes the size,
## SHA-256, decode and data version checks, else the one in the build.
static func load_translation(downloaded: Array[DownloadedTranslation]) -> bool:
	if not _check_initialized("load_translation"):
		return false
	if _language == 0:
		LogCore.log_error(_TAG, "load_translation called before a current language")
		return false
	if _translation_loading:
		LogCore.log_error(_TAG, "load_translation called while another load_translation runs")
		return false
	_translation_loading = true
	var texts: Dictionary[String, String] = {}
	var loaded: bool = false
	for entry: DownloadedTranslation in downloaded:
		if entry != null and entry.code == _language_code:
			loaded = _read_downloaded(entry, texts)
			break
	if not loaded:
		texts = {}
		loaded = _read_builtin(texts)
	_translation_loading = false
	if not loaded:
		LogCore.log_error(_TAG, "load_translation loaded no translation binary of " + _language_code + "; the previous translation stays")
		return false
	_texts = texts
	_parsed.clear()
	_missing_logged.clear()
	_prompt_logged.clear()
	_rewrite_bindings(false)
	return true


## Loads the font chain of the current language into the global scope and applies it as the default font and as the
## heading font.
static func load_fonts() -> bool:
	if not _check_initialized("load_fonts"):
		return false
	if _language == 0:
		LogCore.log_error(_TAG, "load_fonts called before a current language")
		return false
	if _fonts_loading:
		LogCore.log_error(_TAG, "load_fonts called while another load_fonts runs")
		return false
	_fonts_loading = true
	var session: RefCounted = _session
	var scope: Scope = ResourceCore.get_global_scope()
	var fonts: Array[Font] = []
	var keys: PackedStringArray = PackedStringArray()
	var ok: bool = true
	for key: String in _font_chain_keys():
		var loaded: Resource = await ResourceCore.load(key, _FONT_KIND, scope)
		if session != _session:
			return false
		var font: Font = loaded as Font
		if font == null or not ResourceCore.is_loaded(key, _FONT_KIND):
			ok = false
			LogCore.log_error(_TAG, "font " + key + " of the font chain is the fallback resource")
		if font != null:
			fonts.append(font)
			keys.append(key)
	_fonts_loading = false
	_apply_fonts(fonts, keys)
	return ok


## Loads every `input_prompt` icon into the global scope for inline icons.
static func load_prompt_icons() -> bool:
	if not _check_initialized("load_prompt_icons"):
		return false
	if _icons_loading:
		LogCore.log_error(_TAG, "load_prompt_icons called while another load_prompt_icons runs")
		return false
	_icons_loading = true
	var session: RefCounted = _session
	var scope: Scope = ResourceCore.get_global_scope()
	var keys: PackedStringArray = PackedStringArray()
	for row: GameData.InputPromptRow in GameData.InputPromptTable.all_rows():
		if not row.icon.is_empty() and not keys.has(row.icon):
			keys.append(row.icon)
	var paths: Dictionary[String, String] = {}
	var ok: bool = true
	for key: String in keys:
		var loaded: Resource = await ResourceCore.load(key, _ICON_KIND, scope)
		if session != _session:
			return false
		if loaded is Texture2D and ResourceCore.is_loaded(key, _ICON_KIND):
			paths[key] = loaded.resource_path
		else:
			ok = false
			LogCore.log_error(_TAG, "input prompt icon " + key + " is the fallback resource")
	_icons_loading = false
	_icon_paths = paths
	return ok


## The text of a translation key in the current language, with input prompt tokens replaced.
static func get_text(key: String, icon_height: int = 0) -> String:
	if not _check_initialized("get_text"):
		return ""
	return _build(key, null, icon_height, 0)


## The text of a translation key with the format arguments of `args` and input prompt tokens replaced.
static func format(key: String, args: FormatArgs, icon_height: int = 0) -> String:
	if not _check_initialized("format"):
		return ""
	return _build(key, args, icon_height, 0)


## Binds a translation key to a UI text element. An empty key binds and writes the empty string.
static func bind_text(element: Control, key: String) -> void:
	if not _check_initialized("bind_text"):
		return
	if element == null or not _is_text_element(element):
		LogCore.log_error(_TAG, "bind_text got an object that is not a UI text element")
		return
	if _bindings.size() >= _binding_sweep_size:
		_drop_freed_bindings()
	_bindings[element.get_instance_id()] = key
	_write_bound(element, key)


## Unbinds a UI text element. Its text stays.
static func unbind_text(element: Control) -> void:
	if not _check_initialized("unbind_text"):
		return
	if element == null or not _is_text_element(element):
		LogCore.log_error(_TAG, "unbind_text got an object that is not a UI text element")
		return
	_bindings.erase(element.get_instance_id())


static func get_language() -> int:
	if not _check_initialized("get_language"):
		return 0
	if _language == 0:
		LogCore.log_error(_TAG, "get_language called before a current language")
	return _language


static func get_language_code() -> String:
	if not _check_initialized("get_language_code"):
		return ""
	if _language == 0:
		LogCore.log_error(_TAG, "get_language_code called before a current language")
	return _language_code


## Fills `buffer` from index 0 with the ID values of the `language` rows in `order` order. Returns the count filled.
static func list_languages(buffer: Array[int]) -> int:
	if not _check_initialized("list_languages"):
		return 0
	var rows: Array[GameData.LanguageRow] = GameData.LanguageTable.all_rows()
	if rows.size() > buffer.size():
		LogCore.log_error(_TAG, "list_languages buffer of %d is smaller than %d languages" % [buffer.size(), rows.size()])
	for row: GameData.LanguageRow in rows:
		var index: int = row.order - 1
		if index >= 0 and index < buffer.size():
			buffer[index] = row.id
	return mini(rows.size(), buffer.size())


## Saves the language for the next `resolve_language`. The current language, translation and font stay.
static func select_language(language: int) -> bool:
	if not _check_initialized("select_language"):
		return false
	if not GameData.LanguageTable.has_row(language):
		LogCore.log_error(_TAG, "select_language got %d, which is not a language row" % language)
		return false
	LocalDataCore.set_value_int(LocalDataCore.FileKind.DEVICE, _LANGUAGE_KEY, language)
	return true


static func set_text_scale(permille: int) -> void:
	if not _check_initialized("set_text_scale"):
		return
	if permille < 1:
		LogCore.log_error(_TAG, "set_text_scale got %d, less than 1" % permille)
		return
	if permille == _text_scale:
		return
	_text_scale = permille
	var gone: Array[int] = []
	for id: int in _first_font_sizes:
		var element: Control = _text_element_of(id)
		if element == null:
			gone.append(id)
		else:
			element.add_theme_font_size_override(_font_size_name(element), _scaled(_first_font_sizes[id]))
	for id: int in gone:
		_first_font_sizes.erase(id)
	_rewrite_bindings(true)


static func get_text_scale() -> int:
	if not _check_initialized("get_text_scale"):
		return _DEFAULT_TEXT_SCALE
	return _text_scale


static func _check_initialized(operation: String) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, operation + " called before init")
	return _is_initialized


## Reads the settings of `## settings`; logs and fails when a key is missing or has another type.
static func _read_settings() -> bool:
	if not CoreSettings.has_string(_SOURCE_LANGUAGE_SETTING) or not CoreSettings.has_string_array(_SUPPORTED_LANGUAGES_SETTING):
		LogCore.log_error(_TAG, "init found no sourceLanguage string or supportedLanguages string list in the settings")
		return false
	if not CoreSettings.has_int(_DOWNLOADED_MAX_BYTES_SETTING) or not CoreSettings.has_int(_MAX_FORMATTED_LENGTH_SETTING) \
			or not CoreSettings.has_int(_BODY_FONT_WEIGHT_SETTING) or not CoreSettings.has_int(_HEADING_FONT_WEIGHT_SETTING):
		LogCore.log_error(_TAG, "init found no LocalizationCore integer settings")
		return false
	_source_language = CoreSettings.get_string(_SOURCE_LANGUAGE_SETTING)
	_downloaded_max_bytes = CoreSettings.get_int(_DOWNLOADED_MAX_BYTES_SETTING)
	_max_formatted_length = CoreSettings.get_int(_MAX_FORMATTED_LENGTH_SETTING)
	_body_font_weight = CoreSettings.get_int(_BODY_FONT_WEIGHT_SETTING)
	_heading_font_weight = CoreSettings.get_int(_HEADING_FONT_WEIGHT_SETTING)
	return true


## The saved language when it is a `language` row; else 0.
static func _saved_language() -> int:
	var saved: int = LocalDataCore.get_value_int(LocalDataCore.FileKind.DEVICE, _LANGUAGE_KEY, 0)
	if saved > 0 and GameData.LanguageTable.has_row(saved):
		return saved
	return 0


## The device language tag: `<language>[-<script>][-<region>][-<variant>]`.
static func _device_language_tag() -> String:
	if not _test_device_language.is_empty():
		return _test_device_language
	var locale: String = OS.get_locale()
	var at: int = locale.find("@")
	if at >= 0:
		locale = locale.substr(0, at)
	return locale.replace("_", "-")


## The codes to try for a device language tag, in order: the whole tag, `<language>-<script>-<region>`,
## `<language>-<region>`, `<language>-<script>`, `<language>`. A candidate with a subtag the tag does not have and a
## candidate already in the list are left out.
static func _tag_candidates(tag: String) -> PackedStringArray:
	var out: PackedStringArray = PackedStringArray()
	if tag.is_empty():
		return out
	var subtags: PackedStringArray = tag.split("-")
	var language: String = subtags[0]
	var script: String = ""
	var region: String = ""
	var i: int = 1
	if i < subtags.size() and _is_script_subtag(subtags[i]):
		script = subtags[i]
		i += 1
	if i < subtags.size() and _is_region_subtag(subtags[i]):
		region = subtags[i]
	_add_candidate(out, tag)
	if not script.is_empty() and not region.is_empty():
		_add_candidate(out, language + "-" + script + "-" + region)
	if not region.is_empty():
		_add_candidate(out, language + "-" + region)
	if not script.is_empty():
		_add_candidate(out, language + "-" + script)
	_add_candidate(out, language)
	return out


static func _add_candidate(out: PackedStringArray, candidate: String) -> void:
	if candidate.is_empty():
		return
	for added: String in out:
		if added.to_lower() == candidate.to_lower():
			return
	out.append(candidate)


static func _is_script_subtag(subtag: String) -> bool:
	if subtag.length() != 4:
		return false
	for i: int in range(4):
		if not _is_ascii_letter(subtag.unicode_at(i)):
			return false
	return true


static func _is_region_subtag(subtag: String) -> bool:
	if subtag.length() == 2:
		return _is_ascii_letter(subtag.unicode_at(0)) and _is_ascii_letter(subtag.unicode_at(1))
	return subtag.length() == 3 and subtag.is_valid_int() and not subtag.begins_with("-") and not subtag.begins_with("+")


static func _is_ascii_letter(c: int) -> bool:
	return (c >= 0x41 and c <= 0x5A) or (c >= 0x61 and c <= 0x7A)


## The language whose `code` is `code`; 0 when there is none.
static func _find_language(code: String, ignore_case: bool) -> int:
	if code.is_empty():
		return 0
	for row: GameData.LanguageRow in GameData.LanguageTable.all_rows():
		if row.code == code or (ignore_case and row.code.to_lower() == code.to_lower()):
			return row.id
	return 0


static func _read_downloaded(entry: DownloadedTranslation, out: Dictionary[String, String]) -> bool:
	if entry.data_version != DataCore.get_data_version():
		LogCore.log_error(_TAG, "downloaded translation " + entry.path + " has another data version; using the built-in translation")
		return false
	var size: int = LocalDataCore.get_file_size(entry.path)
	if size < 0:
		LogCore.log_error(_TAG, "downloaded translation " + entry.path + " has no size; using the built-in translation")
		return false
	if size > _downloaded_max_bytes:
		LogCore.log_error(_TAG, "downloaded translation " + entry.path + " is larger than LocalizationCore.downloadedFileMaxBytes; using the built-in translation")
		return false
	var file: FileResult = LocalDataCore.read_file(entry.path, _downloaded_max_bytes)
	if not file.ok:
		LogCore.log_error(_TAG, "downloaded translation " + entry.path + " could not be read; using the built-in translation")
		return false
	if UtilCore.sha256_hex(file.bytes) != entry.sha256.to_lower():
		LogCore.log_error(_TAG, "downloaded translation " + entry.path + " has another SHA-256; using the built-in translation")
		return false
	if not _TRANSLATION_BINARY.decode(file.bytes, out):
		LogCore.log_error(_TAG, "downloaded translation " + entry.path + " does not decode; using the built-in translation")
		return false
	return true


static func _read_builtin(out: Dictionary[String, String]) -> bool:
	var path: String = DataCore.get_builtin_location().path_join("translation_" + _language_code.to_lower() + ".bin")
	if not FileAccess.file_exists(path):
		LogCore.log_error(_TAG, "built-in translation " + path + " is not there")
		return false
	var bytes: PackedByteArray = FileAccess.get_file_as_bytes(path)
	if FileAccess.get_open_error() != OK:
		LogCore.log_error(_TAG, "built-in translation " + path + " could not be read")
		return false
	if not _TRANSLATION_BINARY.decode(bytes, out):
		LogCore.log_error(_TAG, "built-in translation " + path + " does not decode")
		return false
	return true


## The text of a key: pieces in order, each replaced, up to `LocalizationCore.maxFormattedLength` code points.
static func _build(key: String, args: FormatArgs, icon_height: int, depth: int) -> String:
	if key.is_empty():
		return ""
	if not _texts.has(key):
		if not _missing_logged.has(key):
			_missing_logged[key] = true
			LogCore.log_error(_TAG, "missing translation key " + key)
		return _DEV_MARK + key if CoreBuildInfo.has_dev_code else ""
	var parsed: _TEXT_FORMAT.Parsed = _parsed_text(key)
	var rich: bool = icon_height > 0
	var culture: int = -1
	var offset_ms: int = 0
	var out: String = ""
	var length: int = 0
	for i: int in range(parsed.size()):
		var kind: int = parsed.kinds[i]
		var piece: String = ""
		var is_icon: bool = false
		if kind == _TEXT_FORMAT.PIECE_LITERAL:
			piece = parsed.texts[i]
		elif kind == _TEXT_FORMAT.PIECE_ARGUMENT or kind == _TEXT_FORMAT.PIECE_FORMATTED:
			if culture < 0:
				culture = _TEXT_FORMAT.culture_of(_language_code)
				offset_ms = _timezone_offset_ms()
			piece = _TEXT_FORMAT.format_value(args, parsed.names[i], parsed.formatters[i], kind == _TEXT_FORMAT.PIECE_FORMATTED, culture, offset_ms)
			if _TEXT_FORMAT.failed:
				piece = _error_slot(key, parsed.texts[i])
		elif kind == _TEXT_FORMAT.PIECE_PROMPT:
			piece = _prompt_text(parsed.names[i], parsed.texts[i], icon_height, depth)
			is_icon = _prompt_was_icon
		else:
			piece = _error_slot(key, parsed.texts[i])
		var piece_length: int = 1 if is_icon else piece.length()
		if length + piece_length > _max_formatted_length:
			LogCore.log_error(_TAG, "text of " + key + " is longer than LocalizationCore.maxFormattedLength; the rest is cut")
			break
		length += piece_length
		out += piece if is_icon or not rich else piece.replace("[", "[lb]")
	return out


static func _parsed_text(key: String) -> _TEXT_FORMAT.Parsed:
	if _parsed.has(key):
		return _parsed[key] as _TEXT_FORMAT.Parsed
	var parsed: _TEXT_FORMAT.Parsed = _TEXT_FORMAT.parse(_texts[key])
	_parsed[key] = parsed
	return parsed


static func _error_slot(key: String, slot: String) -> String:
	LogCore.log_error(_TAG, "format error slot " + slot + " in " + key)
	return _DEV_MARK + slot if CoreBuildInfo.has_dev_code else ""


## The input prompt of an action: an inline icon when the height is more than 0 and its icon is loaded, else its
## display name. A nested display name leaves its own input prompt tokens empty.
static func _prompt_text(action: String, token: String, icon_height: int, depth: int) -> String:
	_prompt_was_icon = false
	if depth > 0:
		return ""
	if not InputCore.get_prompt(action, _prompt):
		if not _prompt_logged.has(action):
			_prompt_logged[action] = true
			LogCore.log_error(_TAG, "input prompt token of action " + action + " has no input prompt")
		return _DEV_MARK + token if CoreBuildInfo.has_dev_code else ""
	if icon_height > 0 and _icon_paths.has(_prompt.icon):
		_prompt_was_icon = true
		return "[img=0x%d]%s[/img]" % [icon_height, _icon_paths[_prompt.icon]]
	if _prompt.name_key.is_empty():
		return _prompt.input
	return _build(_prompt.name_key, null, 0, depth + 1)


static func _timezone_offset_ms() -> int:
	if _test_timezone_offset_set:
		return _test_timezone_offset_ms
	return _device_timezone_offset_ms()


# ogw:input_boundary
static func _device_timezone_offset_ms() -> int:
	var zone: Dictionary = Time.get_time_zone_from_system()
	if not zone.has("bias"):
		return 0
	var bias: Variant = zone["bias"]
	if bias is int:
		var minutes: int = bias
		return minutes * 60000
	return 0


static func _font_chain_keys() -> PackedStringArray:
	var keys: PackedStringArray = PackedStringArray()
	var visited: Dictionary[int, bool] = {}
	var language: int = _language
	while language != 0 and not visited.has(language) and GameData.LanguageTable.has_row(language):
		visited[language] = true
		var row: GameData.LanguageRow = GameData.LanguageTable.get_row(language)
		if not row.font.is_empty() and not keys.has(row.font):
			keys.append(row.font)
		language = row.fallback
	return keys


## Applies the fonts, of the resource keys `keys`, as the default font with `LocalizationCore.bodyFontWeight` and as
## the heading font with `LocalizationCore.headingFontWeight`. A Control without a theme of its own takes the
## `default_font` of the project theme when it has one, else of the engine default theme, before
## `ThemeDB.fallback_font`, so the default font goes to that theme, and the heading font to the font of the
## `_HEADING_TYPES` of the same theme.
static func _apply_fonts(fonts: Array[Font], keys: PackedStringArray) -> void:
	if fonts.is_empty():
		return
	if _font_theme == null:
		var project: Theme = ThemeDB.get_project_theme()
		_font_theme = project if project != null and project.has_default_font() else ThemeDB.get_default_theme()
		_saved_default_font = _font_theme.default_font
		var types: PackedStringArray = _font_theme.get_type_list()
		for type: StringName in _HEADING_TYPES:
			if types.has(type):
				_saved_heading_bases[type] = _font_theme.get_type_variation_base(type)
				var item: StringName = _heading_font_item(type)
				if _has_own_font(item, type):
					# `get_font` gives `default_font` for an item that holds no font.
					var own: Font = _font_theme.get_font(item, type)
					_saved_heading_fonts[type] = null if own == _saved_default_font else own
	_chain = _weighted_chain(fonts, keys, _body_font_weight, "body")
	_font_theme.default_font = _chain
	_heading_chain = _weighted_chain(fonts, keys, _heading_font_weight, "heading")
	for type: StringName in _HEADING_TYPES:
		_font_theme.set_type_variation(type, _HEADING_TYPES[type])
		_font_theme.set_font(_heading_font_item(type), type, _heading_chain)


## The font chain of one text style: the first font, then the rest as its fallbacks in order, each font drawn with
## `weight`. The chain itself carries the weight of the first font, because the engine does not draw the variation of
## a `FontVariation` that is the `base_font` of another; each fallback with the weight is a `FontVariation` of it.
static func _weighted_chain(fonts: Array[Font], keys: PackedStringArray, weight: int, style: String) -> FontVariation:
	var chain: FontVariation = FontVariation.new()
	chain.base_font = fonts[0]
	if _takes_weight(fonts[0], keys[0], weight, style):
		_set_weight(chain, weight)
	var fallbacks: Array[Font] = []
	for i: int in range(1, fonts.size()):
		if _takes_weight(fonts[i], keys[i], weight, style):
			var variation: FontVariation = FontVariation.new()
			variation.base_font = fonts[i]
			_set_weight(variation, weight)
			fallbacks.append(variation)
		else:
			fallbacks.append(fonts[i])
	chain.fallbacks = fallbacks
	return chain


## Whether a font is drawn with `weight` through a `FontVariation`: not when `weight` is 0 or the font has no `wght`
## axis. The engine draws a weight outside the axis range at the nearest end of it. Writes a warn log for a font
## without the axis or with `weight` outside its range.
static func _takes_weight(font: Font, key: String, weight: int, style: String) -> bool:
	if weight <= 0:
		return false
	var axis: Vector2i = _weight_axis(font, _wght_tag())
	if axis == _NO_WEIGHT_AXIS:
		LogCore.log_warn(_TAG, "font %s has no wght axis; the %s text style draws it at its default weight, not %d" % [key, style, weight])
		return false
	if weight < axis.x or weight > axis.y:
		LogCore.log_warn(_TAG, "font %s has the wght axis %d to %d; the %s text style draws it at %d, not %d" % [
			key, axis.x, axis.y, style, clampi(weight, axis.x, axis.y), weight])
	return true


static func _wght_tag() -> int:
	return TextServerManager.get_primary_interface().name_to_tag("wght")


## Sets `wght` of a `FontVariation` to `weight`. `variation_opentype` takes an untyped Dictionary: the engine looks
## its keys up as both tags and axis names, which a typed Dictionary refuses.
# ogw:input_boundary
static func _set_weight(variation: FontVariation, weight: int) -> void:
	var coordinates: Dictionary = {}
	coordinates[_wght_tag()] = weight
	variation.variation_opentype = coordinates


## The minimum and the maximum of the variation axis `tag` of a font; `_NO_WEIGHT_AXIS` when it has none. The axes
## are those of the first text server font of `get_rids()`, the font it draws with: the same as
## `get_supported_variation_list()` for a font with a text server font of its own, and the default font for a
## `SystemFont` that found no system font (as in the browser runtime), whose `get_supported_variation_list()` is an
## engine error.
# ogw:input_boundary
static func _weight_axis(font: Font, tag: int) -> Vector2i:
	var rids: Array[RID] = font.get_rids()
	if rids.is_empty():
		return _NO_WEIGHT_AXIS
	var axes: Dictionary = TextServerManager.get_primary_interface().font_supported_variation_list(rids[0])
	if not axes.has(tag):
		return _NO_WEIGHT_AXIS
	var axis: Variant = axes[tag]
	if not axis is Vector3i:
		return _NO_WEIGHT_AXIS
	var range_of: Vector3i = axis
	return Vector2i(range_of.x, range_of.y)


## The theme font item of a heading type: `normal_font` for the `RichTextLabel` one, `font` for the others.
static func _heading_font_item(type: StringName) -> StringName:
	return _RICH_FONT if _HEADING_TYPES[type] == &"RichTextLabel" else _FONT


## Puts the `_HEADING_TYPES` of `_font_theme` back to before the first `load_fonts`: a type it did not have is
## removed, and a type it had gets its base type and font item back, or loses the font item it did not have.
static func _restore_heading_types() -> void:
	for type: StringName in _HEADING_TYPES:
		if not _saved_heading_bases.has(type):
			_font_theme.remove_type(type)
			continue
		var base: StringName = _saved_heading_bases[type]
		if base.is_empty():
			_font_theme.clear_type_variation(type)
		else:
			_font_theme.set_type_variation(type, base)
		var item: StringName = _heading_font_item(type)
		if _saved_heading_fonts.has(type):
			_font_theme.set_font(item, type, _saved_heading_fonts[type])
		elif _has_own_font(item, type):
			_font_theme.clear_font(item, type)


## Whether the type `type` of `_font_theme` has the font item `item` of its own. `has_font` is also true for an item
## the type does not have when the theme has a default font.
static func _has_own_font(item: StringName, type: StringName) -> bool:
	return _font_theme.get_font_list(type).has(item)


static func _is_text_element(node: Node) -> bool:
	return node is Label or node is RichTextLabel or node is Button or node is LineEdit or node is TextEdit


static func _font_size_name(element: Control) -> StringName:
	return _RICH_FONT_SIZE if element is RichTextLabel else _FONT_SIZE


static func _scaled(size: int) -> int:
	return maxi(1, size * _text_scale / 1000)


## The UI text element of an instance ID; null when it is freed.
static func _text_element_of(id: int) -> Control:
	if not is_instance_id_valid(id):
		return null
	return instance_from_id(id) as Control


static func _track_tree(node: Node) -> void:
	_on_node_added(node)
	for child: Node in node.get_children(true):
		_track_tree(child)


static func _on_node_added(node: Node) -> void:
	if not _is_initialized or not _is_text_element(node):
		return
	var element: Control = node as Control
	var id: int = element.get_instance_id()
	if not _first_font_sizes.has(id):
		var name: StringName = _font_size_name(element)
		var size: int = element.get_theme_font_size(name)
		_first_font_sizes[id] = size
		element.add_theme_font_size_override(name, _scaled(size))
	# A bound rich text element is written again: its font size, the inline icon height, is set on tree entry.
	if element is RichTextLabel and _bindings.has(id):
		_write_bound(element, _bindings[id])


static func _on_node_removed(node: Node) -> void:
	var id: int = node.get_instance_id()
	if not _first_font_sizes.has(id):
		return
	var element: Control = node as Control
	element.add_theme_font_size_override(_font_size_name(element), _first_font_sizes[id])
	_first_font_sizes.erase(id)


static func _on_input_prompt_changed() -> void:
	if _is_initialized:
		_rewrite_bindings(false)


static func _write_bound(element: Control, key: String) -> void:
	if element is RichTextLabel:
		var rich: RichTextLabel = element as RichTextLabel
		rich.bbcode_enabled = true
		rich.text = _build(key, null, rich.get_theme_font_size(_RICH_FONT_SIZE), 0)
		return
	var text: String = _build(key, null, 0, 0)
	if element is Label:
		(element as Label).text = text
	elif element is Button:
		(element as Button).text = text
	elif element is LineEdit:
		(element as LineEdit).text = text
	elif element is TextEdit:
		(element as TextEdit).text = text


## Writes every bound element again; only rich text elements when `rich_only`.
static func _rewrite_bindings(rich_only: bool) -> void:
	_drop_freed_bindings()
	for id: int in _bindings.keys():
		var element: Control = _text_element_of(id)
		if element != null and (not rich_only or element is RichTextLabel):
			_write_bound(element, _bindings[id])


## Drops the bindings of freed elements. `bind_text` calls it only when `_bindings` reaches
## `_binding_sweep_size`, which then becomes twice the size left, so a `bind_text` walks the bindings once in
## amortized O(1) and `_bindings` holds at most about twice the live bindings.
static func _drop_freed_bindings() -> void:
	var gone: Array[int] = []
	for id: int in _bindings:
		if _text_element_of(id) == null:
			gone.append(id)
	for id: int in gone:
		_bindings.erase(id)
	_binding_sweep_size = maxi(_MIN_BINDING_SWEEP_SIZE, _bindings.size() * 2)


static func _on_core_node_exit(node: Node) -> void:
	if node == _node and _is_initialized:
		_clean_up(false)


## `release`: puts every state back to its value before `init`. `detach` removes the core node from the tree first.
static func _clean_up(detach: bool) -> void:
	var node: _CORE_NODE = _node
	_node = null
	_is_initialized = false
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if node != null and is_instance_valid(node):
		if EventCore.is_initialized():
			EventCore.unsubscribe_all(node)
		if tree != null:
			if tree.node_added.is_connected(node._on_node_added):
				tree.node_added.disconnect(node._on_node_added)
			if tree.node_removed.is_connected(node._on_node_removed):
				tree.node_removed.disconnect(node._on_node_removed)
	for id: int in _first_font_sizes:
		var element: Control = _text_element_of(id)
		if element != null:
			element.add_theme_font_size_override(_font_size_name(element), _first_font_sizes[id])
	if _font_theme != null:
		if _font_theme.default_font == _chain:
			_font_theme.default_font = _saved_default_font
		if _heading_chain != null:
			_restore_heading_types()
	_session = null
	_source_language = ""
	_downloaded_max_bytes = 0
	_max_formatted_length = 0
	_body_font_weight = 0
	_heading_font_weight = 0
	_resolve_called = false
	_language = 0
	_language_code = ""
	_texts = {}
	_parsed = {}
	_missing_logged = {}
	_prompt_logged = {}
	_translation_loading = false
	_fonts_loading = false
	_icons_loading = false
	_icon_paths = {}
	_font_theme = null
	_saved_default_font = null
	_chain = null
	_heading_chain = null
	_saved_heading_bases = {}
	_saved_heading_fonts = {}
	_text_scale = _DEFAULT_TEXT_SCALE
	_first_font_sizes = {}
	_bindings = {}
	_binding_sweep_size = _MIN_BINDING_SWEEP_SIZE
	_prompt = null
	_prompt_was_icon = false
	_test_device_language = ""
	_test_timezone_offset_set = false
	_test_timezone_offset_ms = 0
	if node != null and is_instance_valid(node):
		if detach and node.get_parent() != null:
			node.get_parent().remove_child(node)
		if not node.is_queued_for_deletion():
			node.queue_free()
