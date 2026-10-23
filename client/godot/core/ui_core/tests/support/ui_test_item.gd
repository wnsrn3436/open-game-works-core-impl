extends PoolObject
## Root script of the test scroll list item prefabs: the index it was last bound to.

var bound_index: int = -1


func on_borrow() -> void:
	pass


func on_return() -> void:
	bound_index = -1
