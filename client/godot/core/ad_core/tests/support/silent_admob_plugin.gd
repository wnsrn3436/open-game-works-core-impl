extends Object
## `ogw-ads-admob` plugin singleton of the AdCore core tests whose operations never end, except the operations a
## test gives an answer: a test registers it under the singleton name of `AdmobAdapter`. The test frees it after
## unregistering it.

## Operation name of each started operation, by operation ID.
var started: Dictionary[int, String] = {}
## `take_result` calls.
var polls: int = 0
## Operation IDs `cancel` got, in order.
var cancelled: PackedInt64Array = PackedInt64Array()
var discards: int = 0
## Result of each operation that ends, by operation name: its first `take_result` returns it.
var answers: Dictionary[String, PackedStringArray] = {}
## Operation IDs whose answer was taken.
var _taken: Dictionary[int, bool] = {}


func request_consent() -> int:
	return _start("request_consent")


func is_privacy_options_required() -> bool:
	return false


func show_privacy_options() -> int:
	return _start("show_privacy_options")


func initialize(_personalized: bool, _child: bool, _below_consent_age: bool) -> int:
	return _start("initialize")


func load_ad(_type: String, _unit_id: String, _personalized: bool, _child: bool, _below_consent_age: bool) -> int:
	return _start("load_ad")


func present(_type: String, _unit_id: String, _user_id: String, _custom_data: String) -> int:
	return _start("present")


func open_banner(_unit_id: String, _personalized: bool, _child: bool, _below_consent_age: bool) -> int:
	return _start("open_banner")


func close_banner() -> void:
	pass


func discard_ads() -> void:
	discards += 1


func take_result(id: int) -> PackedStringArray:
	polls += 1
	var operation: String = started[id] if started.has(id) else ""
	if not answers.has(operation) or _taken.has(id):
		return PackedStringArray()
	_taken[id] = true
	return answers[operation]


## Operation ID of the last started `operation`, or 0.
func id_of(operation: String) -> int:
	var found: int = 0
	for id: int in started:
		if started[id] == operation:
			found = id
	return found


func cancel(id: int) -> void:
	cancelled.append(id)


func _start(operation: String) -> int:
	var id: int = started.size() + 1
	started[id] = operation
	return id
