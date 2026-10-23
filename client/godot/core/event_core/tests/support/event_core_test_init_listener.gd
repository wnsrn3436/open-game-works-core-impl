class_name EventCoreTestInitListener
extends Node
## Init listener of the EventCore core test. Each listener method records its name and what it saw of `EventCore`.

## Name of each listener call, in call order.
var calls: PackedStringArray = PackedStringArray()
## `EventCore.is_initialized()` at each call.
var initialized: Array[bool] = []
## Subscriber `on_first` subscribes to A. Null subscribes nothing.
var target: EventCoreTestSubscriber = null
## `subscribe` result of `on_first`, when it subscribed.
var subscribed: bool = false
## Calls of the static listener `on_static`. The test that registers it resets it.
static var static_calls: int = 0


static func on_static() -> void:
	static_calls += 1


func on_first() -> void:
	_record("first")
	if target != null:
		subscribed = EventCore.subscribe(EventCoreTestAEvent, target.on_a)


func on_second() -> void:
	_record("second")


## Records `name`. Registered only through a `bind()`.
func on_named(name: String) -> void:
	_record(name)


## Registers `on_second` from inside the listener call.
func on_register_second() -> void:
	_record("register_second")
	EventCoreDev.register_init_listener(on_second)


func on_release() -> void:
	_record("release")
	EventCore.release()


func _record(name: String) -> void:
	calls.append(name)
	initialized.append(EventCore.is_initialized())
