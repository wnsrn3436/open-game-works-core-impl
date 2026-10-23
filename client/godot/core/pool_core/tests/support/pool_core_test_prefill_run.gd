class_name PoolCoreTestPrefillRun
extends RefCounted
## One `PoolCore.prefill` a test starts without waiting and waits for later.

signal finished

var done: bool = false
var result: bool = false


func run(items: Array[PrefillItem]) -> void:
	result = await PoolCore.prefill(items)
	done = true
	finished.emit()


## The result of the prefill. Async.
func wait() -> bool:
	if not done:
		await finished
	return result
