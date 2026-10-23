class_name EventCoreTestSubscriber
extends Node
## Subscriber of the EventCore core test. It records what it receives and runs the test's action inside a callback.

## Calls of `on_static`.
static var static_calls: int = 0

## `value` of every A event received, in order.
var a_values: PackedInt64Array = PackedInt64Array()
## B events received.
var b_count: int = 0
## Values a test action records.
var notes: PackedInt64Array = PackedInt64Array()
## Run inside `on_a` after recording, with this subscriber and the event. Empty runs nothing.
var on_a_action: Callable = Callable()
## Calls of `on_a_failing`, and the calls of it that went on past its runtime error.
var failing_calls: int = 0
var failing_finished: int = 0


func on_a(event: EventCoreTestAEvent) -> void:
	a_values.append(event.value)
	if on_a_action.is_valid():
		on_a_action.call(self, event)


## A callback that stops on a GDScript runtime error, an out-of-bounds read, after counting the call.
func on_a_failing(event: EventCoreTestAEvent) -> void:
	failing_calls += 1
	var none: PackedInt64Array = PackedInt64Array()
	a_values.append(none[event.value])
	failing_finished += 1


func on_b(_event: EventCoreTestBEvent) -> void:
	b_count += 1


func on_debug(_event: EventCoreTestDebugEvent) -> void:
	pass


static func on_static(_event: EventCoreTestAEvent) -> void:
	static_calls += 1
