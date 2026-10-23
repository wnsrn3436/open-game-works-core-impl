extends RefCounted
## One object pool of `PoolCore`: a resource key and a pool scope. The lists keep their size and the used part is
## `[0, count)`, so lending and taking back do not resize them.

var resource_key: String = ""
var pool_scope: Scope = null
var prefab: PackedScene = null
## The last prefill count. 0 for a pool never prefilled.
var prefill_count: int = 0
## Pool objects in the pool.
var idle: Array[PoolObject] = []
var idle_count: int = 0
## Borrowed pool objects.
var borrowed: Array[PoolObject] = []
var borrowed_count: int = 0
## True after the pool scope release removed the pool.
var removed: bool = false
