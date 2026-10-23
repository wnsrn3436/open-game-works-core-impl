extends FakeStoreAdapter
## Fake store adapter whose `finish` does not end while `hold_finish` is true: a login session change during `finish`.

signal finish_released

var hold_finish: bool = true
## `finish` calls that started, held or not.
var finish_started: int = 0


func finish(receipt: Receipt, product_type: GameData.IapProductType) -> bool:
	finish_started += 1
	while hold_finish:
		await finish_released
	return await super.finish(receipt, product_type)


func release_finish() -> void:
	hold_finish = false
	finish_released.emit()
