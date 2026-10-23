class_name DownloadedData
extends RefCounted
## Client table binaries that `GameUpdateCore` downloaded into app storage, for `DataCore.load`.

## Data version of the files.
var data_version: String = ""
## SHA-256 lowercase hex of each file, by app storage path.
var files: Dictionary[String, String] = {}
