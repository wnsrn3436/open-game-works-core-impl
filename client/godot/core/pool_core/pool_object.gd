class_name PoolObject
extends Node
## Base of the root script of a pool object prefab. The root script overrides `on_borrow` and `on_return`; a prefab
## whose root script does not override both does not make pool objects. Do not destroy a pool object outside
## `PoolCore`: give it back.

const _ENTRY := preload("res://core/pool_core/pool_entry.gd")

## Auto-return: the instance calls `PoolCore.notify_finished(self)` when it ends and `PoolCore` takes it back.
## Manual-return when false: the borrower gives it back. `PoolCore` reads it once, when it makes the instance.
@export var auto_return: bool = false

## The `PoolCore` record of this instance while `PoolCore` keeps it. Internal to `PoolCore`.
var _pool_entry: _ENTRY = null


## Called right before `PoolCore` lends this instance. Puts back the state common cleanup does not.
func on_borrow() -> void:
	pass


## Called when `PoolCore` takes this instance back, before common cleanup. Puts back the state common cleanup does not.
func on_return() -> void:
	pass


func _notification(what: int) -> void:
	if _pool_entry == null:
		return
	if what == NOTIFICATION_PREDELETE:
		PoolCore._on_pool_object_predelete(self)
	elif what == NOTIFICATION_EXIT_TREE:
		PoolCore._on_pool_object_exit_tree(self)
