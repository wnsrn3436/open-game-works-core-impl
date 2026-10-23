extends RefCounted
## Builds the JSON bytes of a test deploy list. Raw JSON fields let a test put a value of a wrong type.

const _FILE = preload("res://core/game_update_core/tests/support/deploy_list_file.gd")

## Raw JSON text of `format`.
var format_json: String = "1"
var environment: String = "DEV"
var sequence: int = 1000
var published_at: int = 1000
var file_base_url: String = "files/"
var platform: String = "android"
var has_app_entry: bool = true
var min_version: String = "1.0.0"
var recommended_version: String = "1.0.0"
var store_url: String = "https://store.example.com/app"
var app_version: String = "1.2.0"
var has_patch: bool = true
var data_version: String = ""
var data_files: Array[_FILE] = []
var translation_files: Array[_FILE] = []
var bundle_files: Array[_FILE] = []


static func make_file(name: String, content: String) -> _FILE:
	var file: _FILE = _FILE.new()
	file.name = name
	file.body = content.to_utf8_buffer()
	file.size = file.body.size()
	file.sha256 = UtilCore.sha256_hex(file.body)
	return file


## A bundle file named `name` of the bundle named after `name` without its extension.
static func make_bundle_file(name: String, content: String) -> _FILE:
	var file: _FILE = make_file(name, content)
	file.bundle = name.get_basename()
	return file


func to_bytes() -> PackedByteArray:
	return to_json().to_utf8_buffer()


func to_json() -> String:
	var app: String = "{}"
	if has_app_entry:
		app = "{%s:{\"min_version\":%s,\"recommended_version\":%s,\"store_url\":%s}}" % [
			JSON.stringify(platform), JSON.stringify(min_version), JSON.stringify(recommended_version),
			JSON.stringify(store_url)]
	var patches: String = "{}"
	if has_patch:
		patches = "{%s:{\"bundle_files\":%s,\"data_files\":%s,\"data_version\":%s,\"translation_files\":%s}}" % [
			JSON.stringify(app_version), _files_json(bundle_files), _files_json(data_files),
			JSON.stringify(data_version), _files_json(translation_files)]
	return "{\"app\":%s,\"environment\":%s,\"file_base_url\":%s,\"format\":%s,\"patches\":%s,\"published_at\":%d,\"sequence\":%d}" % [
		app, JSON.stringify(environment), JSON.stringify(file_base_url), format_json, patches, published_at, sequence]


func _files_json(files: Array[_FILE]) -> String:
	var items: PackedStringArray = PackedStringArray()
	for file: _FILE in files:
		var fields: PackedStringArray = PackedStringArray()
		if not file.bundle.is_empty():
			fields.append("\"bundle\":" + JSON.stringify(file.bundle))
		if not file.language.is_empty():
			fields.append("\"language\":" + JSON.stringify(file.language))
		fields.append("\"name\":" + JSON.stringify(file.name))
		fields.append("\"sha256\":" + JSON.stringify(file.sha256))
		fields.append("\"size\":" + (file.size_json if not file.size_json.is_empty() else str(file.size)))
		items.append("{" + ",".join(fields) + "}")
	return "[" + ",".join(items) + "]"
