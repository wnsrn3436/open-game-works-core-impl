extends RefCounted
## Callbacks of one `NetworkCore.send` call of ChatCore. They keep the response and the error code for the coroutine
## that awaits the send.

## Response message of the success callback. `null` until it is called.
var response: ContractMessage = null
## Error code of a `SERVER_ERROR` failure. 0 when the failure callback was not called or the failure is not a server
## error.
var error_code: int = 0


func on_success(message: ContractMessage) -> void:
	response = message


## Returns `false`: NetworkCore does its default handling.
func on_failure(failure: RequestFailure) -> bool:
	if failure.kind == NetworkCore.FailureKind.SERVER_ERROR:
		error_code = failure.error_code
	return false
