extends Node
## Core node of `UnitTestCore`: the HTTP requests to the test host.

const _REPLY := preload("res://core/unit_test_core/dev/unit_test_http_reply.gd")
## Time limit of one request to the test host, which runs on this host.
const _REQUEST_TIMEOUT_S: float = 30.0

## Set by `UnitTestCore.release`, so `_exit_tree` does not clean up twice.
var released: bool = false
## Requests that have not ended.
var _replies: Array[_REPLY] = []


## Sends one request and waits for its end. `body` is JSON text; empty sends no body.
func request(url: String, method: HTTPClient.Method, body: String) -> _REPLY:
	var reply: _REPLY = _REPLY.new()
	var http: HTTPRequest = HTTPRequest.new()
	http.use_threads = false
	http.timeout = _REQUEST_TIMEOUT_S
	add_child(http)
	if http.request_completed.connect(reply.complete) != OK:
		_drop(http)
		reply.fail()
		return reply
	var headers: PackedStringArray = PackedStringArray()
	if not body.is_empty():
		headers.append("Content-Type: application/json")
	if http.request(url, headers, method, body) != OK:
		_drop(http)
		reply.fail()
		return reply
	_replies.append(reply)
	if not reply.finished:
		await reply.done
	_replies.erase(reply)
	_drop(http)
	return reply


## Waits until every request has ended.
func wait_idle() -> void:
	while not _replies.is_empty():
		var reply: _REPLY = _replies[0]
		if not reply.finished:
			await reply.done
		_replies.erase(reply)


## Ends every request that has not ended without a response.
func fail_all() -> void:
	var replies: Array[_REPLY] = _replies
	_replies = []
	for reply: _REPLY in replies:
		reply.fail()


func _exit_tree() -> void:
	if not released:
		UnitTestCore._on_node_exit(self)


func _drop(http: HTTPRequest) -> void:
	if not is_instance_valid(http):
		return
	http.cancel_request()
	if http.get_parent() != null:
		http.get_parent().remove_child(http)
	http.queue_free()
