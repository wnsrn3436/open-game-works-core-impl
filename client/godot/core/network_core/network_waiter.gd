extends RefCounted
## One wait of NetworkCore: a `NetworkTransport` call, a `SessionProvider` call, a retry delay or a popup choice.
## `release` fires every waiter, so a coroutine waiting on it resumes and sees its session changed.

signal done

var fired: bool = false
## Real elapsed time at which the wait times out; -1 for none.
var timeout_at: int = -1
## Real elapsed time at which a delayed transport result is taken as received; -1 for none.
var deliver_at: int = -1
var timed_out: bool = false
## A `NetworkTransport` call.
var is_transport: bool = false
var handle: int = 0
var sent_monotonic: int = 0
var received_monotonic: int = 0
var result: NetworkTransportResult = null
var token_result: GetAccessTokenResult = null
## Popup choice: true when retry was pressed.
var flag: bool = false


func fire() -> void:
	if fired:
		return
	fired = true
	done.emit()
