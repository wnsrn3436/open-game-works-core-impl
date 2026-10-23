extends RefCounted
## A `play_bgm` or `return_bgm` request whose loading has not ended.

const _RECORD := preload("res://core/sound_core/sound_bgm_record.gd")

var record: _RECORD = null
## A `return_bgm` request: `record` is the previous BGM.
var is_return: bool = false
## Its load started.
var started: bool = false
