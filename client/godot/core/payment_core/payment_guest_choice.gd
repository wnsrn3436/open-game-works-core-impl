extends RefCounted
## The answer of the guest warning popup. `UICore` calls the hidden callback before the callback of the pressed
## button, so the hidden callback decides only after the current call: a hidden callback with no button callback is
## `HIDDEN`.

enum Choice { NONE, LINK, CONTINUE, CANCEL, HIDDEN }

signal done

var choice: Choice = Choice.NONE
var finished: bool = false
## True after the hidden callback.
var hidden_called: bool = false


func on_link() -> void:
	_finish(Choice.LINK)


func on_continue() -> void:
	_finish(Choice.CONTINUE)


func on_cancel() -> void:
	_finish(Choice.CANCEL)


func on_hidden() -> void:
	hidden_called = true
	_on_hidden_after.call_deferred()


## `release` cut the wait short.
func cancel() -> void:
	_finish(Choice.NONE)


func _on_hidden_after() -> void:
	_finish(Choice.HIDDEN)


func _finish(value: Choice) -> void:
	if finished:
		return
	finished = true
	choice = value
	done.emit()
