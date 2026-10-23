class_name PoolCoreTestObject
extends PoolObject
## Root script of the counting test prefabs.

var borrow_count: int = 0
var return_count: int = 0


func on_borrow() -> void:
	borrow_count += 1


func on_return() -> void:
	return_count += 1
