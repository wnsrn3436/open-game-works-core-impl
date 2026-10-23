extends RefCounted
## Callbacks of one `NetworkCore.send` call PaymentCore awaits. They keep the response and the error code, and the
## failure callback tells `NetworkCore` whether PaymentCore handles the failure itself.

## Output of the `NetworkCore.send` call.
var ok: bool = false
## Response message of the success callback. `null` until it is called.
var response: ContractMessage = null
## Error code of a server error failure. 0 when the failure callback was not called or the failure is not a server
## error.
var error_code: int = 0
## Error codes the failure callback returns `true` for.
var handled_codes: PackedInt32Array = PackedInt32Array()
## The failure callback returns `true` for every failure.
var handles_all: bool = false


func on_success(message: ContractMessage) -> void:
	response = message


func on_failure(failure: RequestFailure) -> bool:
	if failure.kind == NetworkCore.FailureKind.SERVER_ERROR:
		error_code = failure.error_code
	return handles_all or (error_code != 0 and handled_codes.has(error_code))
