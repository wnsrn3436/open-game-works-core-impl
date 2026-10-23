class_name NetworkCoreDev
extends RefCounted
## DEV operations of NetworkCore. NetworkCore reaches this code only through the DEV hooks set here.

const _TAG: String = "NetworkCore"
const _CHEAT_PREFIX: String = "cheat/"
const _CORE_CHEAT_PREFIX: String = "core/cheat/"
const _DEV_ACCESS_HEADER: String = "X-Ogw-Dev-Access"


## Sets the `NetworkTransport` NetworkCore sends through. Called before `init`; `release` drops it.
static func set_transport(transport: NetworkTransport) -> void:
	if NetworkCore._is_initialized:
		LogCore.log_error(_TAG, "set_transport called after init; ignored")
		return
	NetworkCore._transport = transport


## Makes every send that starts from now fail with `kind` (`TIMEOUT`, `CONNECTION_FAILED`, `INVALID_RESPONSE`)
## without the token and the transport. -1 stops it.
static func force_failure(kind: int) -> void:
	if not NetworkCore._is_initialized:
		LogCore.log_error(_TAG, "force_failure called before init")
		return
	if kind != -1 and kind != NetworkCore.FailureKind.TIMEOUT and kind != NetworkCore.FailureKind.CONNECTION_FAILED and kind != NetworkCore.FailureKind.INVALID_RESPONSE:
		LogCore.log_error(_TAG, "force_failure got a kind that is not a communication failure: %d" % kind)
		return
	NetworkCore._forced_failure = kind
	NetworkCore._dev_attempt_hook = _forced_attempt


## Takes every transport result as received `delay_ms` later. 0 stops it.
static func force_delay(delay_ms: int) -> void:
	if not NetworkCore._is_initialized:
		LogCore.log_error(_TAG, "force_delay called before init")
		return
	if delay_ms < 0:
		LogCore.log_error(_TAG, "force_delay got a negative delay: %d" % delay_ms)
		return
	NetworkCore._forced_delay_ms = delay_ms
	NetworkCore._dev_received_hook = _delay_result


## Fills `buffer` from index 0 with the request records in the order they ended. Returns the filled count.
static func get_request_records(buffer: Array[NetworkRequestRecord]) -> int:
	if not NetworkCore._is_initialized:
		LogCore.log_error(_TAG, "get_request_records called before init")
		return 0
	var records: Array[RefCounted] = NetworkCore._request_records
	var count: int = mini(records.size(), buffer.size())
	if records.size() > buffer.size():
		LogCore.log_error(_TAG, "get_request_records buffer holds %d of %d records" % [buffer.size(), records.size()])
	for i: int in count:
		var record: NetworkCore._RECORD = records[i] as NetworkCore._RECORD
		var out: NetworkRequestRecord = buffer[i]
		if out == null:
			out = NetworkRequestRecord.new()
			buffer[i] = out
		out.request_name = record.request_name
		out.kind = record.kind
		out.ok = record.ok
		out.error_code = record.error_code
		out.request_body = record.request_body
		out.response_body = record.response_body
	return count


## `NetworkCore.send_auth` of a `service CoreCheat` request, to `<base URL>/core/cheat/<rpc>`.
static func send_auth_cheat(request: ContractRequest, options: AuthSendOptions) -> AuthSendResult:
	if not NetworkCore._is_initialized:
		LogCore.log_error(_TAG, "send_auth_cheat called before init")
		return NetworkCore._failed_auth_result(request)
	if request == null or not request.request_name().begins_with(_CORE_CHEAT_PREFIX):
		LogCore.log_error(_TAG, "send_auth_cheat got a message that is not a request of service CoreCheat")
		return NetworkCore._failed_auth_result(request)
	var result: AuthSendResult = await NetworkCore._send_auth_request(NetworkCore._new_auth_request(request, options))
	return result


## Sets the `X-Ogw-Dev-Access` value of cheat requests. `release` drops it.
static func set_dev_access(value: String) -> void:
	if not NetworkCore._is_initialized:
		LogCore.log_error(_TAG, "set_dev_access called before init")
		return
	NetworkCore._dev_access = value
	NetworkCore._dev_header_hook = _dev_access_header


## A request of `service Cheat` or `service CoreCheat` through the queue of `NetworkCore.send`, as `Interaction`.
static func send_cheat(request: ContractRequest, on_success: Callable = Callable(), on_failure: Callable = Callable()) -> bool:
	if not NetworkCore._is_initialized:
		LogCore.log_error(_TAG, "send_cheat called before init")
		return false
	if not _is_cheat_request(request):
		LogCore.log_error(_TAG, "send_cheat got a message that is not a request of service Cheat or CoreCheat")
		return false
	var req: NetworkCore._REQUEST = NetworkCore._new_request(request, on_success, on_failure)
	req.kind = NetworkCore.RequestKind.INTERACTION
	req.sensitive = request.is_sensitive()
	NetworkCore._enqueue(req)
	if not req.done:
		await req.finished
	return req.ok


static func _is_cheat_request(request: ContractRequest) -> bool:
	if request == null:
		return false
	var request_name: String = request.request_name()
	return request_name.begins_with(_CHEAT_PREFIX) or request_name.begins_with(_CORE_CHEAT_PREFIX)


# The DEV hooks NetworkCore calls. Static functions, not lambdas: a lambda of this script still in a NetworkCore static
# var at engine exit can be the last reference to this script, and freeing it then aborts the engine.


## Ends the send attempt with the forced failure while one is set.
static func _forced_attempt(req: NetworkCore._REQUEST) -> bool:
	if NetworkCore._forced_failure < 0:
		return false
	req.outcome = NetworkCore._OUTCOME_FAILED
	req.failure = NetworkCore._new_failure(NetworkCore._forced_failure as NetworkCore.FailureKind, req)
	req.note = "forced failure"
	return true


## Holds the transport result of `w` for the forced delay; the timeout and the time sync take the delayed time.
static func _delay_result(w: NetworkCore._WAITER) -> bool:
	var delay_ms: int = NetworkCore._forced_delay_ms
	if delay_ms <= 0:
		return false
	w.received_monotonic += delay_ms
	w.deliver_at = TimeCore.get_real_time() + delay_ms
	return true


## The dev access header of a cheat request; an empty string for another request or no dev access.
static func _dev_access_header(req: NetworkCore._REQUEST) -> String:
	if NetworkCore._dev_access.is_empty() or not _is_cheat_request(req.message):
		return ""
	return "%s: %s" % [_DEV_ACCESS_HEADER, NetworkCore._dev_access]

