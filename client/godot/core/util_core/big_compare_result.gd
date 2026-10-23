class_name BigCompareResult
extends RefCounted
## Result of `UtilCore.big_compare`.

## False when an input is not a big integer.
var ok: bool = false
## −1 when `a` < `b`, 0 when they are equal, 1 when `a` > `b`. 0 on failure.
var value: int = 0
