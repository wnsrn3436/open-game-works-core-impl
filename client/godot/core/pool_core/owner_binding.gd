extends RefCounted
## The owner-bound borrows of one owner scope. The item list keeps its size and the used part is `[0, count)`.

var owner_scope: Scope = null
## Instance ID of the owner object.
var owner_id: int = 0
var items: Array[PoolObject] = []
var count: int = 0
