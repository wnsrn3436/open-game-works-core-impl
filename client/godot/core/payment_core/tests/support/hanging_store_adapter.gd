extends FakeStoreAdapter
## Fake store adapter whose `connect` does not end until `release_hang`: the store call time limit test.

signal released

var hang: bool = true


func connect_store() -> bool:
	calls.append("connect")
	while hang:
		await released
	return true


func release_hang() -> void:
	hang = false
	released.emit()
