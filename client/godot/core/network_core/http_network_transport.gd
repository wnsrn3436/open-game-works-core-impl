extends NetworkTransport
## The `NetworkTransport` outside the browser runtime, made with the engine HTTP client: one `HTTPRequest` per handle,
## without redirects, with the body limit of `NetworkCore.responseMaxBytes` and without its own timeout.

var _parent: Node = null
var _max_bytes: int = 0
## `HTTPRequest` of each handle that is sending.
var _requests: Dictionary[int, HTTPRequest] = {}


func _init(parent: Node, max_bytes: int) -> void:
	_parent = parent
	_max_bytes = max_bytes


# ogw:input_boundary
func send(handle: int, url: String, headers: PackedStringArray, body: PackedByteArray) -> NetworkTransportResult:
	var result: NetworkTransportResult = NetworkTransportResult.new()
	result.handle = handle
	if not is_instance_valid(_parent):
		return result
	_drop(handle)
	var request: HTTPRequest = HTTPRequest.new()
	request.max_redirects = 0
	request.body_size_limit = _max_bytes
	request.timeout = 0.0
	request.use_threads = false
	_parent.add_child(request)
	_requests[handle] = request
	if request.request_raw(url, headers, HTTPClient.METHOD_POST, body) != OK:
		_drop(handle)
		return result
	var args: Array = await request.request_completed
	if not _requests.has(handle) or _requests[handle] != request:
		return result
	_drop(handle)
	if args.size() < 4 or not (args[0] is int) or not (args[1] is int) or not (args[3] is PackedByteArray):
		return result
	var code: int = args[0]
	result.http_status = args[1]
	match code:
		HTTPRequest.RESULT_SUCCESS:
			result.transfer = NetworkCore.TransferResult.DONE
			result.body = args[3]
		HTTPRequest.RESULT_REDIRECT_LIMIT_REACHED:
			result.transfer = NetworkCore.TransferResult.REDIRECTED
		HTTPRequest.RESULT_BODY_SIZE_LIMIT_EXCEEDED:
			result.transfer = NetworkCore.TransferResult.TOO_LARGE
		_:
			result.transfer = NetworkCore.TransferResult.CONNECTION_FAILED
	return result


func cancel(handle: int) -> void:
	_drop(handle)


func _drop(handle: int) -> void:
	if not _requests.has(handle):
		return
	var request: HTTPRequest = _requests[handle]
	_requests.erase(handle)
	if is_instance_valid(request):
		request.cancel_request()
		if request.get_parent() != null:
			request.get_parent().remove_child(request)
		request.queue_free()
