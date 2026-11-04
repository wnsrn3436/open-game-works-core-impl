extends "res://core/payment_core/dev/adapters/fake_store_adapter.gd"
## Fake store adapter whose `list_unfinished` and `list_owned` do not end while `hold_lists` is true: a login session
## change while the store lists run.

signal lists_released

var hold_lists: bool = true
## `list_unfinished` and `list_owned` calls that started, held or not.
var lists_started: int = 0


func list_unfinished() -> ReceiptList:
	lists_started += 1
	while hold_lists:
		await lists_released
	return await super.list_unfinished()


func list_owned() -> ReceiptList:
	lists_started += 1
	while hold_lists:
		await lists_released
	return await super.list_owned()


func release_lists() -> void:
	hold_lists = false
	lists_released.emit()
