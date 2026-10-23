class_name FileResult
extends RefCounted
## Result of a `LocalDataCore` file operation.

## True when the operation succeeded.
var ok: bool = false
## Why the operation failed. `NONE` on success.
var error: LocalDataCore.FileError = LocalDataCore.FileError.NONE
## File bytes. Only `read_file` fills it.
var bytes: PackedByteArray = PackedByteArray()
## SHA-256 as 64 lowercase hex digits. Only `hash_file` fills it.
var text: String = ""
