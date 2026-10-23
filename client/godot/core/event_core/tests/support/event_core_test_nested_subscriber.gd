class_name EventCoreTestNestedSubscriber
extends Node
## Subscriber of the EventCore allocation test. On an A event with value 1 it publishes an A event with value 2 from
## inside the callback, so each outer publish reaches delivery depth 2. It allocates nothing.

## A events received.
var count: int = 0


func on_a(event: EventCoreTestAEvent) -> void:
	count += 1
	if event.value != 1:
		return
	var inner: EventCoreTestAEvent = EventCore.acquire(EventCoreTestAEvent) as EventCoreTestAEvent
	inner.value = 2
	EventCore.publish(inner)
