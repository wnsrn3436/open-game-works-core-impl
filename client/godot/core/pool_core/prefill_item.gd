class_name PrefillItem
extends RefCounted
## One `PoolCore.prefill` item.

var resource_key: String = ""
var pool_scope: Scope = null
## Prefill count. Negative: omitted, `PoolCore.defaultPrefillCount` is used.
var count: int = -1
