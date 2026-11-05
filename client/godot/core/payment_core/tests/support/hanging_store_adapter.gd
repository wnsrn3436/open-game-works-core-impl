extends "res://core/payment_core/dev/adapters/fake_store_adapter.gd"
## Fake store adapter whose `connect` does not end until `release_hang`: the store call time limit test and a login
## session change while `prepare` connects. `fake_set_fail`(`connect`, `true`) makes the released `connect` fail.

signal released

var hang: bool = true


func connect_store() -> bool:
	calls.append("connect")
	while hang:
		await released
	return not failing.has("connect")


func release_hang() -> void:
	hang = false
	released.emit()
