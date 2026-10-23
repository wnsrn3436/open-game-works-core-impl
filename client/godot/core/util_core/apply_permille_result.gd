class_name ApplyPermilleResult
extends RefCounted
## Result of `UtilCore.apply_permille`.

## False when `value × permille` is outside int64.
var ok: bool = false
## `floor_div(value × permille, 1000)`. 0 on failure.
var value: int = 0
