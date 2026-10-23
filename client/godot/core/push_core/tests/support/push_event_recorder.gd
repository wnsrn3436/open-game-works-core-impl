extends Node
## Records the PushCore events of a core test.

## Message ID values of `PushReceivedEvent`, in order.
var received: PackedInt64Array = PackedInt64Array()
## Message ID values of `PushOpenedEvent`, in order.
var opened: PackedInt64Array = PackedInt64Array()


## Adds the recorder to the tree and subscribes. True when both subscriptions succeed.
func start() -> bool:
	(Engine.get_main_loop() as SceneTree).root.add_child(self)
	return EventCore.subscribe(PushReceivedEvent, _on_received) and EventCore.subscribe(PushOpenedEvent, _on_opened)


## Unsubscribes and frees the recorder.
func finish() -> void:
	if EventCore.is_initialized():
		EventCore.unsubscribe_all(self)
	queue_free()


func _on_received(event: PushReceivedEvent) -> void:
	received.append(event.message_id)


func _on_opened(event: PushOpenedEvent) -> void:
	opened.append(event.message_id)
