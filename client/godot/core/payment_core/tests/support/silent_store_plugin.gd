extends Object
## Store plugin singleton of the PaymentCore core tests that never answers: a test registers it under the singleton
## name of `PluginStoreAdapter`, so the real adapter waits on it as on a `ogw-iap-apple` plugin that does not end its
## operations. Operations named in `answering` end at once with success instead. The test frees it after
## unregistering it.

## Operations that end at once: `connect` with `["0"]`, `query_prices` with `["0"]` and the SKUs as their prices.
var answering: PackedStringArray = PackedStringArray()
## Operation name of each started operation, by operation ID.
var started: Dictionary[int, String] = {}
## `take_result` calls of each operation ID.
var polls: Dictionary[int, int] = {}
## Operation IDs `cancel` got, in order.
var cancelled: PackedInt64Array = PackedInt64Array()
## `take_events` calls.
var event_reads: int = 0
var _next_id: int = 0
var _answers: Dictionary[int, PackedStringArray] = {}


## ID of the first operation named `operation`, or 0.
func id_of(operation: String) -> int:
	for id: int in started:
		if started[id] == operation:
			return id
	return 0


## `take_result` calls of operation `id`.
func poll_count(id: int) -> int:
	return polls[id] if polls.has(id) else 0


func start_connect() -> int:
	return _start("connect", PackedStringArray(["0"]))


func start_query_prices(skus: PackedStringArray) -> int:
	var answer: PackedStringArray = PackedStringArray(["0"])
	answer.append_array(skus)
	return _start("query_prices", answer)


func start_buy(_sku: String, _product_type: int, _account_token: String) -> int:
	return _start("buy", PackedStringArray(["3"]))


func start_list_unfinished() -> int:
	return _start("list_unfinished", PackedStringArray(["0"]))


func start_list_owned() -> int:
	return _start("list_owned", PackedStringArray(["0"]))


func start_finish(_sku: String, _transaction_id: String, _data: String, _product_type: int) -> int:
	return _start("finish", PackedStringArray(["0"]))


func start_open_subscription_management() -> int:
	return _start("open_subscription_management", PackedStringArray(["0"]))


func take_result(id: int) -> PackedStringArray:
	var count: int = polls[id] if polls.has(id) else 0
	polls[id] = count + 1
	if not _answers.has(id):
		return PackedStringArray()
	var answer: PackedStringArray = _answers[id]
	_answers.erase(id)
	return answer


func cancel(id: int) -> void:
	cancelled.append(id)


func take_events() -> PackedStringArray:
	event_reads += 1
	return PackedStringArray()


func _start(operation: String, answer: PackedStringArray) -> int:
	_next_id += 1
	started[_next_id] = operation
	if operation in answering:
		_answers[_next_id] = answer
	return _next_id
