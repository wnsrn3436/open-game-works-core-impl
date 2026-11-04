extends "res://core/payment_core/dev/adapters/fake_store_adapter.gd"
## Fake store adapter whose `buy` does not end while `hold_store_buy` is true and then ends with the result
## `fake_set_next_buy_result` set: a login session change during `buy` for each `buy` result.

signal store_buy_released

var hold_store_buy: bool = true
## `buy` calls that started, held or not.
var buy_started: int = 0


func buy(sku: String, product_type: GameData.IapProductType, account_token: String) -> BuyResult:
	buy_started += 1
	while hold_store_buy:
		await store_buy_released
	return await super.buy(sku, product_type, account_token)


func release_buy() -> void:
	hold_store_buy = false
	store_buy_released.emit()
