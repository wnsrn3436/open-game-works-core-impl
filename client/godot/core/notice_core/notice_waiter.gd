extends RefCounted
## One wait of `NoticeCore`: a fetch, an image load, a maintenance popup or the maintenance retry delay. Its callers
## wait on `finished`.

## Emitted once, when the wait ends or `NoticeCore.release` ends it.
signal finished

## Whether `finished` was emitted.
var done: bool = false
## Success flag of a fetch.
var ok: bool = false
## Image of an image load. `null` on failure.
var texture: ImageTexture = null
## Notice ID of an image load.
var notice_id: int = 0
## Whether the image load passed `NoticeCore.imageTimeoutMs`.
var timed_out: bool = false
