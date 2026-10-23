extends EventCoreTestCase
## DEV `register_init_listener`: listeners run once each, in order, right before `init` ends; `release` clears them.


func test_listeners_run_once_each_in_order_right_before_init_ends_and_can_subscribe() -> void:
	EventCore.release()
	var listener: EventCoreTestInitListener = init_listener()
	var target: EventCoreTestSubscriber = subscriber()
	listener.target = target
	EventCoreDev.register_init_listener(listener.on_first)
	EventCoreDev.register_init_listener(listener.on_second)
	assert_eq(listener.calls.size(), 0)
	assert_true(EventCore.init())
	assert_eq(listener.calls, PackedStringArray(["first", "second"]))
	assert_eq(listener.initialized, [true, true])
	assert_true(listener.subscribed)
	publish_a(5)
	assert_eq(target.a_values, PackedInt64Array([5]))
	assert_eq(error_logs(), 0)


func test_a_registration_after_init_is_refused_with_an_error_log() -> void:
	var listener: EventCoreTestInitListener = init_listener()
	var before: int = listeners_not_of_unit_test_core()
	EventCoreDev.register_init_listener(listener.on_first)
	assert_eq(error_logs(), 1)
	assert_eq(listeners_not_of_unit_test_core(), before)
	EventCore.release()
	assert_true(EventCore.init())
	assert_eq(listener.calls.size(), 0)


func test_a_listener_registered_after_release_is_called_by_the_next_init() -> void:
	var listener: EventCoreTestInitListener = init_listener()
	EventCore.release()
	EventCoreDev.register_init_listener(listener.on_first)
	assert_true(EventCore.init())
	assert_eq(listener.calls, PackedStringArray(["first"]))
	assert_eq(error_logs(), 0)


func test_release_clears_the_listeners() -> void:
	var listener: EventCoreTestInitListener = init_listener()
	# Registered before init: called by that init only, not by the init after a release.
	EventCore.release()
	EventCoreDev.register_init_listener(listener.on_second)
	assert_true(EventCore.init())
	EventCore.release()
	assert_true(EventCore.init())
	assert_eq(listener.calls, PackedStringArray(["second"]))
	# A release outside init clears them too.
	EventCore.release()
	EventCoreDev.register_init_listener(listener.on_first)
	EventCore.release()
	assert_true(EventCore.init())
	assert_eq(listener.calls, PackedStringArray(["second"]))
	assert_true(EventCore._init_listeners.is_empty())


func test_tree_teardown_without_release_clears_the_listeners() -> void:
	EventCore.release()
	var listener: EventCoreTestInitListener = init_listener()
	EventCoreDev.register_init_listener(listener.on_first)
	assert_true(EventCore.init())
	assert_eq(listener.calls, PackedStringArray(["first"]))
	EventCore._node.free()
	assert_false(EventCore.is_initialized())
	assert_true(EventCore.init())
	assert_eq(listener.calls, PackedStringArray(["first"]))


## A registration from a listener during `init` is a registration after `init`: refused with an error log, so neither
## that `init` nor a later one calls it.
func test_a_registration_from_a_listener_during_init_is_refused_with_an_error_log() -> void:
	EventCore.release()
	var listener: EventCoreTestInitListener = init_listener()
	EventCoreDev.register_init_listener(listener.on_register_second)
	var before: int = listeners_not_of_unit_test_core()
	assert_true(EventCore.init())
	assert_eq(listener.calls, PackedStringArray(["register_second"]))
	assert_eq(error_logs(), 1)
	assert_eq(listeners_not_of_unit_test_core(), before)


func test_a_listener_that_releases_stops_the_rest() -> void:
	EventCore.release()
	var listener: EventCoreTestInitListener = init_listener()
	EventCoreDev.register_init_listener(listener.on_release)
	EventCoreDev.register_init_listener(listener.on_second)
	assert_false(EventCore.init())
	assert_false(EventCore.is_initialized())
	assert_eq(listener.calls, PackedStringArray(["release"]))


func test_a_listener_of_a_freed_object_is_skipped() -> void:
	EventCore.release()
	var freed: EventCoreTestInitListener = EventCoreTestInitListener.new()
	EventCoreDev.register_init_listener(freed.on_first)
	freed.free()
	var listener: EventCoreTestInitListener = init_listener()
	EventCoreDev.register_init_listener(listener.on_second)
	assert_true(EventCore.init())
	assert_eq(listener.calls, PackedStringArray(["second"]))


func test_an_invalid_listener_is_not_registered() -> void:
	EventCore.release()
	var before: int = EventCore._init_listeners.size()
	EventCoreDev.register_init_listener(Callable())
	assert_eq(error_logs(), 1)
	assert_eq(EventCore._init_listeners.size(), before)
	assert_eq(listeners_not_of_unit_test_core(), 0)


func test_a_listener_of_an_object_freed_before_registration_is_not_registered() -> void:
	EventCore.release()
	var freed: EventCoreTestInitListener = EventCoreTestInitListener.new()
	var method: Callable = freed.on_first
	freed.free()
	var before: int = listeners_not_of_unit_test_core()
	EventCoreDev.register_init_listener(method)
	assert_eq(error_logs(), 1)
	assert_eq(listeners_not_of_unit_test_core(), before)
	var listener: EventCoreTestInitListener = init_listener()
	EventCoreDev.register_init_listener(listener.on_second)
	assert_true(EventCore.init())
	# Only the live listener is in the list `init` walks, and it ran.
	assert_eq(listeners_not_of_unit_test_core(), before + 1)
	assert_eq(listener.calls, PackedStringArray(["second"]))
	assert_eq(error_logs(), 0)


func test_a_lambda_or_a_bound_listener_is_refused_and_a_static_function_or_a_method_reference_is_kept() -> void:
	EventCore.release()
	var listener: EventCoreTestInitListener = init_listener()
	var before: int = listeners_not_of_unit_test_core()
	EventCoreDev.register_init_listener(func() -> void: listener.calls.append("lambda"))
	assert_eq(error_logs(), 1, "a lambda is refused with an error log")
	EventCoreDev.register_init_listener(listener.on_named.bind("bound"))
	assert_eq(error_logs(), 1, "a bind() is refused with an error log")
	assert_eq(listeners_not_of_unit_test_core(), before)
	EventCoreTestInitListener.static_calls = 0
	EventCoreDev.register_init_listener(EventCoreTestInitListener.on_static)
	EventCoreDev.register_init_listener(listener.on_second)
	assert_eq(error_logs(), 0)
	assert_eq(listeners_not_of_unit_test_core(), before + 2)
	assert_true(EventCore.init())
	assert_eq(EventCoreTestInitListener.static_calls, 1)
	assert_eq(listener.calls, PackedStringArray(["second"]))
	EventCoreTestInitListener.static_calls = 0
