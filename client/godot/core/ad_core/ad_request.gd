extends RefCounted
## The callbacks and the outcome of one `BeginAdReward` or `ClaimAdReward` that AdCore sends.

## `NetworkCore.send` returned `true`.
var ok: bool = false
## The response message, from the success callback.
var response: ContractMessage = null
## The failure callback was called.
var failed: bool = false
## Error code of a `SERVER_ERROR` failure; 0 otherwise.
var error_code: int = 0
## The failure was a communication failure (`TIMEOUT`, `CONNECTION_FAILED`, `INVALID_RESPONSE`).
var communication: bool = false


func on_success(message: ContractMessage) -> void:
	response = message


## Handles every failure: AdCore turns it into the `show` result.
func on_failure(failure: RequestFailure) -> bool:
	failed = true
	if failure.kind == NetworkCore.FailureKind.SERVER_ERROR:
		error_code = failure.error_code
	else:
		communication = true
	return true
