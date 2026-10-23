extends RefCounted
## Callbacks of one `NetworkCore.send` call. They keep the response and the failure for the operation that awaits
## the send.

## Output of the `NetworkCore.send` call.
var ok: bool = false
## Value `on_failure` returns: `true` when AuthCore shows the failure itself or not at all.
var handled: bool = false
## Response message of the success callback. `null` until it is called.
var response: ContractMessage = null
## Error code of the failure callback. 0 when it was not called or the failure is not a server error.
var error_code: int = 0


func _init(handles_failure: bool) -> void:
	handled = handles_failure


func on_success(message: ContractMessage) -> void:
	response = message


func on_failure(failure: RequestFailure) -> bool:
	if failure.kind == NetworkCore.FailureKind.SERVER_ERROR:
		error_code = failure.error_code
	return handled
