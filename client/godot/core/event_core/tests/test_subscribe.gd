extends EventCoreTestCase
## Subscribing, unsubscribing and the subscriptions EventCore refuses or removes.


func test_publish_calls_only_subscribers_of_the_type_before_it_returns() -> void:
	var x: EventCoreTestSubscriber = subscriber()
	var y: EventCoreTestSubscriber = subscriber()
	assert_true(EventCore.subscribe(EventCoreTestAEvent, x.on_a))
	assert_true(EventCore.subscribe(EventCoreTestBEvent, y.on_b))
	var returned: Array[bool] = [false]
	var seen_returned: Array[bool] = []
	x.on_a_action = func(_s: EventCoreTestSubscriber, _e: EventCoreTestAEvent) -> void: seen_returned.append(returned[0])
	publish_a(5)
	returned[0] = true
	assert_eq(x.a_values, PackedInt64Array([5]))
	assert_eq(seen_returned, [false] as Array[bool])
	assert_eq(y.b_count, 0)
	EventCore.unsubscribe(EventCoreTestAEvent, x.on_a)
	publish_a(6)
	assert_eq(x.a_values, PackedInt64Array([5]))
	assert_eq(y.b_count, 0)


func test_second_subscribe_lambda_and_destroyed_subscriber_are_refused() -> void:
	var twice: EventCoreTestSubscriber = subscriber()
	assert_true(EventCore.subscribe(EventCoreTestAEvent, twice.on_a))
	assert_false(EventCore.subscribe(EventCoreTestAEvent, twice.on_a))
	assert_eq(error_logs(), 1)

	var lambda_target: EventCoreTestSubscriber = subscriber()
	var lambda: Callable = func(event: EventCoreTestAEvent) -> void: lambda_target.a_values.append(event.value)
	assert_false(EventCore.subscribe(EventCoreTestAEvent, lambda))
	assert_eq(error_logs(), 1)

	var gone: EventCoreTestSubscriber = EventCoreTestSubscriber.new()
	var gone_callback: Callable = gone.on_a
	gone.free()
	assert_false(EventCore.subscribe(EventCoreTestAEvent, gone_callback))
	assert_eq(error_logs(), 1)

	publish_a(1)
	assert_eq(twice.a_values.size(), 1)
	assert_eq(lambda_target.a_values.size(), 0)
	assert_eq(EventCore.count_subscriptions(twice), 1)


func test_static_and_bound_callbacks_are_refused() -> void:
	EventCoreTestSubscriber.static_calls = 0
	var bound_target: EventCoreTestSubscriber = subscriber()
	assert_false(EventCore.subscribe(EventCoreTestAEvent, EventCoreTestSubscriber.on_static))
	assert_eq(error_logs(), 1)
	assert_false(EventCore.subscribe(EventCoreTestBEvent, bound_target.on_b.bind(1)))
	assert_eq(error_logs(), 1)
	publish_a(1)
	publish_b(1)
	assert_eq(EventCoreTestSubscriber.static_calls, 0)
	assert_eq(bound_target.b_count, 0)
	assert_eq(EventCore.count_subscriptions(bound_target), 0)


func test_subscriber_destroyed_without_unsubscribing_is_removed_at_the_next_publish_of_each_type() -> void:
	var destroyed: EventCoreTestSubscriber = EventCoreTestSubscriber.new()
	var witness: EventCoreTestSubscriber = subscriber()
	assert_true(EventCore.subscribe(EventCoreTestAEvent, destroyed.on_a))
	assert_true(EventCore.subscribe(EventCoreTestBEvent, destroyed.on_b))
	assert_true(EventCore.subscribe(EventCoreTestAEvent, witness.on_a))
	assert_true(EventCore.subscribe(EventCoreTestBEvent, witness.on_b))
	assert_eq(EventCore.count_subscriptions(destroyed), 2)
	var destroyed_id: int = destroyed.get_instance_id()
	destroyed.free()
	# A callback of the freed subscriber would end in a script error, which fails the run.
	publish_a(3)
	assert_eq(witness.a_values, PackedInt64Array([3]))
	# `count_subscriptions` takes the subscriber object, which Godot no longer passes once freed: count by its ID.
	# Only the subscription to A is gone: the one to B stays until B is published.
	assert_eq(EventCore._count_subscriptions_of(destroyed_id), 1)
	assert_eq(error_logs(), 1)
	publish_b(4)
	assert_eq(witness.b_count, 1)
	assert_eq(EventCore._count_subscriptions_of(destroyed_id), 0)
	assert_eq(error_logs(), 1)
	publish_a(5)
	publish_b(6)
	assert_eq(witness.a_values, PackedInt64Array([3, 5]))
	assert_eq(witness.b_count, 2)
	assert_eq(error_logs(), 0)


func test_two_subscribers_that_destroy_each_other_call_only_the_first_and_log_the_other_once() -> void:
	var x: EventCoreTestSubscriber = subscriber()
	var y: EventCoreTestSubscriber = subscriber()
	var x_id: int = x.get_instance_id()
	var y_id: int = y.get_instance_id()
	assert_true(EventCore.subscribe(EventCoreTestAEvent, x.on_a))
	assert_true(EventCore.subscribe(EventCoreTestAEvent, y.on_a))
	# The call order is not defined: whichever is called first destroys the other, which the delivery then reaches.
	var destroy_other: Callable = func(s: EventCoreTestSubscriber, _e: EventCoreTestAEvent) -> void:
		var other: Object = instance_from_id(y_id if s.get_instance_id() == x_id else x_id)
		if other != null:
			other.free()
	x.on_a_action = destroy_other
	y.on_a_action = destroy_other
	publish_a(1)
	assert_ne(is_instance_valid(x), is_instance_valid(y), "exactly one subscriber is left")
	var survivor: EventCoreTestSubscriber = x if is_instance_valid(x) else y
	var destroyed_id: int = y_id if survivor.get_instance_id() == x_id else x_id
	assert_eq(survivor.a_values, PackedInt64Array([1]))
	publish_a(2)
	assert_eq(survivor.a_values, PackedInt64Array([1, 2]))
	assert_eq(EventCore._count_subscriptions_of(destroyed_id), 0)
	assert_eq(EventCore.count_subscriptions(survivor), 1)
	assert_eq(error_logs(), 1, "one error log for the destroyed subscription across both publishes")


func test_unsubscribe_all_removes_every_type_of_the_subscriber_only() -> void:
	var target: EventCoreTestSubscriber = subscriber()
	var child: EventCoreTestSubscriber = EventCoreTestSubscriber.new()
	target.add_child(child)
	var other: EventCoreTestSubscriber = subscriber()
	assert_true(EventCore.subscribe(EventCoreTestAEvent, target.on_a))
	assert_true(EventCore.subscribe(EventCoreTestBEvent, target.on_b))
	assert_true(EventCore.subscribe(EventCoreTestAEvent, child.on_a))
	assert_true(EventCore.subscribe(EventCoreTestAEvent, other.on_a))
	assert_eq(EventCore.unsubscribe_all(target), 2)
	assert_eq(EventCore.count_subscriptions(target), 0)
	assert_eq(EventCore.count_subscriptions(child), 1)
	assert_eq(EventCore.count_subscriptions(other), 1)
	publish_a(7)
	publish_b(7)
	assert_eq(target.a_values.size(), 0)
	assert_eq(target.b_count, 0)
	assert_eq(child.a_values, PackedInt64Array([7]))
	assert_eq(other.a_values, PackedInt64Array([7]))
	assert_eq(EventCore.unsubscribe_all(target), 0)


func test_unsubscribe_all_and_count_among_many_subscribers_and_types_touch_only_the_subscriber() -> void:
	var subscribers: Array[EventCoreTestSubscriber] = []
	for i: int in 30:
		subscribers.append(subscriber())
	# Type by type, so the slots of one subscriber sit apart in each type and its list runs across all three.
	for target: EventCoreTestSubscriber in subscribers:
		assert_true(EventCore.subscribe(EventCoreTestAEvent, target.on_a))
	for target: EventCoreTestSubscriber in subscribers:
		assert_true(EventCore.subscribe(EventCoreTestBEvent, target.on_b))
	for target: EventCoreTestSubscriber in subscribers:
		assert_true(EventCore.subscribe(EventCoreTestDebugEvent, target.on_debug))
	# The last subscription of a subscriber, the first, and one in the middle of its list.
	EventCore.unsubscribe(EventCoreTestDebugEvent, subscribers[4].on_debug)
	EventCore.unsubscribe(EventCoreTestAEvent, subscribers[5].on_a)
	EventCore.unsubscribe(EventCoreTestBEvent, subscribers[6].on_b)
	var removed: EventCoreTestSubscriber = subscribers[10]
	assert_eq(EventCore.unsubscribe_all(removed), 3)
	assert_eq(EventCore.count_subscriptions(removed), 0)
	assert_eq(EventCore.unsubscribe_all(removed), 0)
	for i: int in subscribers.size():
		var expected: int = 3
		if i == 10:
			expected = 0
		elif i == 4 or i == 5 or i == 6:
			expected = 2
		assert_eq(EventCore.count_subscriptions(subscribers[i]), expected, "subscriber %d" % i)
	publish_a(1)
	publish_b(1)
	for i: int in subscribers.size():
		var gets_a: bool = i != 10 and i != 5
		var gets_b: bool = i != 10 and i != 6
		assert_eq(subscribers[i].a_values.size(), 1 if gets_a else 0, "subscriber %d" % i)
		assert_eq(subscribers[i].b_count, 1 if gets_b else 0, "subscriber %d" % i)
	for i: int in [4, 5, 6]:
		assert_eq(EventCore.unsubscribe_all(subscribers[i]), 2, "subscriber %d" % i)
	# A removed subscriber subscribes again into a cleared slot.
	var slots: int = EventCore._count_slots(EventCoreTestAEvent)
	assert_true(EventCore.subscribe(EventCoreTestAEvent, removed.on_a))
	assert_eq(EventCore._count_slots(EventCoreTestAEvent), slots)
	assert_eq(EventCore.count_subscriptions(removed), 1)
	publish_a(2)
	assert_eq(removed.a_values, PackedInt64Array([2]))
	assert_eq(subscribers[0].a_values, PackedInt64Array([1, 2]))
	assert_eq(EventCore.count_subscriptions(subscribers[0]), 3)


func test_the_subscriber_index_does_not_grow_with_subscribers_that_left() -> void:
	var kept: EventCoreTestSubscriber = subscriber()
	assert_true(EventCore.subscribe(EventCoreTestAEvent, kept.on_a))
	for i: int in 200:
		var passing: EventCoreTestSubscriber = subscriber()
		assert_true(EventCore.subscribe(EventCoreTestAEvent, passing.on_a))
		assert_true(EventCore.subscribe(EventCoreTestBEvent, passing.on_b))
		assert_eq(EventCore.unsubscribe_all(passing), 2)
	# `kept` is the one subscriber with a subscription.
	assert_lte(EventCore._heads.size(), 2 * 1 + 1)
	assert_eq(EventCore.count_subscriptions(kept), 1)
	publish_a(3)
	assert_eq(kept.a_values, PackedInt64Array([3]))


func test_unsubscribe_of_a_missing_subscription_does_nothing() -> void:
	var target: EventCoreTestSubscriber = subscriber()
	assert_true(EventCore.subscribe(EventCoreTestAEvent, target.on_a))
	EventCore.unsubscribe(EventCoreTestBEvent, target.on_b)
	EventCore.unsubscribe(EventCoreTestAEvent, target.on_debug)
	assert_eq(EventCore.count_subscriptions(target), 1)
	publish_a(2)
	assert_eq(target.a_values, PackedInt64Array([2]))


func test_type_not_extending_event_base_is_refused_once_per_call() -> void:
	var target: EventCoreTestSubscriber = subscriber()
	assert_true(EventCore.subscribe(EventCoreTestAEvent, target.on_a))
	assert_false(EventCore.subscribe(EventCoreTestNotEvent, target.on_b))
	assert_eq(error_logs(), 1)
	assert_eq(EventCore.count_subscriptions(target), 1)
	EventCore.unsubscribe(EventCoreTestNotEvent, target.on_a)
	assert_eq(error_logs(), 1)
	assert_eq(EventCore.count_subscriptions(target), 1)
	assert_null(EventCore.acquire(EventCoreTestNotEvent))
	assert_eq(error_logs(), 1)
	assert_false(EventCore.subscribe(EventBase, target.on_b))
	assert_eq(error_logs(), 1)
	publish_a(1)
	assert_eq(target.a_values, PackedInt64Array([1]))


func test_type_based_on_another_event_type_is_refused_once_per_call() -> void:
	var target: EventCoreTestSubscriber = subscriber()
	assert_true(EventCore.subscribe(EventCoreTestAEvent, target.on_a))
	assert_false(EventCore.subscribe(EventCoreTestDerivedEvent, target.on_a))
	assert_eq(error_logs(), 1)
	assert_eq(EventCore.count_subscriptions(target), 1)
	EventCore.unsubscribe(EventCoreTestDerivedEvent, target.on_a)
	assert_eq(error_logs(), 1)
	assert_eq(EventCore.count_subscriptions(target), 1)
	assert_null(EventCore.acquire(EventCoreTestDerivedEvent))
	assert_eq(error_logs(), 1)
	publish_a(1)
	assert_eq(target.a_values, PackedInt64Array([1]))
	assert_eq(error_logs(), 0)


func test_publish_of_an_object_acquire_did_not_return_is_not_delivered() -> void:
	var target: EventCoreTestSubscriber = subscriber()
	assert_true(EventCore.subscribe(EventCoreTestAEvent, target.on_a))
	var made: EventCoreTestAEvent = EventCoreTestAEvent.new()
	made.value = 9
	EventCore.publish(made)
	assert_eq(error_logs(), 1)
	assert_not_null(EventCore.acquire(EventCoreTestAEvent))
	EventCore.publish(made)
	assert_eq(error_logs(), 1)
	assert_eq(target.a_values.size(), 0)


func test_init_after_release_has_no_previous_subscriptions() -> void:
	var target: EventCoreTestSubscriber = subscriber()
	assert_true(EventCore.subscribe(EventCoreTestAEvent, target.on_a))
	assert_true(EventCore.subscribe(EventCoreTestBEvent, target.on_b))
	EventCore.release()
	assert_true(EventCore.init())
	assert_eq(EventCore.count_subscriptions(target), 0)
	publish_a(1)
	publish_b(1)
	assert_eq(target.a_values.size(), 0)
	assert_eq(target.b_count, 0)
