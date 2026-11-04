extends Object
## `ogw-native-ui` plugin singleton of the NativeUiCore core tests whose share window closes: `take_share_result` of
## share `id` returns an empty array on its first call and `replies[id - 1]` on the next, once. A test registers it
## under the singleton name of `NativeUiPluginAdapter` and frees it after unregistering it.

## Reply of each share, by operation ID - 1.
var replies: Array[PackedInt32Array] = []
## `take_share_result` calls of each operation ID.
var polls: Dictionary[int, int] = {}
## Operation IDs `cancel_share` got, in order.
var cancelled: PackedInt64Array = PackedInt64Array()
var _started: int = 0


func request_review() -> bool:
	return true


func start_share(_text: String, _png: PackedByteArray) -> int:
	_started += 1
	return _started


func take_share_result(id: int) -> PackedInt32Array:
	var count: int = (polls[id] if polls.has(id) else 0) + 1
	polls[id] = count
	if count != 2 or id > replies.size():
		return PackedInt32Array()
	return replies[id - 1]


func cancel_share(id: int) -> void:
	cancelled.append(id)
