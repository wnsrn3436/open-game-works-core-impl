extends RefCounted
## One request of NetworkCore: its message, kind, callbacks and the state of its sends.

## Emitted once when the request ends.
signal finished

var message: ContractRequest = null
var request_name: String = ""
var kind: NetworkCore.RequestKind = NetworkCore.RequestKind.INTERACTION
## Received by `send`: publishes `RequestCompletedEvent` and drives the full resync flag.
var from_send: bool = false
## Sent at once, outside the queue, by `send_auth` or the DEV code.
var auth: bool = false
var auth_options: AuthSendOptions = null
var on_success: Callable = Callable()
var on_failure: Callable = Callable()
var sensitive: bool = false

var request_id: String = ""
var body: PackedByteArray = PackedByteArray()
## True once the first send attempt started.
var started: bool = false
var first_monotonic: int = 0
var first_device: int = 0
## Sends again counted against `NetworkCore.retryCount`.
var retries: int = 0
## The last retry delay; -1 before the first.
var retry_delay: int = -1
var token_retry_done: bool = false
var comm_retry_done: bool = false
## The failure the request ended with came from the `SessionProvider`.
var from_provider: bool = false

## Result of the last send attempt: one of `NetworkCore._OUTCOME_*`.
var outcome: int = 0
var failure: RequestFailure = null
## Waiter of the last `NetworkTransport` call.
var transport: RefCounted = null
## Envelope of the last success response.
var envelope: CoreContract.ResponseEnvelope = null

var done: bool = false
var ok: bool = false
var last_error_code: int = 0
var response_body: PackedByteArray = PackedByteArray()
var auth_result: AuthSendResult = null
## Cause added to the failure log.
var note: String = ""


## Ends the request: no more work runs for it.
func finish(success: bool) -> void:
	if done:
		return
	done = true
	ok = success
	finished.emit()
