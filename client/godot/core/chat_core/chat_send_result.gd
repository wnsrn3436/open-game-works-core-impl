class_name ChatSendResult
extends RefCounted
## Result of `ChatCore.send_message`.

var ok: bool = false
## The message the server stored. `null` on failure.
var message: CoreContract.ChatMessage = null
## The `ServerError` error code of the failure; 0 otherwise.
var error_code: int = 0
