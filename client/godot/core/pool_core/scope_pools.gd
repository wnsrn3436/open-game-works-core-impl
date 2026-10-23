extends RefCounted
## The pools of one pool scope by resource key.

const _POOL := preload("res://core/pool_core/pool.gd")

var pools: Dictionary[String, _POOL] = {}
## The values of `pools` in the order they were made.
var list: Array[_POOL] = []
