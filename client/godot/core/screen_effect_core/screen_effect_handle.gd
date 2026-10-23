class_name ScreenEffectHandle
extends RefCounted
## One `ScreenEffectCore` request: its channel, its owner and its result. The result is set once.

const _WAITER := preload("res://core/screen_effect_core/screen_effect_waiter.gd")

## `ScreenEffectCore.ScreenEffectChannel` of the request. -1 for a request that failed its input check.
var _channel: int = -1
## Instance ID of the owner object. 0 when there is none.
var _owner_id: int = 0
## `TweenCore` tween handle of the playback. 0 when no tween plays.
var _tween: int = 0
var _done: bool = false
var _result: ScreenEffectCore.ScreenEffectResult = ScreenEffectCore.ScreenEffectResult.FAILED
## Emits `done` once when the result is set. `ScreenEffectCore.wait_result` waits on it.
var _waiter: _WAITER = _WAITER.new()


## Sets the result unless it is set, and resumes the waiting `wait_result` calls.
func _finish(result: ScreenEffectCore.ScreenEffectResult) -> void:
	if _done:
		return
	_done = true
	_result = result
	_tween = 0
	_waiter.done.emit()
