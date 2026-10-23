class_name BigToIntResult
extends RefCounted
## Result of `UtilCore.big_to_int`.

## False when the input is not a big integer or is outside int64.
var ok: bool = false
## The int64 value. 0 on failure.
var value: int = 0
