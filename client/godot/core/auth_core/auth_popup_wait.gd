extends RefCounted
## Close of one popup AuthCore opened. A button callback or the result callback finishes it with the choice; a
## hidden callback with no button callback after it finishes it with no choice.

## `choice` when the popup closed with no button and no result callback.
const HIDDEN: int = -1
## `choice` of the result callback of a core popup.
const RESULT: int = 100

signal done

## True after the popup closed or the wait was cut short.
var finished: bool = false
## Index of the pressed system popup button, `RESULT` for the result callback, or `HIDDEN`.
var choice: int = HIDDEN


func on_hidden() -> void:
	_finish_hidden.call_deferred()


func on_button_0() -> void:
	_finish(0)


func on_button_1() -> void:
	_finish(1)


func on_button_2() -> void:
	_finish(2)


func on_result() -> void:
	_finish(RESULT)


## Finishes the wait with no choice. `release` uses it.
func cancel() -> void:
	_finish(HIDDEN)


## The button and result callbacks come after the hidden callback in the same close, so the hidden close is
## decided one call later.
func _finish_hidden() -> void:
	_finish(HIDDEN)


func _finish(value: int) -> void:
	if finished:
		return
	finished = true
	choice = value
	done.emit()
