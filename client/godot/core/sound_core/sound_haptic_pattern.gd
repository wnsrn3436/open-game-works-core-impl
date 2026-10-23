extends RefCounted
## A haptic resource checked against the haptic pattern format on its first play: its segments when it passed. The
## segments of every variant follow each other in variant order.

var valid: bool = false
var delays_ms: PackedInt64Array = PackedInt64Array()
var durations_ms: PackedInt64Array = PackedInt64Array()
## Permille, 0 to 1000.
var intensities: PackedInt64Array = PackedInt64Array()
## End of the segments of each variant, exclusive: variant `n` has the segments from `variant_ends[n - 1]` (0 for the
## first variant) to `variant_ends[n]`.
var variant_ends: PackedInt64Array = PackedInt64Array()
