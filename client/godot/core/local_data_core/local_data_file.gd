extends RefCounted
## Memory state of one file kind: the file state and its load and write flags.

const _ENTRY = preload("res://core/local_data_core/local_data_entry.gd")

## File state: key to value.
var entries: Dictionary[String, _ENTRY] = {}
var loaded: bool = false
var dirty: bool = false
## Set by a load of a file with a higher schema version. The file kind is not written until its next load.
var write_protected: bool = false
## Path of the local data file under the app storage root. Set by the load.
var path: String = ""
## True after the error log of an operation on this file kind before its load.
var not_loaded_logged: bool = false
## Write failure causes logged since the last successful write. Key: `LocalDataCore._CAUSE_SIZE` or a `FileError`.
var logged_write_failures: Dictionary[int, bool] = {}
