extends RefCounted
## One `change_scene` or `boot_change_scene` call. The call waits for `finished`, which the transition emits when it
## ends and `SceneCore` emits when `release` stops the transition.

signal finished

var done: bool = false
## The success flag of the transition. Valid when `done`.
var result: bool = false


func finish(value: bool) -> void:
	if done:
		return
	done = true
	result = value
	finished.emit()
