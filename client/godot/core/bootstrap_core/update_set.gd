extends RefCounted
## Update set of `BootstrapCore`: the downloaded data, translations and bundles a boot applies.

## Downloaded data. `null` when there is none.
var data: DownloadedData = null
## Downloaded translations.
var translations: Array[DownloadedTranslation] = []
## Downloaded bundles.
var bundles: Array[DownloadedBundle] = []


## Whether the set has nothing.
func is_empty() -> bool:
	return data == null and translations.is_empty() and bundles.is_empty()


## Whether this set equals the set of `other_data`, `other_translations` and `other_bundles`: the same data
## version and data file SHA-256 set, the same (language, SHA-256) set of translations and the same
## (bundle name, SHA-256) list of bundles.
func same_as(
		other_data: DownloadedData,
		other_translations: Array[DownloadedTranslation],
		other_bundles: Array[DownloadedBundle]
) -> bool:
	if not _same_data(data, other_data):
		return false
	if _translation_keys(translations) != _translation_keys(other_translations):
		return false
	return _bundle_keys(bundles) == _bundle_keys(other_bundles)


static func _same_data(a: DownloadedData, b: DownloadedData) -> bool:
	if a == null or b == null:
		return a == null and b == null
	if a.data_version != b.data_version:
		return false
	return _data_file_keys(a) == _data_file_keys(b)


static func _data_file_keys(value: DownloadedData) -> PackedStringArray:
	var keys := PackedStringArray()
	for path: String in value.files:
		keys.append(value.files[path])
	keys.sort()
	return keys


static func _translation_keys(list: Array[DownloadedTranslation]) -> PackedStringArray:
	var keys := PackedStringArray()
	for item: DownloadedTranslation in list:
		keys.append("%s\n%s" % [item.code, item.sha256])
	keys.sort()
	return keys


static func _bundle_keys(list: Array[DownloadedBundle]) -> PackedStringArray:
	var keys := PackedStringArray()
	for item: DownloadedBundle in list:
		keys.append("%s\n%s" % [item.name, item.sha256])
	return keys
