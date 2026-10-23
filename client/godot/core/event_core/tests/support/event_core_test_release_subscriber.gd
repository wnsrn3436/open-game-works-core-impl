class_name EventCoreTestReleaseSubscriber
extends Node
## Subscriber of the EventCore release-during-delivery tests. It counts what it receives and runs the test's action
## inside a callback.

## Outer and inner events received.
var outer_count: int = 0
var inner_count: int = 0
## Run inside `on_outer` and `on_inner` after counting, with this subscriber. Empty runs nothing.
var on_outer_action: Callable = Callable()
var on_inner_action: Callable = Callable()


func on_outer(_event: EventCoreTestOuterEvent) -> void:
	outer_count += 1
	if on_outer_action.is_valid():
		on_outer_action.call(self)


func on_inner(_event: EventCoreTestInnerEvent) -> void:
	inner_count += 1
	if on_inner_action.is_valid():
		on_inner_action.call(self)
