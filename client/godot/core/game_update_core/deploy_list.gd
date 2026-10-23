extends RefCounted
## Reads the deploy list and its signature file, which are outside input, into typed values. `check` applies the
## format check to the deploy list fields `GameUpdateCore` uses, in the entries this app uses.

const _DEPLOY_LIST = preload("res://core/game_update_core/deploy_list.gd")
const _FILE_ENTRY = preload("res://core/game_update_core/update_file_entry.gd")

const _FORMAT: int = 1
## Largest integer a JSON number keeps exactly.
const _MAX_SAFE_INTEGER: float = 9007199254740991.0
const _HEX_DIGITS: String = "0123456789abcdef"
const _NAME_CHARS: String = "abcdefghijklmnopqrstuvwxyz0123456789_.-"
const _VERSION_PART_MAX_DIGITS: int = 18
const _URL_END_MARKS: PackedStringArray = ["?", "#"]

## Why reading or the format check failed. Empty when it passed.
var error: String = ""
## Signature file: `key_id`, `sequence`, `signature` (the decoded 64 bytes).
var key_id: String = ""
var sequence: int = -1
var signature: PackedByteArray = PackedByteArray()
## Deploy list fields.
var file_base_url: String = ""
var has_platform_entry: bool = false
var min_version: String = ""
var recommended_version: String = ""
var store_url: String = ""
var has_patch: bool = false
var data_version: String = ""
var data_files: Array[_FILE_ENTRY] = []
var translation_files: Array[_FILE_ENTRY] = []
var bundle_files: Array[_FILE_ENTRY] = []


## Reads a signature file. `error` is set when it is not one.
static func read_signature(bytes: PackedByteArray) -> _DEPLOY_LIST:
	var result: _DEPLOY_LIST = _DEPLOY_LIST.new()
	var json: JSON = _parse_json(bytes, result)
	if json != null:
		_read_signature_fields(json, result)
	return result


## Reads only `sequence` of a deploy list, before its signature is checked. -1 when it has none.
static func read_sequence(bytes: PackedByteArray) -> int:
	var json: JSON = _parse_json(bytes, _DEPLOY_LIST.new())
	return -1 if json == null else _sequence_of(json)


## Reads a deploy list and applies the format check for an app of `app_version` on `platform` that reads deploy
## lists of `environment` and has stored `min_sequence`. `error` is set when it fails.
static func check(bytes: PackedByteArray, environment: String, min_sequence: int, platform: String,
		app_version: String, file_max_bytes: int) -> _DEPLOY_LIST:
	var result: _DEPLOY_LIST = _DEPLOY_LIST.new()
	var json: JSON = _parse_json(bytes, result)
	if json != null:
		_check_fields(json, result, environment, min_sequence, platform, app_version, file_max_bytes)
	return result


## Whether `version` is `<major>.<minor>.<patch>`: three decimal integers without leading zeros.
static func is_version(version: String) -> bool:
	var parts: PackedStringArray = version.split(".")
	if parts.size() != 3:
		return false
	for part: String in parts:
		if part.is_empty() or part.length() > _VERSION_PART_MAX_DIGITS or not _is_digits(part):
			return false
		if part.length() > 1 and part.begins_with("0"):
			return false
	return true


## Compares two versions that pass `is_version`, number by number from the front: negative, 0 or positive.
static func compare_versions(a: String, b: String) -> int:
	var pa: PackedStringArray = a.split(".")
	var pb: PackedStringArray = b.split(".")
	for i: int in 3:
		var x: int = pa[i].to_int()
		var y: int = pb[i].to_int()
		if x != y:
			return -1 if x < y else 1
	return 0


## Whether `version` has the `data` skill data version form: two lowercase hex SHA-256 joined by `-`.
static func is_data_version(version: String) -> bool:
	return version.length() == 129 and version[64] == "-" and _is_sha256(version.substr(0, 64)) \
			and _is_sha256(version.substr(65))


## Protocol hash of a data version: the part before the first `-`.
static func protocol_hash(version: String) -> String:
	var index: int = version.find("-")
	return version if index < 0 else version.substr(0, index)


## `relative` resolved against `base`, the deploy list URL. An absolute `relative` is returned as is.
static func resolve_url(base: String, relative: String) -> String:
	if _has_scheme(relative):
		return relative
	var scheme_end: int = base.find("://")
	if relative.begins_with("//"):
		return (base.substr(0, scheme_end + 1) if scheme_end >= 0 else "") + relative
	var path_base: String = base
	for mark: String in _URL_END_MARKS:
		var at: int = path_base.find(mark)
		if at >= 0:
			path_base = path_base.substr(0, at)
	if relative.begins_with("/"):
		var host_end: int = path_base.find("/", scheme_end + 3) if scheme_end >= 0 else 0
		return (path_base if host_end < 0 else path_base.substr(0, host_end)) + relative
	var last_slash: int = path_base.rfind("/")
	if scheme_end >= 0 and last_slash < scheme_end + 3:
		return path_base + "/" + relative
	return path_base.substr(0, last_slash + 1) + relative


## The parsed JSON of `bytes`. `null`, with `error` set, when it is not BOM-less UTF-8 JSON.
static func _parse_json(bytes: PackedByteArray, result: _DEPLOY_LIST) -> JSON:
	if not _is_utf8_without_bom(bytes):
		result.error = "not BOM-less UTF-8"
		return null
	var json: JSON = JSON.new()
	if json.parse(bytes.get_string_from_utf8()) != OK:
		result.error = "not JSON"
		return null
	return json


# ogw:input_boundary
static func _sequence_of(json: JSON) -> int:
	var data: Variant = json.data
	if not data is Dictionary:
		return -1
	var root: Dictionary = data
	return _read_sequence(root)


# ogw:input_boundary
static func _read_signature_fields(json: JSON, result: _DEPLOY_LIST) -> void:
	var data: Variant = json.data
	if not data is Dictionary:
		result.error = "not a JSON object"
		return
	var root: Dictionary = data
	var id: Variant = root.get("key_id")
	var text: Variant = root.get("signature")
	var seq: int = _read_sequence(root)
	if not id is String or not text is String or seq < 0:
		result.error = "signature file fields"
		return
	var text_string: String = text
	var bytes: PackedByteArray = _decode_base64(text_string, 64)
	if bytes.is_empty():
		result.error = "signature is not 64 bytes of standard base64"
		return
	result.key_id = id
	result.sequence = seq
	result.signature = bytes


# ogw:input_boundary
static func _read_sequence(root: Dictionary) -> int:
	var value: Variant = root.get("sequence")
	return _to_int(value, 0)


# ogw:input_boundary
static func _check_fields(json: JSON, result: _DEPLOY_LIST, environment: String, min_sequence: int,
		platform: String, app_version: String, file_max_bytes: int) -> void:
	var data: Variant = json.data
	if not data is Dictionary:
		result.error = "not a JSON object"
		return
	var root: Dictionary = data
	var format: Variant = root.get("format")
	var env: Variant = root.get("environment")
	var base: Variant = root.get("file_base_url")
	var app: Variant = root.get("app")
	var patches: Variant = root.get("patches")
	var seq: int = _read_sequence(root)
	if _to_int(format, 0) != _FORMAT:
		result.error = "format is not 1"
	elif not env is String or env != environment:
		result.error = "environment is not " + environment
	elif seq < 0:
		result.error = "sequence is not an integer"
	elif seq < min_sequence:
		result.error = "sequence is below the stored sequence " + str(min_sequence)
	elif not base is String:
		result.error = "file_base_url is not a string"
	elif not app is Dictionary or not patches is Dictionary:
		result.error = "app or patches is not an object"
	if not result.error.is_empty():
		return
	result.sequence = seq
	result.file_base_url = base
	var app_map: Dictionary = app
	if app_map.has(platform):
		_check_platform_entry(app_map[platform], result)
		if not result.error.is_empty():
			return
	var patch_map: Dictionary = patches
	if patch_map.has(app_version):
		_check_patch(patch_map[app_version], result, file_max_bytes)


# ogw:input_boundary
static func _check_platform_entry(entry: Variant, result: _DEPLOY_LIST) -> void:
	if not entry is Dictionary:
		result.error = "platform entry is not an object"
		return
	var map: Dictionary = entry
	var min_value: Variant = map.get("min_version")
	var recommended: Variant = map.get("recommended_version")
	var url: Variant = map.get("store_url")
	if not min_value is String or not recommended is String or not url is String:
		result.error = "platform entry fields"
		return
	var min_string: String = min_value
	var recommended_string: String = recommended
	if not is_version(min_string) or not is_version(recommended_string):
		result.error = "platform entry version form"
		return
	result.has_platform_entry = true
	result.min_version = min_string
	result.recommended_version = recommended_string
	result.store_url = url


# ogw:input_boundary
static func _check_patch(entry: Variant, result: _DEPLOY_LIST, file_max_bytes: int) -> void:
	if not entry is Dictionary:
		result.error = "patch entry is not an object"
		return
	var map: Dictionary = entry
	var version: Variant = map.get("data_version")
	if not version is String:
		result.error = "data_version is not a string"
		return
	var version_string: String = version
	if not is_data_version(version_string):
		result.error = "data_version form"
		return
	var data_list: Array[_FILE_ENTRY] = _read_files(map.get("data_files"), "", result, file_max_bytes)
	var translation_list: Array[_FILE_ENTRY] = _read_files(map.get("translation_files"), "language", result,
			file_max_bytes)
	var bundle_list: Array[_FILE_ENTRY] = _read_files(map.get("bundle_files"), "bundle", result, file_max_bytes)
	if not result.error.is_empty():
		return
	var names: Dictionary[String, bool] = {}
	var languages: Dictionary[String, bool] = {}
	for list: Array[_FILE_ENTRY] in [data_list, translation_list, bundle_list]:
		for file: _FILE_ENTRY in list:
			if names.has(file.name):
				result.error = "duplicate name " + file.name
				return
			names[file.name] = true
	for file: _FILE_ENTRY in translation_list:
		if languages.has(file.language):
			result.error = "duplicate language " + file.language
			return
		languages[file.language] = true
	result.has_patch = true
	result.data_version = version_string
	result.data_files = data_list
	result.translation_files = translation_list
	result.bundle_files = bundle_list


## Reads a file list. `extra` is the one more string field of the items: empty, `language` or `bundle`.
# ogw:input_boundary
static func _read_files(value: Variant, extra: String, result: _DEPLOY_LIST, file_max_bytes: int) -> Array[_FILE_ENTRY]:
	var files: Array[_FILE_ENTRY] = []
	if not result.error.is_empty():
		return files
	if not value is Array:
		result.error = "file list is not an array"
		return files
	var items: Array = value
	for item: Variant in items:
		if not item is Dictionary:
			result.error = "file list item is not an object"
			return files
		var map: Dictionary = item
		var name: Variant = map.get("name")
		var digest: Variant = map.get("sha256")
		var extra_value: Variant = map.get(extra) if not extra.is_empty() else ""
		var size: int = _to_int(map.get("size"), 1)
		if not name is String or not digest is String or not extra_value is String:
			result.error = "file list item fields"
			return files
		var name_string: String = name
		var digest_string: String = digest
		if not _is_file_name(name_string):
			result.error = "file name form"
			return files
		if size < 1 or size > file_max_bytes:
			result.error = "file size out of range"
			return files
		if not _is_sha256(digest_string):
			result.error = "sha256 form"
			return files
		var file: _FILE_ENTRY = _FILE_ENTRY.new()
		file.name = name_string
		file.size = size
		file.sha256 = digest_string
		if extra == "language":
			file.language = extra_value
		elif extra == "bundle":
			file.bundle = extra_value
		files.append(file)
	return files


## The integer value of a JSON number that is an integer of at least `min_value`. -1 otherwise.
# ogw:input_boundary
static func _to_int(value: Variant, min_value: int) -> int:
	var number: float = 0.0
	if value is int:
		var integer_value: int = value
		number = float(integer_value)
	elif value is float:
		number = value
	else:
		return -1
	if not is_finite(number) or number != floorf(number) or absf(number) > _MAX_SAFE_INTEGER:
		return -1
	var integer: int = int(number)
	return integer if integer >= min_value else -1


static func _decode_base64(text: String, size: int) -> PackedByteArray:
	var expected_length: int = (size + 2) / 3 * 4
	if text.length() != expected_length:
		return PackedByteArray()
	var padding: int = (3 - size % 3) % 3
	for i: int in text.length():
		var c: int = text.unicode_at(i)
		var is_pad: bool = c == 0x3D
		if i >= expected_length - padding:
			if not is_pad:
				return PackedByteArray()
		elif not _is_base64_char(c):
			return PackedByteArray()
	var bytes: PackedByteArray = Marshalls.base64_to_raw(text)
	return bytes if bytes.size() == size else PackedByteArray()


static func _is_base64_char(c: int) -> bool:
	return (c >= 0x41 and c <= 0x5A) or (c >= 0x61 and c <= 0x7A) or (c >= 0x30 and c <= 0x39) or c == 0x2B \
			or c == 0x2F


static func _is_file_name(name: String) -> bool:
	if name.is_empty() or name.begins_with(".") or name.ends_with(".tmp") or name.ends_with(".bak"):
		return false
	for i: int in name.length():
		if not _NAME_CHARS.contains(name[i]):
			return false
	return true


static func _is_sha256(text: String) -> bool:
	if text.length() != 64:
		return false
	for i: int in 64:
		if not _HEX_DIGITS.contains(text[i]):
			return false
	return true


static func _is_digits(text: String) -> bool:
	for i: int in text.length():
		var c: int = text.unicode_at(i)
		if c < 0x30 or c > 0x39:
			return false
	return true


static func _has_scheme(url: String) -> bool:
	var colon: int = url.find(":")
	if colon <= 0:
		return false
	for i: int in colon:
		var c: int = url.unicode_at(i)
		var letter: bool = (c >= 0x41 and c <= 0x5A) or (c >= 0x61 and c <= 0x7A)
		if not letter and (i == 0 or not ((c >= 0x30 and c <= 0x39) or c == 0x2B or c == 0x2D or c == 0x2E)):
			return false
	return true


## Whether `bytes` is well-formed UTF-8 that does not start with a BOM. Checked before decoding, so the engine does
## not report decoding errors for outside input.
static func _is_utf8_without_bom(bytes: PackedByteArray) -> bool:
	var size: int = bytes.size()
	if size >= 3 and bytes[0] == 0xEF and bytes[1] == 0xBB and bytes[2] == 0xBF:
		return false
	var i: int = 0
	while i < size:
		var b: int = bytes[i]
		var extra: int = 0
		var min_code: int = 0
		var code: int = 0
		if b == 0:
			return false
		if b < 0x80:
			i += 1
			continue
		elif b >= 0xC2 and b <= 0xDF:
			extra = 1
			min_code = 0x80
			code = b & 0x1F
		elif b >= 0xE0 and b <= 0xEF:
			extra = 2
			min_code = 0x800
			code = b & 0x0F
		elif b >= 0xF0 and b <= 0xF4:
			extra = 3
			min_code = 0x10000
			code = b & 0x07
		else:
			return false
		if i + extra >= size:
			return false
		for k: int in range(1, extra + 1):
			var next: int = bytes[i + k]
			if next & 0xC0 != 0x80:
				return false
			code = (code << 6) | (next & 0x3F)
		if code < min_code or code > 0x10FFFF or (code >= 0xD800 and code <= 0xDFFF):
			return false
		i += extra + 1
	return true
