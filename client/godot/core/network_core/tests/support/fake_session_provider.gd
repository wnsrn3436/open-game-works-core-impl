extends SessionProvider
## `SessionProvider` of the NetworkCore core tests: queued results, call counts and holds the test releases.

## Emitted by `release_get` and `release_refresh`.
signal get_released
signal refresh_released

var access_token: String = "access-token-secret-1"
var signing_key: String = "signing-key-secret-1"
var get_calls: int = 0
var refresh_calls: int = 0
var replaced_calls: int = 0
## Results of the next calls, first first; an empty list gives a success with `access_token`.
var get_results: Array[GetAccessTokenResult] = []
var refresh_results: Array[GetAccessTokenResult] = []
## While true, the call waits for `release_get` or `release_refresh`.
var hold_get: bool = false
var hold_refresh: bool = false


func get_access_token() -> GetAccessTokenResult:
	get_calls += 1
	if hold_get:
		await get_released
	return _next(get_results)


func refresh_access_token() -> GetAccessTokenResult:
	refresh_calls += 1
	if hold_refresh:
		await refresh_released
	return _next(refresh_results)


func get_signing_key() -> String:
	return signing_key


func notify_session_replaced() -> void:
	replaced_calls += 1


func release_get() -> void:
	hold_get = false
	get_released.emit()


func release_refresh() -> void:
	hold_refresh = false
	refresh_released.emit()


func _next(results: Array[GetAccessTokenResult]) -> GetAccessTokenResult:
	if not results.is_empty():
		return results.pop_front()
	var result: GetAccessTokenResult = GetAccessTokenResult.new()
	result.ok = true
	result.access_token = access_token
	return result


## A failed result: `SERVER_ERROR` with `code` when it is above 0, `CONNECTION_FAILED` otherwise.
static func failed(code: int) -> GetAccessTokenResult:
	var result: GetAccessTokenResult = GetAccessTokenResult.new()
	result.failure = RequestFailure.new()
	result.failure.request_name = "core/RefreshToken"
	if code > 0:
		result.failure.kind = NetworkCore.FailureKind.SERVER_ERROR
		result.failure.error_code = code
		result.failure.http_status = 200
	else:
		result.failure.kind = NetworkCore.FailureKind.CONNECTION_FAILED
	return result
