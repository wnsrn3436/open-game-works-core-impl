extends Object
## Callback owner of one state in state machine tests. Writes each call to a shared log. Extends `Object` so that a
## test can destroy it with `free()`.

const StateCallLog := preload("res://core/util_core/tests/support/state_call_log.gd")

var state: int = 0
var call_log: StateCallLog = null
var machine: UtilStateMachine = null
## When 0 or more, `on_enter` and `on_exit` try `change_state` to this state and `update_state(16)`.
var nested_target: int = -1
var nested_results: Array[bool] = []


func _init(owned_state: int, shared_log: StateCallLog) -> void:
	state = owned_state
	call_log = shared_log


func callbacks() -> UtilStateCallbacks:
	var out: UtilStateCallbacks = UtilStateCallbacks.new()
	out.on_enter = on_enter
	out.on_exit = on_exit
	out.on_update = on_update
	return out


func on_enter(previous: int) -> void:
	call_log.add("enter %d from %d" % [state, previous])
	_try_nested()


func on_exit(next: int) -> void:
	call_log.add("exit %d to %d" % [state, next])
	_try_nested()


func on_update(elapsed_ms: int) -> void:
	call_log.add("update %d %d" % [state, elapsed_ms])


func _try_nested() -> void:
	if nested_target < 0 or machine == null:
		return
	var elapsed_before: int = UtilCore.state_elapsed_ms(machine)
	nested_results.append(UtilCore.change_state(machine, nested_target))
	UtilCore.update_state(machine, 16)
	nested_results.append(UtilCore.state_elapsed_ms(machine) == elapsed_before)
