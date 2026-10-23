class_name EventCoreTestCase
extends UnitTestCase
## Base of the EventCore core tests: `LogCore` and `EventCore` are initialized in module list order before each test,
## and the subscriber nodes a test makes are freed after it.

const TAG: String = "EventCore"

var _nodes: Array[Node] = []


func before_each() -> void:
	super()
	assert_true(LogCore.init())
	assert_true(EventCore.init())


func after_each() -> void:
	super()
	EventCore.release()
	LogCore.release()
	for node: Node in _nodes:
		if is_instance_valid(node):
			node.free()
	_nodes.clear()


## A subscriber freed after the test.
func subscriber() -> EventCoreTestSubscriber:
	var node: EventCoreTestSubscriber = EventCoreTestSubscriber.new()
	_nodes.append(node)
	return node


## An init listener freed after the test.
func init_listener() -> EventCoreTestInitListener:
	var node: EventCoreTestInitListener = EventCoreTestInitListener.new()
	_nodes.append(node)
	return node


## Publishes an A event carrying `value`.
func publish_a(value: int) -> void:
	var event: EventCoreTestAEvent = EventCore.acquire(EventCoreTestAEvent) as EventCoreTestAEvent
	event.value = value
	EventCore.publish(event)


## Publishes a B event carrying `value`.
func publish_b(value: int) -> void:
	var event: EventCoreTestBEvent = EventCore.acquire(EventCoreTestBEvent) as EventCoreTestBEvent
	event.value = value
	EventCore.publish(event)


## Unconfirmed `error` logs of EventCore, which this confirms.
func error_logs() -> int:
	return UnitTestCore.check_logs("error", TAG)


## Registered init listeners that `UnitTestCore` did not register. In a test, `UnitTestCore` registers its listener again
## whenever a `release` of `EventCore` takes the core node out of the tree, so after a `release` that listener can be
## there; every other registration is gone.
func listeners_not_of_unit_test_core() -> int:
	var count: int = 0
	for listener: Callable in EventCore._init_listeners:
		if listener.get_object() != UnitTestCore:
			count += 1
	return count
