class_name NetworkTransport
extends RefCounted
## The interface `NetworkCore` sends a request through. A transport does not follow HTTP redirects and stops
## receiving a response over `NetworkCore.responseMaxBytes`.


## Sends one request and waits for its result. `handle` is new for every send and comes back in the result.
## `headers` are `Name: value` lines. Sends of other handles may run at the same time; a send does not stop them.
func send(handle: int, _url: String, _headers: PackedStringArray, _body: PackedByteArray) -> NetworkTransportResult:
	var result: NetworkTransportResult = NetworkTransportResult.new()
	result.handle = handle
	return result


## Cancels the send of `handle` only.
func cancel(_handle: int) -> void:
	pass
