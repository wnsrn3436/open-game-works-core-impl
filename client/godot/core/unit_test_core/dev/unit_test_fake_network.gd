extends NetworkTransport
## Fake network of `UnitTestCore`: the `NetworkTransport` of a test. It gives each request the next result the test
## registered for its request name, in registration order. A result is a transfer result, an HTTP status and response
## bytes, or a hold that `release_pending` ends. It records the requests it received in order and counts cancels.


## One registered result: a hold, or a transfer result, HTTP status and response bytes.
class Registered extends RefCounted:
	var pending: bool = false
	var transfer: NetworkCore.TransferResult = NetworkCore.TransferResult.CONNECTION_FAILED
	var http_status: int = 0
	var body: PackedByteArray = PackedByteArray()


## Registered results of one request name, oldest first.
class Queue extends RefCounted:
	var items: Array[Registered] = []


## A request that got a hold and waits for `release_pending` or a cancel.
class Held extends RefCounted:
	signal released

	var request_name: String = ""
	var handle: int = 0
	var result: NetworkTransportResult = null


## `missing(network, request name)`: called when a request finds no registered result.
var missing: Callable = Callable()
var _queues: Dictionary[String, Queue] = {}
var _held: Array[Held] = []
var _received: Array[UnitTestRequest] = []
var _cancel_count: int = 0


func send(handle: int, url: String, headers: PackedStringArray, body: PackedByteArray) -> NetworkTransportResult:
	var request_name: String = request_name_of(url)
	var received: UnitTestRequest = UnitTestRequest.new()
	received.name = request_name
	received.headers = headers.duplicate()
	received.body = body.duplicate()
	_received.append(received)
	var registered: Registered = _take(request_name)
	if registered == null:
		if missing.is_valid():
			missing.call(self, request_name)
		return _result(handle, NetworkCore.TransferResult.CONNECTION_FAILED, 0, PackedByteArray())
	if not registered.pending:
		return _result(handle, registered.transfer, registered.http_status, registered.body)
	var held: Held = Held.new()
	held.request_name = request_name
	held.handle = handle
	_held.append(held)
	await held.released
	return held.result


## Counts the cancel and ends the held request of `handle` with a connection failure. Other held requests keep
## waiting.
func cancel(handle: int) -> void:
	_cancel_count += 1
	for i: int in _held.size():
		var held: Held = _held[i]
		if held.handle != handle:
			continue
		_held.remove_at(i)
		held.result = _result(held.handle, NetworkCore.TransferResult.CONNECTION_FAILED, 0, PackedByteArray())
		held.released.emit()
		return


func add(request_name: String, transfer: NetworkCore.TransferResult, http_status: int, body: PackedByteArray) -> void:
	var registered: Registered = Registered.new()
	registered.transfer = transfer
	registered.http_status = http_status
	registered.body = body.duplicate()
	_queue_of(request_name).items.append(registered)


func add_pending(request_name: String) -> void:
	var registered: Registered = Registered.new()
	registered.pending = true
	_queue_of(request_name).items.append(registered)


## Ends the oldest held request of `request_name` with the result. False when none is held.
func release(request_name: String, transfer: NetworkCore.TransferResult, http_status: int, body: PackedByteArray) -> bool:
	for i: int in _held.size():
		var held: Held = _held[i]
		if held.request_name != request_name:
			continue
		_held.remove_at(i)
		held.result = _result(held.handle, transfer, http_status, body)
		held.released.emit()
		return true
	return false


func received() -> Array[UnitTestRequest]:
	return _received.duplicate()


func cancel_count() -> int:
	return _cancel_count


## Request name of `url`: its path after the scheme and host, without the leading `/`.
static func request_name_of(url: String) -> String:
	var start: int = url.find("://")
	start = 0 if start < 0 else start + 3
	var slash: int = url.find("/", start)
	if slash < 0:
		return ""
	return url.substr(slash + 1)


func _take(request_name: String) -> Registered:
	if not _queues.has(request_name):
		return null
	var queue: Queue = _queues[request_name]
	if queue.items.is_empty():
		return null
	return queue.items.pop_front()


func _queue_of(request_name: String) -> Queue:
	if not _queues.has(request_name):
		_queues[request_name] = Queue.new()
	return _queues[request_name]


static func _result(handle: int, transfer: NetworkCore.TransferResult, http_status: int, body: PackedByteArray) -> NetworkTransportResult:
	var result: NetworkTransportResult = NetworkTransportResult.new()
	result.handle = handle
	result.transfer = transfer
	result.http_status = http_status
	result.body = body.duplicate()
	return result
