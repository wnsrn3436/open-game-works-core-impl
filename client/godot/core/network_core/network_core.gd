class_name NetworkCore
extends RefCounted
## Sends contract `rpc` requests to the server, processes the response envelope, handles failures by request kind
## and passes UserState deltas to `UserStateCore`.

## Request kind, from the `rpc` options.
enum RequestKind { INTERACTION, RETRY, SILENT, SILENT_RETRY }
enum FailureKind { TIMEOUT, CONNECTION_FAILED, INVALID_RESPONSE, SERVER_ERROR }
enum ErrorDisplayKind { NONE, TOAST, POPUP, POPUP_RESTART }
## Transfer result of `NetworkTransport.send`.
enum TransferResult { DONE, CONNECTION_FAILED, REDIRECTED, TOO_LARGE }

const _TAG: String = "NetworkCore"
const _NODE := preload("res://core/network_core/network_core_node.gd")
const _REQUEST := preload("res://core/network_core/network_request.gd")
const _WAITER := preload("res://core/network_core/network_waiter.gd")
const _HTTP_TRANSPORT := preload("res://core/network_core/http_network_transport.gd")
const _WEB_TRANSPORT := preload("res://core/network_core/web_network_transport.gd")
const _RECORD := preload("res://core/network_core/network_record.gd")

const _OUTCOME_RESPONSE: int = 0
## Ended without callback, default handling or log: session end state.
const _OUTCOME_DISCARDED: int = 1
## Ended without callback, default handling or log: the `SessionProvider` failed with `SESSION_REPLACED`.
const _OUTCOME_SILENT_END: int = 2
## `failure` holds a failure that did not come from a response.
const _OUTCOME_FAILED: int = 3

const _NEXT_DONE: int = 0
const _NEXT_RESEND: int = 1

const _PLATFORMS: PackedStringArray = ["android", "ios", "web", "windows", "macos", "linux"]
const _FAILURE_NAMES: PackedStringArray = ["Timeout", "ConnectionFailed", "InvalidResponse", "ServerError"]
## Responses whose `server_time_at` is not synced while a `SessionProvider` is set.
const _NO_SESSION_SYNC: PackedStringArray = ["core/Login", "core/GetTerms", "core/GetNotices"]
const _RESYNC: String = "core/Resync"
const _REPORT_ERRORS: String = "core/ReportClientErrors"
const _REPORT_EVENTS: String = "core/ReportAnalyticsEvents"
## `ClientErrorEntry.level` values.
const _LEVEL_WARN: String = "warn"
const _LEVEL_ERROR: String = "error"
const _CHEAT_PREFIX: String = "cheat/"
const _CORE_CHEAT_PREFIX: String = "core/cheat/"
const _BLOCK_REASON: String = "network"

static var _is_initialized: bool = false
## New object on every `init` and `release`: a coroutine that sees another object stops.
static var _session: RefCounted = RefCounted.new()
static var _node: Node = null
static var _crypto: Crypto = null
static var _due_call: Callable = Callable()
static var _due_queued: bool = false

static var _request_timeout_ms: int = 0
static var _retry_count: int = 0
static var _retry_delay_ms: int = 0
static var _retry_delay_factor_permille: int = 0
static var _retry_delay_max_ms: int = 0
static var _max_retry_age_ms: int = 0
static var _loading_icon_delay_ms: int = 0
static var _response_max_bytes: int = 0

## Set by the DEV operation `set_transport` before `init`.
static var _transport: NetworkTransport = null
static var _active_transport: NetworkTransport = null
static var _next_handle: int = 0

static var _has_server_info: bool = false
static var _base_url: String = ""
static var _app_version: String = ""
static var _platform: String = ""

static var _provider: SessionProvider = null
static var _had_provider: bool = false
static var _session_ended: bool = false
static var _full_resync: bool = false

static var _queue: Array[_REQUEST] = []
static var _current: _REQUEST = null
## The current request is processing its result: response processing or failure flow.
static var _current_processing: bool = false
static var _pumping: bool = false
## Requests that did not end: queued, current and `send_auth`.
static var _live: Array[_REQUEST] = []
static var _waiters: Array[_WAITER] = []

static var _blocked: bool = false
static var _block_token: int = 0
static var _block_started_at: int = 0
static var _loading_shown: bool = false
static var _loading_token: int = 0

static var _error_display_hook: Callable = Callable()

## DEV state, read and written by the DEV code: the failure kind it forces (`FailureKind` or -1), the delay it
## forces and dev access. Then the request records (oldest first) and their count, which `init` reads in a run with
## DEV code and 0 otherwise; the DEV code reads the records.
static var _forced_failure: int = -1
static var _forced_delay_ms: int = 0
static var _dev_access: String = ""
static var _request_records: Array[RefCounted] = []
static var _dev_request_record_count: int = 0
## DEV hooks: static functions the DEV code sets. Empty in a build without DEV code.
## `(req) -> bool`: true when it ended the send attempt, with `req.outcome`, `req.failure` and `req.note` set.
static var _dev_attempt_hook: Callable = Callable()
## `(w) -> bool`: true when it holds the transport result of `w` until `w.deliver_at`.
static var _dev_received_hook: Callable = Callable()
## `(req) -> String`: a header line `req` carries in addition; an empty string for none.
static var _dev_header_hook: Callable = Callable()


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init called while initialized")
		return false
	if not _read_settings():
		return false
	_crypto = Crypto.new()
	_session = RefCounted.new()
	var node: _NODE = _NODE.new()
	node.name = "NetworkCore"
	node.process_mode = Node.PROCESS_MODE_ALWAYS
	(Engine.get_main_loop() as SceneTree).root.add_child(node)
	if not EventCore.subscribe(AppForegroundReturnedEvent, node.on_foreground_returned):
		LogCore.log_error(_TAG, "init could not subscribe AppForegroundReturnedEvent")
		node.released = true
		node.get_parent().remove_child(node)
		node.queue_free()
		_reset_state()
		return false
	_node = node
	_due_call = NetworkCore._run_due
	if _transport != null:
		_active_transport = _transport
	elif OS.get_name() == "Web":
		# The engine HTTP client of the web export follows redirects whatever `max_redirects` is.
		_active_transport = _WEB_TRANSPORT.new(node, _response_max_bytes)
	else:
		_active_transport = _HTTP_TRANSPORT.new(node, _response_max_bytes)
	_is_initialized = true
	return true


static func release() -> void:
	if not _is_initialized:
		return
	_cleanup(true)


static func is_initialized() -> bool:
	return _is_initialized


static func set_server_info(base_url: String, app_version: String, platform: String) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "set_server_info called before init")
		return false
	if not _is_valid_base_url(base_url):
		LogCore.log_error(_TAG, "set_server_info got a base URL that is not allowed")
		return false
	if not _PLATFORMS.has(platform):
		LogCore.log_error(_TAG, "set_server_info got an unknown platform: %s" % platform)
		return false
	if not app_version.is_empty() and not _is_version(app_version):
		LogCore.log_error(_TAG, "set_server_info got an app version that is not <major>.<minor>.<patch>: %s" % app_version)
		return false
	_base_url = base_url.trim_suffix("/")
	_app_version = app_version
	_platform = platform
	_has_server_info = true
	return true


static func set_session_provider(provider: SessionProvider) -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "set_session_provider called before init")
		return
	if provider != null:
		_provider = provider
		_had_provider = true
		_session_ended = false
		_full_resync = false
		LogCore.set_sender((_node as _NODE).on_log_batch)
		return
	_provider = null
	LogCore.clear_sender()
	if not _had_provider:
		return
	_session_ended = true
	var dropped: Array[_REQUEST] = _queue.duplicate()
	_queue.clear()
	for req: _REQUEST in dropped:
		_end_discarded(req)
	_update_block()
	if not dropped.is_empty():
		LogCore.log_warn(_TAG, "session ended: dropped %d queued requests" % dropped.size())


static func send(request: ContractRequest, on_success: Callable = Callable(), on_failure: Callable = Callable(), options: SendOptions = null) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "send called before init")
		return false
	if not _is_contract_request(request):
		LogCore.log_error(_TAG, "send got a message that is not a request of service Game or Core")
		return false
	var req: _REQUEST = _new_request(request, on_success, on_failure)
	req.from_send = true
	req.sensitive = request.is_sensitive() or (options != null and options.sensitive)
	_enqueue(req)
	if not req.done:
		await req.finished
	return req.ok


static func resync() -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "resync called before init")
		return false
	return await send(CoreContract.ResyncRequest.new())


static func send_auth(request: ContractRequest, options: AuthSendOptions) -> AuthSendResult:
	if not _is_initialized:
		LogCore.log_error(_TAG, "send_auth called before init")
		return _failed_auth_result(request)
	if not _is_contract_request(request):
		LogCore.log_error(_TAG, "send_auth got a message that is not a request of service Game or Core")
		return _failed_auth_result(request)
	return await _send_auth_request(_new_auth_request(request, options))


static func notify_server_error(error_code: int) -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "notify_server_error called before init")
		return
	if error_code == CoreContract.CoreError.CORE_ERROR_SESSION_REPLACED:
		if _provider != null:
			_provider.notify_session_replaced()
	elif _is_update_error(error_code):
		_publish_update_required(error_code)


## Registers the `error_display` hook: a static func `(error_code: int, request_name: String) -> ErrorDisplay`.
static func register_error_display(hook: Callable) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "register_error_display called before init")
		return false
	if not (hook.is_valid() and hook.is_standard() and hook.get_object() is Script):
		LogCore.log_error(_TAG, "register_error_display got a hook that is not a static func")
		return false
	if not _error_display_hook.is_null():
		LogCore.log_error(_TAG, "register_error_display called twice; the later hook is ignored")
		return false
	_error_display_hook = hook
	return true


# --- lifecycle ---


static func _read_settings() -> bool:
	var keys: PackedStringArray = [
		"NetworkCore.requestTimeoutMs", "NetworkCore.retryCount", "NetworkCore.retryDelayMs",
		"NetworkCore.retryDelayFactorPermille", "NetworkCore.retryDelayMaxMs", "NetworkCore.maxRetryAgeMs",
		"NetworkCore.loadingIconDelayMs", "NetworkCore.responseMaxBytes",
	]
	# The request records are kept from `init` in a run with DEV code.
	if CoreBuildInfo.has_dev_code:
		keys.append("NetworkCore.devRequestRecordCount")
	var values: PackedInt64Array = PackedInt64Array()
	for key: String in keys:
		if not CoreSettings.has_int(key):
			LogCore.log_error(_TAG, "core settings has no integer %s" % key)
			return false
		values.append(CoreSettings.get_int(key))
	_request_timeout_ms = values[0]
	_retry_count = values[1]
	_retry_delay_ms = values[2]
	_retry_delay_factor_permille = values[3]
	_retry_delay_max_ms = values[4]
	_max_retry_age_ms = values[5]
	_loading_icon_delay_ms = values[6]
	_response_max_bytes = values[7]
	_dev_request_record_count = values[8] if CoreBuildInfo.has_dev_code else 0
	return true


## `release`, and the cleanup of the core node leaving the tree outside `release` (`remove_node` false).
static func _cleanup(remove_node: bool) -> void:
	var node: _NODE = _node as _NODE
	var transport: NetworkTransport = _active_transport
	var in_flight: PackedInt64Array = PackedInt64Array()
	for w: _WAITER in _waiters:
		if w.is_transport and w.result == null and not w.fired:
			in_flight.append(w.handle)
	var live: Array[_REQUEST] = _live
	var waiters: Array[_WAITER] = _waiters
	var blocked: bool = _blocked
	var block_token: int = _block_token
	var loading_shown: bool = _loading_shown
	var loading_token: int = _loading_token
	_reset_state()
	if transport != null:
		for handle: int in in_flight:
			transport.cancel(handle)
	if InputBlockCore.is_initialized():
		if blocked and InputBlockCore.is_active(block_token):
			InputBlockCore.unblock(block_token)
		InputBlockCore.set_timer_hold(_BLOCK_REASON, false)
	if loading_shown and UICore.is_initialized():
		UICore.hide_loading_icon(loading_token)
	if LogCore.is_initialized():
		LogCore.clear_sender()
	if node != null and is_instance_valid(node):
		if EventCore.is_initialized():
			EventCore.unsubscribe_all(node)
		node.released = true
		if remove_node and node.get_parent() != null:
			node.get_parent().remove_child(node)
		node.queue_free()
	for req: _REQUEST in live:
		req.finish(false)
	for w: _WAITER in waiters:
		w.fire()


static func _reset_state() -> void:
	_is_initialized = false
	_session = RefCounted.new()
	_node = null
	_crypto = null
	_due_call = Callable()
	_due_queued = false
	_request_timeout_ms = 0
	_retry_count = 0
	_retry_delay_ms = 0
	_retry_delay_factor_permille = 0
	_retry_delay_max_ms = 0
	_max_retry_age_ms = 0
	_loading_icon_delay_ms = 0
	_response_max_bytes = 0
	_transport = null
	_active_transport = null
	_next_handle = 0
	_has_server_info = false
	_base_url = ""
	_app_version = ""
	_platform = ""
	_provider = null
	_had_provider = false
	_session_ended = false
	_full_resync = false
	_queue = []
	_current = null
	_current_processing = false
	_pumping = false
	_live = []
	_waiters = []
	_blocked = false
	_block_token = 0
	_block_started_at = 0
	_loading_shown = false
	_loading_token = 0
	_error_display_hook = Callable()
	_forced_failure = -1
	_forced_delay_ms = 0
	_dev_access = ""
	_request_records = []
	_dev_request_record_count = 0
	_dev_attempt_hook = Callable()
	_dev_received_hook = Callable()
	_dev_header_hook = Callable()


static func _on_node_exit(node: Node) -> void:
	if _is_initialized and node == _node:
		_cleanup(false)


# --- queue ---


static func _new_request(request: ContractRequest, on_success: Callable, on_failure: Callable) -> _REQUEST:
	var req: _REQUEST = _REQUEST.new()
	req.message = request
	req.request_name = request.request_name()
	req.kind = _kind_of(request)
	req.on_success = on_success
	req.on_failure = on_failure
	req.request_id = _new_request_id()
	return req


static func _kind_of(request: ContractRequest) -> RequestKind:
	if request.is_silent():
		return RequestKind.SILENT_RETRY if request.is_retry() else RequestKind.SILENT
	return RequestKind.RETRY if request.is_retry() else RequestKind.INTERACTION


## True for a request message of `service Game` or `service Core`.
static func _is_contract_request(request: ContractRequest) -> bool:
	if request == null:
		return false
	var request_name: String = request.request_name()
	if request_name.is_empty():
		return false
	return not (request_name.begins_with(_CHEAT_PREFIX) or request_name.begins_with(_CORE_CHEAT_PREFIX))


static func _enqueue(req: _REQUEST) -> void:
	_queue.append(req)
	_live.append(req)
	_update_block()
	if not _pumping:
		_pump()


static func _pump() -> void:
	var session: RefCounted = _session
	_pumping = true
	while not _queue.is_empty():
		var req: _REQUEST = _queue.pop_front()
		_current = req
		_current_processing = false
		await _run_queued(req)
		if session != _session:
			return
		_current = null
		_current_processing = false
		_update_block()
	_pumping = false


static func _run_queued(req: _REQUEST) -> void:
	var session: RefCounted = _session
	var next: int = _NEXT_RESEND
	while next == _NEXT_RESEND and not req.done:
		await _send_attempt(req)
		if session != _session:
			return
		next = await _handle_outcome(req)
		if session != _session:
			return


static func _set_processing(req: _REQUEST, processing: bool) -> void:
	if req == _current and _current_processing != processing:
		_current_processing = processing
		_update_block()


# --- send attempt ---


static func _start_request(req: _REQUEST) -> void:
	if req.started:
		return
	req.started = true
	req.first_monotonic = TimeCore.get_monotonic_time()
	req.first_device = TimeCore.get_device_time()
	if req.request_name == _RESYNC and req.message is CoreContract.ResyncRequest:
		(req.message as CoreContract.ResyncRequest).full = _full_resync
	req.body = req.message.encode()
	if CoreBuildInfo.has_dev_code and not req.sensitive and not req.auth:
		LogCore.log_debug(_TAG, "request %s %s body %s" % [req.request_name, req.request_id, _body_text(req.body)])


## Base64 of a body for a debug log; `-` for an empty body.
static func _body_text(body: PackedByteArray) -> String:
	return "-" if body.is_empty() else Marshalls.raw_to_base64(body)


## Steps 1-4 of the send attempt processing order. Sets `req.outcome`.
static func _send_attempt(req: _REQUEST) -> void:
	var session: RefCounted = _session
	_set_processing(req, false)
	req.failure = null
	req.transport = null
	req.envelope = null
	req.note = ""
	req.from_provider = false
	if _session_ended:
		req.outcome = _OUTCOME_DISCARDED
		return
	_start_request(req)
	if _dev_attempt_ended(req):
		return
	if not _has_server_info:
		req.outcome = _OUTCOME_FAILED
		req.failure = _new_failure(FailureKind.CONNECTION_FAILED, req)
		req.note = "no base URL"
		return
	if _provider == null:
		req.outcome = _OUTCOME_FAILED
		req.failure = _new_failure(FailureKind.CONNECTION_FAILED, req)
		req.note = "no session provider"
		return
	InputBlockCore.set_timer_hold(_BLOCK_REASON, true)
	var token: _WAITER = await _wait_token(_provider, false)
	if session != _session:
		return
	InputBlockCore.set_timer_hold(_BLOCK_REASON, false)
	if _session_ended:
		req.outcome = _OUTCOME_DISCARDED
		return
	var token_result: GetAccessTokenResult = token.token_result
	if token_result == null or not token_result.ok:
		_take_provider_failure(req, token_result)
		return
	var key: String = _provider.get_signing_key() if _provider != null else ""
	var headers: PackedStringArray = _headers(req, token_result.access_token, true, key)
	if _blocked and InputBlockCore.is_active(_block_token):
		InputBlockCore.restart_timer(_block_token)
	var w: _WAITER = await _call_transport(_base_url + "/" + req.request_name, headers, req.body)
	if session != _session:
		return
	_take_transport_result(req, w)


## True when the DEV hook ended the send attempt of `req`.
static func _dev_attempt_ended(req: _REQUEST) -> bool:
	if not _dev_attempt_hook.is_valid():
		return false
	var ended: bool = _dev_attempt_hook.call(req)
	return ended


## Puts the failure a `SessionProvider` call returned into `req`.
static func _take_provider_failure(req: _REQUEST, token_result: GetAccessTokenResult) -> void:
	var failure: RequestFailure = token_result.failure if token_result != null else null
	if failure != null and failure.error_code == CoreContract.CoreError.CORE_ERROR_SESSION_REPLACED:
		req.outcome = _OUTCOME_SILENT_END
		return
	req.outcome = _OUTCOME_FAILED
	req.from_provider = true
	if failure != null and failure.kind == FailureKind.SERVER_ERROR:
		req.failure = failure
	else:
		req.failure = _new_failure(FailureKind.CONNECTION_FAILED, req)


static func _take_transport_result(req: _REQUEST, w: _WAITER) -> void:
	req.transport = w
	if w.timed_out:
		req.outcome = _OUTCOME_FAILED
		req.failure = _new_failure(FailureKind.TIMEOUT, req)
		return
	var r: NetworkTransportResult = w.result
	if r == null or r.transfer == TransferResult.CONNECTION_FAILED:
		req.outcome = _OUTCOME_FAILED
		req.failure = _new_failure(FailureKind.CONNECTION_FAILED, req)
		return
	req.outcome = _OUTCOME_RESPONSE


static func _headers(req: _REQUEST, token: String, sign: bool, key: String) -> PackedStringArray:
	var headers: PackedStringArray = PackedStringArray()
	headers.append("X-Ogw-Request-Id: " + req.request_id)
	if not token.is_empty():
		headers.append("Authorization: Bearer " + token)
	headers.append("X-Ogw-Data-Version: " + DataCore.get_data_version())
	headers.append("X-Ogw-Client-Version: " + _app_version)
	headers.append("X-Ogw-Platform: " + _platform)
	if sign:
		var timestamp: String = str(TimeCore.get_server_time() if TimeCore.is_synced() else TimeCore.get_device_time())
		headers.append("X-Ogw-Timestamp: " + timestamp)
		if not key.is_empty():
			headers.append("X-Ogw-Signature: " + _signature(key, req.request_name, req.request_id, timestamp, req.body))
	headers.append("Content-Type: application/x-protobuf")
	if _dev_header_hook.is_valid():
		var line: String = _dev_header_hook.call(req)
		if not line.is_empty():
			headers.append(line)
	return headers


static func _signature(key: String, request_name: String, request_id: String, timestamp: String, body: PackedByteArray) -> String:
	var hashing: HashingContext = HashingContext.new()
	if hashing.start(HashingContext.HASH_SHA256) != OK:
		return ""
	if not body.is_empty() and hashing.update(body) != OK:
		return ""
	var text: String = "%s\n%s\n%s\n%s" % [request_name, request_id, timestamp, hashing.finish().hex_encode()]
	return _crypto.hmac_digest(HashingContext.HASH_SHA256, key.to_utf8_buffer(), text.to_utf8_buffer()).hex_encode()


## Lowercase UUID v4.
static func _new_request_id() -> String:
	var bytes: PackedByteArray = _crypto.generate_random_bytes(16)
	bytes[6] = (bytes[6] & 0x0F) | 0x40
	bytes[8] = (bytes[8] & 0x3F) | 0x80
	var hex: String = bytes.hex_encode()
	return "%s-%s-%s-%s-%s" % [hex.substr(0, 8), hex.substr(8, 4), hex.substr(12, 4), hex.substr(16, 4), hex.substr(20, 12)]


# --- waits ---


static func _new_waiter() -> _WAITER:
	var w: _WAITER = _WAITER.new()
	_waiters.append(w)
	return w


static func _fire(w: _WAITER) -> void:
	_waiters.erase(w)
	w.fire()


static func _call_transport(url: String, headers: PackedStringArray, body: PackedByteArray) -> _WAITER:
	var session: RefCounted = _session
	_next_handle += 1
	var w: _WAITER = _new_waiter()
	w.is_transport = true
	w.handle = _next_handle
	w.timeout_at = TimeCore.get_real_time() + _request_timeout_ms
	w.sent_monotonic = TimeCore.get_monotonic_time()
	var transport: NetworkTransport = _active_transport
	_drive_transport(w, transport, url, headers, body)
	if not w.fired:
		await w.done
	if session == _session and w.timed_out and w.result == null:
		transport.cancel(w.handle)
	return w


static func _drive_transport(w: _WAITER, transport: NetworkTransport, url: String, headers: PackedStringArray, body: PackedByteArray) -> void:
	var r: NetworkTransportResult = await transport.send(w.handle, url, headers, body)
	if w.fired or r == null or r.handle != w.handle:
		return
	w.result = r
	w.received_monotonic = TimeCore.get_monotonic_time()
	if _dev_received_hook.is_valid():
		var held: bool = _dev_received_hook.call(w)
		if held:
			return
	_fire(w)


static func _wait_token(provider: SessionProvider, refresh: bool) -> _WAITER:
	var w: _WAITER = _new_waiter()
	_drive_token(w, provider, refresh)
	if not w.fired:
		await w.done
	return w


static func _drive_token(w: _WAITER, provider: SessionProvider, refresh: bool) -> void:
	var r: GetAccessTokenResult = null
	if refresh:
		r = await provider.refresh_access_token()
	else:
		r = await provider.get_access_token()
	if w.fired:
		return
	w.token_result = r
	_fire(w)


## Waits the next retry delay of `req`, measured in real elapsed time.
static func _wait_retry_delay(req: _REQUEST) -> void:
	if req.retry_delay < 0:
		req.retry_delay = _retry_delay_ms
	else:
		@warning_ignore("integer_division")
		var next: int = req.retry_delay * _retry_delay_factor_permille / 1000
		req.retry_delay = mini(next, _retry_delay_max_ms)
	var w: _WAITER = _new_waiter()
	w.timeout_at = TimeCore.get_real_time() + req.retry_delay
	if not w.fired:
		await w.done


static func _on_frame() -> void:
	if not _is_initialized or _due_queued:
		return
	var now: int = TimeCore.get_real_time()
	var due: bool = false
	for w: _WAITER in _waiters:
		if w.fired:
			continue
		if (w.deliver_at >= 0 and now >= w.deliver_at) or (w.timeout_at >= 0 and now >= w.timeout_at):
			due = true
	if _blocked and not _loading_shown and now - _block_started_at > _loading_icon_delay_ms and InputBlockCore.is_active(_block_token):
		due = true
	if _loading_shown and (not _blocked or not InputBlockCore.is_active(_block_token)):
		due = true
	if due:
		_due_queued = true
		_due_call.call_deferred()


## The deferred part of the frame check: fires the waiters that are due and shows or hides the loading icon.
static func _run_due() -> void:
	_due_queued = false
	if not _is_initialized:
		return
	var now: int = TimeCore.get_real_time()
	for w: _WAITER in _waiters.duplicate():
		if w.fired:
			continue
		if w.deliver_at >= 0 and now >= w.deliver_at and (w.timeout_at < 0 or w.deliver_at <= w.timeout_at):
			_fire(w)
		elif w.timeout_at >= 0 and now >= w.timeout_at:
			w.timed_out = true
			_fire(w)
	if not _is_initialized:
		return
	if _blocked and not _loading_shown and now - _block_started_at > _loading_icon_delay_ms and InputBlockCore.is_active(_block_token):
		_loading_token = UICore.show_loading_icon()
		_loading_shown = true
	elif _loading_shown and (not _blocked or not InputBlockCore.is_active(_block_token)):
		_hide_loading_icon()


# --- block and loading icon ---


static func _blocks(kind: RequestKind) -> bool:
	return kind == RequestKind.INTERACTION or kind == RequestKind.RETRY


static func _update_block() -> void:
	var want: bool = false
	if _current != null and _current_processing:
		want = false
	elif _current != null and _blocks(_current.kind):
		want = true
	else:
		for req: _REQUEST in _queue:
			if _blocks(req.kind):
				want = true
				break
	if want and not _blocked:
		_blocked = true
		_block_token = InputBlockCore.block(_BLOCK_REASON, UICore.get_block_pass_list())
		_block_started_at = TimeCore.get_real_time()
	elif not want and _blocked:
		_blocked = false
		if InputBlockCore.is_active(_block_token):
			InputBlockCore.unblock(_block_token)
		_hide_loading_icon()


static func _hide_loading_icon() -> void:
	if not _loading_shown:
		return
	_loading_shown = false
	UICore.hide_loading_icon(_loading_token)


# --- response processing ---


## Processes the outcome of a send attempt of a queued request. Returns `_NEXT_RESEND` to send it again.
static func _handle_outcome(req: _REQUEST) -> int:
	match req.outcome:
		_OUTCOME_DISCARDED:
			_end_discarded(req)
			return _NEXT_DONE
		_OUTCOME_SILENT_END:
			_end_failure(req, null, false, false)
			return _NEXT_DONE
		_OUTCOME_FAILED:
			_set_processing(req, true)
			return await _failure_flow(req, req.failure, 2 if req.from_provider else 1)
	_set_processing(req, true)
	var response: ContractMessage = req.message.new_response()
	var failure: RequestFailure = _process_response(req, response)
	if failure == null:
		if not _apply_envelope_deltas(req):
			req.last_error_code = 0
			if req.from_send:
				_full_resync = true
			_end_failure(req, _new_failure(FailureKind.INVALID_RESPONSE, req, 200), false, false)
			return _NEXT_DONE
		_end_success(req, response)
		return _NEXT_DONE
	return await _failure_flow(req, failure, 1)


## Steps 1-3 of response processing: time sync, error and body decode into `response`. Returns the failure, or
## `null` for a success, whose envelope is then in `req.envelope`.
static func _process_response(req: _REQUEST, response: ContractMessage) -> RequestFailure:
	var w: _WAITER = req.transport as _WAITER
	var r: NetworkTransportResult = w.result
	req.response_body = PackedByteArray()
	if r.transfer != TransferResult.DONE or r.http_status != 200 or r.body.size() > _response_max_bytes:
		return _new_failure(FailureKind.INVALID_RESPONSE, req, r.http_status)
	var envelope: CoreContract.ResponseEnvelope = CoreContract.ResponseEnvelope.new()
	if not envelope.decode(r.body):
		return _new_failure(FailureKind.INVALID_RESPONSE, req, r.http_status)
	req.response_body = envelope.body
	if _provider == null or (envelope.error == null and not _NO_SESSION_SYNC.has(req.request_name)):
		TimeCore.sync_server_time(envelope.server_time_at, w.sent_monotonic, w.received_monotonic)
	if envelope.error != null:
		if envelope.error.code <= 0:
			return _new_failure(FailureKind.INVALID_RESPONSE, req, r.http_status)
		var failure: RequestFailure = _new_failure(FailureKind.SERVER_ERROR, req, r.http_status)
		failure.error_code = envelope.error.code
		failure.server_detail = envelope.error.detail
		if failure.error_code == CoreContract.CoreError.CORE_ERROR_BANNED:
			failure.ban = envelope.error.ban
		return failure
	if not response.decode(envelope.body):
		return _new_failure(FailureKind.INVALID_RESPONSE, req, r.http_status)
	if CoreBuildInfo.has_dev_code and not req.sensitive and not req.auth:
		LogCore.log_debug(_TAG, "response %s %s body %s" % [req.request_name, req.request_id, _body_text(envelope.body)])
	req.envelope = envelope
	return null


## Step 4 of response processing. `false` when `UserStateCore.apply_delta` refused a delta.
static func _apply_envelope_deltas(req: _REQUEST) -> bool:
	var envelope: CoreContract.ResponseEnvelope = req.envelope
	if envelope == null:
		return true
	if envelope.user_state != null and not UserStateCore.apply_delta(envelope.user_state, UserStateCore.DeltaSource.RESPONSE):
		return false
	if envelope.pending_user_state != null and not UserStateCore.apply_delta(envelope.pending_user_state, UserStateCore.DeltaSource.PENDING):
		return false
	UserStateCore.notify_item_changes(envelope.item_changes)
	UserStateCore.notify_item_mails(envelope.item_mails)
	return true


# --- failure flow ---


## Failure flow of a queued request from step `from_step`. Returns `_NEXT_RESEND` to send it again.
static func _failure_flow(req: _REQUEST, first_failure: RequestFailure, from_step: int) -> int:
	var session: RefCounted = _session
	var failure: RequestFailure = first_failure
	req.last_error_code = failure.error_code
	if from_step <= 1 and failure.error_code == CoreContract.CoreError.CORE_ERROR_TOKEN_EXPIRED and not req.token_retry_done:
		req.token_retry_done = true
		if _provider == null:
			if _session_ended:
				_end_discarded(req)
				return _NEXT_DONE
		else:
			InputBlockCore.set_timer_hold(_BLOCK_REASON, true)
			var token: _WAITER = await _wait_token(_provider, true)
			if session != _session:
				return _NEXT_DONE
			InputBlockCore.set_timer_hold(_BLOCK_REASON, false)
			if _session_ended:
				_end_discarded(req)
				return _NEXT_DONE
			var token_result: GetAccessTokenResult = token.token_result
			if token_result != null and token_result.ok:
				if not _retry_age_exceeded(req):
					return _NEXT_RESEND
			else:
				_take_provider_failure(req, token_result)
				if req.outcome == _OUTCOME_SILENT_END:
					_end_failure(req, null, false, false)
					return _NEXT_DONE
				failure = req.failure
	var code: int = failure.error_code
	var comm: bool = failure.kind != FailureKind.SERVER_ERROR
	if code == CoreContract.CoreError.CORE_ERROR_SESSION_REPLACED:
		if _provider != null:
			_provider.notify_session_replaced()
		_end_failure(req, failure, false, true)
		return _NEXT_DONE
	if _is_update_error(code):
		_publish_update_required(code)
		_end_failure(req, failure, false, true)
		return _NEXT_DONE
	if comm and not req.comm_retry_done:
		req.comm_retry_done = true
		if _session_ended:
			_end_discarded(req)
			return _NEXT_DONE
		if not _retry_age_exceeded(req):
			req.from_provider = false
			return _NEXT_RESEND
	if comm and req.kind == RequestKind.SILENT_RETRY and req.retries < _retry_count:
		req.retries += 1
		_set_processing(req, false)
		InputBlockCore.set_timer_hold(_BLOCK_REASON, true)
		await _wait_retry_delay(req)
		if session != _session:
			return _NEXT_DONE
		InputBlockCore.set_timer_hold(_BLOCK_REASON, false)
		if _session_ended:
			_end_discarded(req)
			return _NEXT_DONE
		if not _retry_age_exceeded(req):
			req.from_provider = false
			return _NEXT_RESEND
		_set_processing(req, true)
	if _call_failure_callback(req, failure):
		_end_failure(req, failure, true, true)
		return _NEXT_DONE
	return await _default_handling(req, failure)


static func _default_handling(req: _REQUEST, failure: RequestFailure) -> int:
	var session: RefCounted = _session
	if req.kind == RequestKind.SILENT or req.kind == RequestKind.SILENT_RETRY:
		_end_failure(req, failure, false, true)
		return _NEXT_DONE
	if failure.kind == FailureKind.SERVER_ERROR:
		_show_error_display(_error_display_of(failure), failure)
		_end_failure(req, failure, false, true)
		return _NEXT_DONE
	if req.kind == RequestKind.INTERACTION:
		_open_popup(_failure_key(failure.kind), failure, ReservedString.network_confirm(), Callable(), true)
		_end_failure(req, failure, false, true)
		return _NEXT_DONE
	if req.retries >= _retry_count:
		_open_restart_popup(_failure_key(failure.kind), failure)
		_end_failure(req, failure, false, true)
		return _NEXT_DONE
	var retry: bool = await _retry_popup(failure)
	if session != _session:
		return _NEXT_DONE
	if not retry:
		req.note = "retry popup did not open or closed without retry"
		_end_failure(req, failure, false, true)
		return _NEXT_DONE
	req.retries += 1
	if _session_ended:
		_end_discarded(req)
		return _NEXT_DONE
	if _retry_age_exceeded(req):
		_open_restart_popup(_failure_key(failure.kind), failure)
		_end_failure(req, failure, false, true)
		return _NEXT_DONE
	req.from_provider = false
	return _NEXT_RESEND


static func _retry_age_exceeded(req: _REQUEST) -> bool:
	var monotonic: int = TimeCore.get_monotonic_time() - req.first_monotonic
	var device: int = TimeCore.get_device_time() - req.first_device
	return maxi(monotonic, device) >= _max_retry_age_ms


static func _is_update_error(code: int) -> bool:
	return code == CoreContract.CoreError.CORE_ERROR_APP_UPDATE_REQUIRED or code == CoreContract.CoreError.CORE_ERROR_DATA_UPDATE_REQUIRED


static func _publish_update_required(code: int) -> void:
	var event: UpdateRequiredEvent = EventCore.acquire(UpdateRequiredEvent) as UpdateRequiredEvent
	event.error_code = code
	EventCore.publish(event)


static func _new_failure(kind: FailureKind, req: _REQUEST, http_status: int = 0) -> RequestFailure:
	var failure: RequestFailure = RequestFailure.new()
	failure.kind = kind
	failure.request_name = req.request_name
	failure.http_status = http_status
	return failure


static func _call_failure_callback(req: _REQUEST, failure: RequestFailure) -> bool:
	if req.on_failure.is_null():
		return false
	if not req.on_failure.is_valid():
		LogCore.log_error(_TAG, "failure callback of %s cannot be called: its object is gone" % req.request_name)
		return false
	return _call_bool(req.on_failure, failure)


# ogw:input_boundary
static func _call_bool(callback: Callable, failure: RequestFailure) -> bool:
	var out: Variant = callback.call(failure)
	return out is bool and out == true


# --- display ---


static func _failure_key(kind: FailureKind) -> String:
	match kind:
		FailureKind.TIMEOUT:
			return ReservedString.network_error_timeout()
		FailureKind.CONNECTION_FAILED:
			return ReservedString.network_error_connection()
	return ReservedString.network_error_invalid_response()


static func _error_display_of(failure: RequestFailure) -> ErrorDisplay:
	var display: ErrorDisplay = ErrorDisplay.new()
	match failure.error_code:
		CoreContract.CoreError.CORE_ERROR_UNAUTHORIZED, CoreContract.CoreError.CORE_ERROR_TOKEN_EXPIRED:
			display.kind = ErrorDisplayKind.POPUP_RESTART
			display.translation_key = ReservedString.network_error_session()
		CoreContract.CoreError.CORE_ERROR_MAINTENANCE:
			display.kind = ErrorDisplayKind.POPUP_RESTART
			display.translation_key = ReservedString.network_error_maintenance()
		CoreContract.CoreError.CORE_ERROR_BANNED:
			display.kind = ErrorDisplayKind.POPUP_RESTART
			display.translation_key = ReservedString.network_error_banned()
		CoreContract.CoreError.CORE_ERROR_RATE_LIMITED:
			display.kind = ErrorDisplayKind.TOAST
			display.translation_key = ReservedString.network_error_rate_limited()
		CoreContract.CoreError.CORE_ERROR_FEATURE_DISABLED:
			display.kind = ErrorDisplayKind.TOAST
			display.translation_key = ReservedString.network_error_feature_disabled()
		_:
			display = _hook_error_display(failure)
	return display


static func _hook_error_display(failure: RequestFailure) -> ErrorDisplay:
	var fallback: ErrorDisplay = ErrorDisplay.new()
	fallback.kind = ErrorDisplayKind.POPUP
	fallback.translation_key = ReservedString.network_error_general()
	if _error_display_hook.is_null():
		return fallback
	var display: ErrorDisplay = _call_error_display(failure.error_code, failure.request_name)
	if display == null or not ErrorDisplayKind.values().has(display.kind) or (display.kind != ErrorDisplayKind.NONE and display.translation_key.is_empty()):
		LogCore.log_error(_TAG, "error_display hook threw or returned no valid ErrorDisplay for code %d" % failure.error_code)
		return fallback
	return display


# ogw:input_boundary
static func _call_error_display(code: int, request_name: String) -> ErrorDisplay:
	var mark: int = CoreScriptErrors.begin()
	var out: Variant = _error_display_hook.call(code, request_name)
	if CoreScriptErrors.end(mark):
		return null
	if out is ErrorDisplay:
		var display: ErrorDisplay = out
		return display
	return null


static func _show_error_display(display: ErrorDisplay, failure: RequestFailure) -> void:
	match display.kind:
		ErrorDisplayKind.TOAST:
			MessageCore.show_toast(display.translation_key, null, _diagnostic(failure))
		ErrorDisplayKind.POPUP:
			_open_popup(display.translation_key, failure, ReservedString.network_confirm(), Callable(), true)
		ErrorDisplayKind.POPUP_RESTART:
			_open_restart_popup(display.translation_key, failure)


## Popup whose title button publishes `RestartRequestedEvent`; back input is ignored.
static func _open_restart_popup(body_key: String, failure: RequestFailure) -> void:
	_open_popup(body_key, failure, ReservedString.network_go_to_title(), NetworkCore._request_restart, false)


static func _request_restart() -> void:
	if not _is_initialized:
		return
	var event: RestartRequestedEvent = EventCore.acquire(RestartRequestedEvent) as RestartRequestedEvent
	event.module = _TAG
	EventCore.publish(event)


## Opens a one-button system popup without waiting for it. `back_closes` makes back input press the button.
static func _open_popup(body_key: String, failure: RequestFailure, label_key: String, callback: Callable, back_closes: bool) -> void:
	UICore.open_system_popup(_popup_param(body_key, failure, label_key, callback, back_closes), Callable())


static func _popup_param(body_key: String, failure: RequestFailure, label_key: String, callback: Callable, back_closes: bool) -> SystemPopupParam:
	var param: SystemPopupParam = SystemPopupParam.new()
	param.body = body_key
	param.extra_text = _diagnostic(failure)
	var button: SystemPopupButton = SystemPopupButton.new()
	button.label = label_key
	button.callback = callback
	param.buttons.append(button)
	param.back_button = 0 if back_closes else -1
	return param


## Opens the retry popup and waits until retry is pressed (`true`) or it fails to open or closes without retry.
static func _retry_popup(failure: RequestFailure) -> bool:
	var session: RefCounted = _session
	var w: _WAITER = _new_waiter()
	var on_retry: Callable = func() -> void:
		w.flag = true
		_fire(w)
	var on_hidden: Callable = func() -> void:
		(func() -> void: _fire(w)).call_deferred()
	var param: SystemPopupParam = _popup_param(_failure_key(failure.kind), failure, ReservedString.network_retry(), on_retry, false)
	var opened: bool = await UICore.open_system_popup(param, on_hidden)
	if session != _session:
		return false
	if not opened:
		_fire(w)
		return false
	if not w.fired:
		await w.done
	return session == _session and w.flag


## Diagnostic text of a toast or popup: the error code in STG and PROD, more in a build with DEV code.
static func _diagnostic(failure: RequestFailure) -> String:
	if not CoreBuildInfo.has_dev_code:
		return "(%d)" % failure.error_code
	var text: String = "(%s %d %s HTTP %d" % [_error_name(failure), failure.error_code, failure.request_name, failure.http_status]
	if not failure.server_detail.is_empty():
		text += " " + failure.server_detail
	return text + ")"


# ogw:input_boundary
static func _error_name(failure: RequestFailure) -> String:
	if failure.kind != FailureKind.SERVER_ERROR:
		return _FAILURE_NAMES[failure.kind]
	var key: Variant = CoreContract.CoreError.find_key(failure.error_code)
	if key == null:
		key = GameContract.GameError.find_key(failure.error_code)
	if key == null:
		return "UNKNOWN_ERROR"
	return str(key)


# --- end ---


static func _end_success(req: _REQUEST, response: ContractMessage) -> void:
	req.last_error_code = 0
	if not req.on_success.is_null():
		if req.on_success.is_valid():
			req.on_success.call(response)
		else:
			LogCore.log_error(_TAG, "success callback of %s cannot be called: its object is gone" % req.request_name)
	if req.from_send and req.request_name == _RESYNC and req.message is CoreContract.ResyncRequest and (req.message as CoreContract.ResyncRequest).full:
		_full_resync = false
	_complete(req, true)


## Ends a request discarded in session end state: no callback, default handling or log.
static func _end_discarded(req: _REQUEST) -> void:
	_complete(req, false)


## Ends a request in failure. `failure` is `null` for a silent end; `logged` leaves the failure log.
static func _end_failure(req: _REQUEST, failure: RequestFailure, handled: bool, logged: bool) -> void:
	if failure != null:
		req.last_error_code = failure.error_code
		if req.from_send and failure.kind != FailureKind.SERVER_ERROR and req.kind != RequestKind.RETRY:
			_full_resync = true
		if logged and not req.from_provider:
			_log_failure(req, failure, handled)
	_complete(req, false)


static func _log_failure(req: _REQUEST, failure: RequestFailure, handled: bool) -> void:
	var text: String = "request failed: %s code %d %s HTTP %d" % [_FAILURE_NAMES[failure.kind], failure.error_code, failure.request_name, failure.http_status]
	if not req.note.is_empty():
		text += ": " + req.note
	var server_error: bool = failure.kind == FailureKind.SERVER_ERROR
	if req.request_name == _REPORT_ERRORS or req.request_name == _REPORT_EVENTS or (server_error and (handled or req.auth)) or failure.error_code == CoreContract.CoreError.CORE_ERROR_SESSION_REPLACED:
		LogCore.log_warn(_TAG, text)
	else:
		LogCore.log_error(_TAG, text)


static func _complete(req: _REQUEST, ok: bool) -> void:
	if req.done:
		return
	_live.erase(req)
	if _dev_request_record_count > 0:
		_keep_record(req, ok)
	if req.auth_result == null and req.auth:
		req.auth_result = AuthSendResult.new()
		req.auth_result.ok = ok
	req.finish(ok)
	if req.from_send:
		var event: RequestCompletedEvent = EventCore.acquire(RequestCompletedEvent) as RequestCompletedEvent
		event.request_name = req.request_name
		event.success = ok
		EventCore.publish(event)


## Keeps the record of `req` that ended, then drops the oldest past `_dev_request_record_count`.
static func _keep_record(req: _REQUEST, ok: bool) -> void:
	var record: _RECORD = _RECORD.new()
	record.request_name = req.request_name
	record.kind = req.kind
	record.ok = ok
	record.error_code = req.last_error_code
	if not req.sensitive and not req.auth:
		record.request_body = req.body
		record.response_body = req.response_body
	_request_records.append(record)
	while _request_records.size() > _dev_request_record_count:
		_request_records.pop_front()


# --- send_auth ---


static func _failed_auth_result(request: ContractRequest) -> AuthSendResult:
	var result: AuthSendResult = AuthSendResult.new()
	result.failure = RequestFailure.new()
	result.failure.request_name = request.request_name() if request != null else ""
	return result


static func _new_auth_request(request: ContractRequest, options: AuthSendOptions) -> _REQUEST:
	var req: _REQUEST = _new_request(request, Callable(), Callable())
	req.auth = true
	req.sensitive = true
	req.auth_options = options if options != null else AuthSendOptions.new()
	return req


## Sends `req` of `_new_auth_request` at once, outside the queue.
static func _send_auth_request(req: _REQUEST) -> AuthSendResult:
	_live.append(req)
	await _run_auth(req)
	if req.auth_result == null:
		return _failed_auth_result(req.message)
	return req.auth_result


static func _run_auth(req: _REQUEST) -> void:
	var session: RefCounted = _session
	while not req.done:
		await _send_auth_attempt(req)
		if session != _session:
			return
		var failure: RequestFailure = req.failure
		if req.outcome == _OUTCOME_RESPONSE:
			var response: ContractMessage = req.message.new_response()
			failure = _process_response(req, response)
			if failure == null:
				var applied: bool = _apply_envelope_deltas(req)
				req.auth_result = AuthSendResult.new()
				req.auth_result.ok = applied
				if applied:
					req.auth_result.response = response
				else:
					req.auth_result.failure = _new_failure(FailureKind.INVALID_RESPONSE, req, 200)
				_complete(req, applied)
				return
		req.last_error_code = failure.error_code
		var comm: bool = failure.kind != FailureKind.SERVER_ERROR
		if _is_update_error(failure.error_code):
			_publish_update_required(failure.error_code)
		elif comm and req.message.is_retry() and req.retries < _retry_count:
			req.retries += 1
			await _wait_retry_delay(req)
			if session != _session:
				return
			if not _retry_age_exceeded(req):
				continue
		req.auth_result = AuthSendResult.new()
		req.auth_result.failure = failure
		_end_failure(req, failure, false, true)


static func _send_auth_attempt(req: _REQUEST) -> void:
	var session: RefCounted = _session
	req.failure = null
	req.transport = null
	req.envelope = null
	req.note = ""
	_start_request(req)
	if _dev_attempt_ended(req):
		return
	if not _has_server_info:
		req.outcome = _OUTCOME_FAILED
		req.failure = _new_failure(FailureKind.CONNECTION_FAILED, req)
		req.note = "no base URL"
		return
	var options: AuthSendOptions = req.auth_options
	var key: String = options.signing_key
	if key.is_empty() and _provider != null:
		key = _provider.get_signing_key()
	var headers: PackedStringArray = _headers(req, options.authorization, options.sign, key)
	var w: _WAITER = await _call_transport(_base_url + "/" + req.request_name, headers, req.body)
	if session != _session:
		return
	_take_transport_result(req, w)


# --- session-bound work ---


static func _on_foreground_returned() -> void:
	if not _is_initialized or _provider == null or not TimeCore.is_synced():
		return
	send(CoreContract.ResyncRequest.new())


## The `LogCore` sender: sends the batch as `ReportClientErrors` and `ReportAnalyticsEvents`.
static func _send_log_batch(batch: LogBatch) -> void:
	if not _is_initialized or batch == null:
		return
	if not batch.errors.is_empty() or batch.dropped_error_count > 0:
		var errors: CoreContract.ReportClientErrorsRequest = CoreContract.ReportClientErrorsRequest.new()
		for entry in batch.errors:
			var item: CoreContract.ClientErrorEntry = CoreContract.ClientErrorEntry.new()
			item.time_at = entry.time
			item.level = _LEVEL_WARN if entry.level == LogCore.Level.WARN else _LEVEL_ERROR
			item.tag = entry.tag
			item.message = entry.message
			item.stack_trace = entry.stack_trace
			errors.errors.append(item)
		errors.dropped_error_count = batch.dropped_error_count
		send(errors)
	if not batch.events.is_empty() or batch.dropped_event_count > 0:
		var events: CoreContract.ReportAnalyticsEventsRequest = CoreContract.ReportAnalyticsEventsRequest.new()
		for event in batch.events:
			var item: CoreContract.AnalyticsEvent = CoreContract.AnalyticsEvent.new()
			item.name = event.name
			item.time_at = event.time
			for param in event.params:
				item.params.append(_analytics_param(param))
			events.events.append(item)
		events.dropped_event_count = batch.dropped_event_count
		send(events)


static func _analytics_param(param: LogEventParam) -> CoreContract.AnalyticsParam:
	var out: CoreContract.AnalyticsParam = CoreContract.AnalyticsParam.new()
	out.key = param.name
	match param.value_type:
		LogEventParam.ValueType.INT:
			out.kind = CoreContract.AnalyticsParamKind.ANALYTICS_PARAM_KIND_INT
			out.int_value = param.int_value
		LogEventParam.ValueType.FLOAT:
			out.kind = CoreContract.AnalyticsParamKind.ANALYTICS_PARAM_KIND_DOUBLE
			out.double_value = param.float_value
		LogEventParam.ValueType.STRING:
			out.kind = CoreContract.AnalyticsParamKind.ANALYTICS_PARAM_KIND_STRING
			out.string_value = param.string_value
		LogEventParam.ValueType.BOOL:
			out.kind = CoreContract.AnalyticsParamKind.ANALYTICS_PARAM_KIND_BOOL
			out.bool_value = param.bool_value
	return out


# --- set_server_info checks ---


static func _is_valid_base_url(url: String) -> bool:
	var rest: String = ""
	if url.begins_with("https://"):
		rest = url.substr(8)
	elif url.begins_with("http://") and CoreBuildInfo.has_dev_code:
		rest = url.substr(7)
	else:
		return false
	if rest.contains("?") or rest.contains("#") or rest.contains(" "):
		return false
	return not rest.get_slice("/", 0).is_empty()


static func _is_version(text: String) -> bool:
	var parts: PackedStringArray = text.split(".")
	if parts.size() != 3:
		return false
	for part: String in parts:
		if part.is_empty():
			return false
		for i: int in part.length():
			var c: int = part.unicode_at(i)
			if c < 48 or c > 57:
				return false
	return true
