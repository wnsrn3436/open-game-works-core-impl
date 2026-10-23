extends Object
## `ogw-native-ui` plugin singleton of the NativeUiCore core tests whose share window never closes: a test registers
## it under the singleton name of `NativeUiPluginAdapter`. The test frees it after unregistering it.

## Operation ID of each `start_share`, in order.
var shares: PackedInt64Array = PackedInt64Array()
## `take_share_result` calls of each operation ID.
var polls: Dictionary[int, int] = {}
## Operation IDs `cancel_share` got, in order.
var cancelled: PackedInt64Array = PackedInt64Array()


## `take_share_result` calls of operation `id`.
func poll_count(id: int) -> int:
	return polls[id] if polls.has(id) else 0


func request_review() -> bool:
	return true


func start_share(_text: String, _png: PackedByteArray) -> int:
	shares.append(shares.size() + 1)
	return shares.size()


func take_share_result(id: int) -> PackedInt32Array:
	polls[id] = poll_count(id) + 1
	return PackedInt32Array()


func cancel_share(id: int) -> void:
	cancelled.append(id)
