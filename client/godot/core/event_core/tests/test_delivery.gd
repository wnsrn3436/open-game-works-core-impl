extends EventCoreTestCase
## Changes during a delivery, nested publishes, reuse of event objects and record slots, and the publish `debug` log.


func test_subscription_added_during_delivery_receives_from_the_next_publish() -> void:
	var x: EventCoreTestSubscriber = subscriber()
	var z: EventCoreTestSubscriber = subscriber()
	var w: EventCoreTestSubscriber = subscriber()
	var v: EventCoreTestSubscriber = subscriber()
	# w leaves an empty record slot after x's: during the delivery z takes it before the delivery reaches it, and v
	# takes a new slot.
	assert_true(EventCore.subscribe(EventCoreTestAEvent, x.on_a))
	assert_true(EventCore.subscribe(EventCoreTestAEvent, w.on_a))
	EventCore.unsubscribe(EventCoreTestAEvent, w.on_a)
	x.on_a_action = func(s: EventCoreTestSubscriber, _e: EventCoreTestAEvent) -> void:
		if s.a_values.size() == 1:
			EventCore.subscribe(EventCoreTestAEvent, z.on_a)
			EventCore.subscribe(EventCoreTestAEvent, v.on_a)
	publish_a(1)
	assert_eq(z.a_values.size(), 0)
	assert_eq(v.a_values.size(), 0)
	publish_a(2)
	assert_eq(z.a_values, PackedInt64Array([2]))
	assert_eq(v.a_values, PackedInt64Array([2]))


func test_subscription_removed_during_delivery_before_it_receives_gets_nothing() -> void:
	var x: EventCoreTestSubscriber = subscriber()
	var y: EventCoreTestSubscriber = subscriber()
	assert_true(EventCore.subscribe(EventCoreTestAEvent, x.on_a))
	assert_true(EventCore.subscribe(EventCoreTestAEvent, y.on_a))
	# The call order is not defined: whichever is called first removes the other.
	var remove_other: Callable = func(s: EventCoreTestSubscriber, _e: EventCoreTestAEvent) -> void:
		var other: EventCoreTestSubscriber = y if s == x else x
		if other.a_values.is_empty():
			EventCore.unsubscribe(EventCoreTestAEvent, other.on_a)
	x.on_a_action = remove_other
	y.on_a_action = remove_other
	publish_a(1)
	assert_eq(x.a_values.size() + y.a_values.size(), 1)
	publish_a(2)
	assert_eq(x.a_values.size() + y.a_values.size(), 2)
	assert_true(x.a_values.is_empty() or y.a_values.is_empty())


func test_other_event_published_inside_delivery_arrives_before_the_outer_publish_returns() -> void:
	var x: EventCoreTestSubscriber = subscriber()
	var y: EventCoreTestSubscriber = subscriber()
	assert_true(EventCore.subscribe(EventCoreTestAEvent, x.on_a))
	assert_true(EventCore.subscribe(EventCoreTestBEvent, y.on_b))
	x.on_a_action = func(s: EventCoreTestSubscriber, _e: EventCoreTestAEvent) -> void:
		publish_b(1)
		s.notes.append(y.b_count)
	publish_a(1)
	assert_eq(x.notes, PackedInt64Array([1]))


func test_nested_publish_of_the_same_type_keeps_the_outer_event() -> void:
	var x: EventCoreTestSubscriber = subscriber()
	var y: EventCoreTestSubscriber = subscriber()
	assert_true(EventCore.subscribe(EventCoreTestAEvent, x.on_a))
	assert_true(EventCore.subscribe(EventCoreTestAEvent, y.on_a))
	# The outer event value each subscriber sees after its inner publish returns, in `notes`.
	var nest: Callable = func(s: EventCoreTestSubscriber, event: EventCoreTestAEvent) -> void:
		if event.value != 1 or not x.notes.is_empty() or not y.notes.is_empty():
			return
		var inner: EventCoreTestAEvent = EventCore.acquire(EventCoreTestAEvent) as EventCoreTestAEvent
		assert_ne(inner, event)
		inner.value = 2
		EventCore.publish(inner)
		s.notes.append(event.value)
	# Whichever is called first publishes the inner event; the other then receives the outer one after it.
	x.on_a_action = nest
	y.on_a_action = nest
	# The second round reuses the event objects the first one made.
	for pass_index: int in 2:
		for target: EventCoreTestSubscriber in [x, y] as Array[EventCoreTestSubscriber]:
			target.a_values.clear()
			target.notes.clear()
		publish_a(1)
		var outer_after_inner: PackedInt64Array = x.notes + y.notes
		assert_eq(outer_after_inner, PackedInt64Array([1]), "round %d" % pass_index)
		for target: EventCoreTestSubscriber in [x, y] as Array[EventCoreTestSubscriber]:
			var values: PackedInt64Array = target.a_values.duplicate()
			values.sort()
			assert_eq(values, PackedInt64Array([1, 2]), "round %d" % pass_index)


func test_acquire_publish_up_to_a_reached_depth_and_subscription_counts_allocate_nothing() -> void:
	var nested: EventCoreTestNestedSubscriber = EventCoreTestNestedSubscriber.new()
	_nodes.append(nested)
	var churn: EventCoreTestSubscriber = subscriber()
	var churn_a: Callable = churn.on_a
	var churn_b: Callable = churn.on_b
	assert_true(EventCore.subscribe(EventCoreTestAEvent, nested.on_a))
	assert_true(EventCore.subscribe(EventCoreTestAEvent, churn_a))
	assert_true(EventCore.subscribe(EventCoreTestBEvent, churn_b))
	assert_eq(EventCore.unsubscribe_all(churn), 2)
	# One delivery of depth 2 makes the event object of each depth.
	_publish_nested()
	assert_eq(nested.count, 2)
	LogCore.release()
	for i: int in 100:
		_publish_nested()
		_count_and_unsubscribe(churn)
	var objects: float = Performance.get_monitor(Performance.OBJECT_COUNT)
	var memory: float = Performance.get_monitor(Performance.MEMORY_STATIC)
	for i: int in 1000:
		_publish_nested()
		_count_and_unsubscribe(churn)
	# Read both before asserting: an assert allocates.
	var objects_after: float = Performance.get_monitor(Performance.OBJECT_COUNT)
	var memory_after: float = Performance.get_monitor(Performance.MEMORY_STATIC)
	assert_lte(objects_after, objects)
	assert_lte(memory_after, memory)
	assert_eq(nested.count, 2 * 1101)


func test_record_slots_stay_within_twice_the_concurrent_subscriptions_under_churn_during_delivery() -> void:
	var x: EventCoreTestSubscriber = subscriber()
	var z: EventCoreTestSubscriber = subscriber()
	assert_true(EventCore.subscribe(EventCoreTestAEvent, x.on_a))
	x.on_a_action = func(_s: EventCoreTestSubscriber, _e: EventCoreTestAEvent) -> void:
		for i: int in 1000:
			EventCore.subscribe(EventCoreTestAEvent, z.on_a)
			EventCore.unsubscribe(EventCoreTestAEvent, z.on_a)
	publish_a(1)
	publish_a(2)
	# At most x and z subscribe at the same time.
	assert_lte(EventCore._count_slots(EventCoreTestAEvent), 2 * 2)
	assert_eq(z.a_values.size(), 0)
	assert_eq(x.a_values, PackedInt64Array([1, 2]))


func test_release_in_the_first_callback_stops_the_delivery_without_a_log() -> void:
	var subscribers: Array[EventCoreTestReleaseSubscriber] = _release_subscribers(3)
	for s: EventCoreTestReleaseSubscriber in subscribers:
		assert_true(EventCore.subscribe(EventCoreTestOuterEvent, s.on_outer))
		s.on_outer_action = func(_s: EventCoreTestReleaseSubscriber) -> void:
			EventCore.release()
	EventCore.publish(EventCore.acquire(EventCoreTestOuterEvent))
	assert_eq(_outer_count(subscribers), 1, "the other two did not receive")
	assert_false(EventCore.is_initialized())
	_assert_no_log()
	LogCore.release()
	assert_eq(_publish_log_lines("EventCoreTestOuterEvent").size(), 0, "no debug log")


func test_release_and_init_in_an_inner_callback_stop_the_inner_and_the_outer_delivery_without_a_log() -> void:
	var outer: Array[EventCoreTestReleaseSubscriber] = _release_subscribers(2)
	var inner: Array[EventCoreTestReleaseSubscriber] = _release_subscribers(3)
	for s: EventCoreTestReleaseSubscriber in outer:
		assert_true(EventCore.subscribe(EventCoreTestOuterEvent, s.on_outer))
		s.on_outer_action = func(_s: EventCoreTestReleaseSubscriber) -> void:
			EventCore.publish(EventCore.acquire(EventCoreTestInnerEvent))
	for s: EventCoreTestReleaseSubscriber in inner:
		assert_true(EventCore.subscribe(EventCoreTestInnerEvent, s.on_inner))
		s.on_inner_action = func(_s: EventCoreTestReleaseSubscriber) -> void:
			EventCore.release()
			EventCore.init()
	EventCore.publish(EventCore.acquire(EventCoreTestOuterEvent))
	assert_eq(_outer_count(outer), 1, "the other outer subscriber did not receive")
	assert_eq(_inner_count(inner), 1, "the other two inner subscribers did not receive")
	assert_true(EventCore.is_initialized())
	_assert_no_log()
	# After the init in the callback, a new subscription to the same type receives without an error log.
	var late: EventCoreTestReleaseSubscriber = _release_subscribers(1)[0]
	assert_true(EventCore.subscribe(EventCoreTestInnerEvent, late.on_inner))
	EventCore.publish(EventCore.acquire(EventCoreTestInnerEvent))
	assert_eq(late.inner_count, 1)
	assert_eq(_inner_count(inner), 1, "the subscriptions before the release are gone")
	assert_eq(error_logs(), 0)
	LogCore.release()
	assert_eq(_publish_log_lines("EventCoreTestOuterEvent").size(), 0, "no debug log of the outer publish")
	assert_eq(
		_publish_log_lines("EventCoreTestInnerEvent"),
		PackedStringArray(["publish EventCoreTestInnerEvent: 1 subscriptions called"]),
		"only the publish after the init writes its debug log"
	)


func test_a_callback_that_stops_on_a_runtime_error_does_not_stop_the_publish() -> void:
	var x: EventCoreTestSubscriber = subscriber()
	var y: EventCoreTestSubscriber = subscriber()
	var z: EventCoreTestSubscriber = subscriber()
	assert_true(EventCore.subscribe(EventCoreTestAEvent, x.on_a))
	assert_true(EventCore.subscribe(EventCoreTestAEvent, y.on_a_failing))
	assert_true(EventCore.subscribe(EventCoreTestAEvent, z.on_a))
	publish_a(1)
	publish_a(2)
	assert_eq(UnitTestCore.check_script_errors(), 2, "y stopped on a runtime error in each publish")
	assert_eq(y.failing_calls, 2)
	assert_eq(y.failing_finished, 0, "y never went past its runtime error")
	assert_eq(x.a_values, PackedInt64Array([1, 2]))
	assert_eq(z.a_values, PackedInt64Array([1, 2]))
	# Godot does not report the failure to EventCore (`client-core` Godot `## event`), so EventCore logs nothing: an
	# EventCore error log would be unchecked and fail the test.


func test_publish_writes_a_debug_log_with_the_type_name_and_called_subscriptions() -> void:
	var x: EventCoreTestSubscriber = subscriber()
	var y: EventCoreTestSubscriber = subscriber()
	assert_true(EventCore.subscribe(EventCoreTestDebugEvent, x.on_debug))
	assert_true(EventCore.subscribe(EventCoreTestDebugEvent, y.on_debug))
	EventCore.publish(EventCore.acquire(EventCoreTestDebugEvent))
	# `release` flushes the write buffer to the log file.
	LogCore.release()
	var found: int = 0
	for line: String in _log_lines():
		var fields: PackedStringArray = line.split("\t")
		if fields.size() >= 4 and fields[1] == "debug" and fields[2] == TAG and fields[3].contains("EventCoreTestDebugEvent"):
			assert_eq(fields[3], "publish EventCoreTestDebugEvent: 2 subscriptions called")
			found += 1
	assert_eq(found, 1)


## Publishes an A event with value 1: the nested subscriber publishes value 2 inside it.
func _publish_nested() -> void:
	var event: EventCoreTestAEvent = EventCore.acquire(EventCoreTestAEvent) as EventCoreTestAEvent
	event.value = 1
	EventCore.publish(event)


func _count_and_unsubscribe(target: EventCoreTestSubscriber) -> void:
	EventCore.count_subscriptions(target)
	EventCore.unsubscribe_all(target)


## `count` release-test subscribers freed after the test.
func _release_subscribers(count: int) -> Array[EventCoreTestReleaseSubscriber]:
	var made: Array[EventCoreTestReleaseSubscriber] = []
	for i: int in count:
		var node: EventCoreTestReleaseSubscriber = EventCoreTestReleaseSubscriber.new()
		_nodes.append(node)
		made.append(node)
	return made


func _outer_count(subscribers: Array[EventCoreTestReleaseSubscriber]) -> int:
	var count: int = 0
	for s: EventCoreTestReleaseSubscriber in subscribers:
		count += s.outer_count
	return count


func _inner_count(subscribers: Array[EventCoreTestReleaseSubscriber]) -> int:
	var count: int = 0
	for s: EventCoreTestReleaseSubscriber in subscribers:
		count += s.inner_count
	return count


func _assert_no_log() -> void:
	assert_eq(error_logs(), 0, "no error log")
	assert_eq(UnitTestCore.check_logs("warn", TAG), 0, "no warn log")


## The messages of the EventCore `debug` log lines of the publishes of `type_name` in the log files.
func _publish_log_lines(type_name: String) -> PackedStringArray:
	var messages: PackedStringArray = PackedStringArray()
	for line: String in _log_lines():
		var fields: PackedStringArray = line.split("\t")
		if fields.size() >= 4 and fields[1] == "debug" and fields[2] == TAG and fields[3].begins_with("publish %s:" % type_name):
			messages.append(fields[3])
	return messages


## Every line of every log file in app storage.
func _log_lines() -> PackedStringArray:
	var lines: PackedStringArray = PackedStringArray()
	var folder: String = CoreBuildInfo.storage_root + "log"
	for file: String in DirAccess.get_files_at(folder):
		if file.begins_with("log_") and file.ends_with(".txt"):
			lines.append_array(FileAccess.get_file_as_string(folder + "/" + file).split("\n", false))
	return lines
