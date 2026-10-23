class_name UnitTestLatch
extends RefCounted
## Latch of `UnitTestCore.latch_event`: subscribes to one event type when made and keeps whether the event came.

## Emitted when the event comes, and when `UnitTestCore` ends the wait: test time limit or `release`.
signal done

## Event type the latch subscribes to.
var event_type: Script = null
## Whether the event came after the latch was made.
var happened: bool = false


func _on_event(_event: EventBase) -> void:
	if happened:
		return
	happened = true
	if EventCore.is_initialized():
		EventCore.unsubscribe(event_type, _on_event)
	done.emit()
