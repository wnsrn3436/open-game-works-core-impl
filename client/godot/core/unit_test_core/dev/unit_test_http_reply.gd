extends RefCounted
## Reply of one HTTP request of the `UnitTestCore` core node to the test host.

## Emitted when the request ends: with a response, with a failure, or when the core node is released.
signal done

## Whether the request ended.
var finished: bool = false
## Whether a response came.
var ok: bool = false
## `HTTPRequest.Result` of the request.
var result: int = HTTPRequest.RESULT_CANT_CONNECT
var status: int = 0
var body: PackedByteArray = PackedByteArray()


func complete(request_result: int, response_code: int, _headers: PackedStringArray, response_body: PackedByteArray) -> void:
	if finished:
		return
	result = request_result
	ok = request_result == HTTPRequest.RESULT_SUCCESS
	status = response_code
	body = response_body
	finish()


## Ends the request without a response when it has not ended.
func fail() -> void:
	if finished:
		return
	finish()


func finish() -> void:
	finished = true
	done.emit()
