class_name ErrorDisplay
extends RefCounted
## How a `SERVER_ERROR` is shown. Output of the `error_display` hook.

var kind: NetworkCore.ErrorDisplayKind = NetworkCore.ErrorDisplayKind.NONE
## Translation key of the toast or popup text.
var translation_key: String = ""
