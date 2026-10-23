class_name RunCommandResult
extends RefCounted
## Result of `QACore.run_command` and of a content command handler: (`ok`, `result`, `bytes`).

var ok: bool = false
## JSON text of `result`: a JSON value, or a JSON string with the English reason of a failure. Empty for none.
var result: String = ""
## Bytes of the result, for example the PNG of `capture_screen`. Empty for none.
var bytes: PackedByteArray = PackedByteArray()
