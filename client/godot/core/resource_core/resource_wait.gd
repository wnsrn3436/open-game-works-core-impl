extends RefCounted
## A wait of a preload or a shader warmup. `ResourceCore.release` emits `finished` to resume it.

signal finished

## Items of a preload not finished yet.
var remaining: int = 0
## False when an item of a preload failed.
var ok: bool = true
