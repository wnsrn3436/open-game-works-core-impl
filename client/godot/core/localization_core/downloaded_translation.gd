class_name DownloadedTranslation
extends RefCounted
## A translation binary that `GameUpdateCore` downloaded to app storage, for `LocalizationCore.load_translation`.

## The language `code` of the translation.
var code: String = ""
## The app storage path of the translation binary.
var path: String = ""
## SHA-256 of the file, lower-case hex.
var sha256: String = ""
## The data version the translation was built with.
var data_version: String = ""
