extends "res://core/remote_config_core/tests/support/remote_config_test_case.gd"
## Value selection, getter failures and experiment groups.


func test_getters_are_default_before_login_and_login_values_after() -> void:
	await start()
	assert_false(RemoteConfigCore.get_bool(flag))
	assert_eq(RemoteConfigCore.get_int(count), 10)
	assert_eq(RemoteConfigCore.get_string(title), "hello")
	assert_false(RemoteConfigCore.has_received())
	var latch: UnitTestLatch = UnitTestCore.latch_event(LoginCompletedEvent)
	await login(config([bool_entry(flag, true), int_entry(count, 42), string_entry(title, "remote")]))
	assert_true(await UnitTestCore.wait_latch(latch), "LoginCompletedEvent came")
	assert_true(RemoteConfigCore.get_bool(flag))
	assert_eq(RemoteConfigCore.get_int(count), 42)
	assert_eq(RemoteConfigCore.get_string(title), "remote")
	assert_true(RemoteConfigCore.has_received())


func test_int_value_keeps_int64() -> void:
	await start()
	await login(config([int_entry(count, 9007199254740993)]))
	assert_eq(RemoteConfigCore.get_int(count), 9007199254740993)


func test_key_without_entry_is_default_and_dropped_key_returns_to_default() -> void:
	await start()
	await login(config([int_entry(count, 42)]))
	assert_eq(RemoteConfigCore.get_int(count), 42)
	assert_false(RemoteConfigCore.get_bool(flag), "no entry: default_value")
	assert_eq(RemoteConfigCore.get_string(title), "hello", "no entry: default_value")
	add_get(config([bool_entry(flag, true)]))
	assert_true(await RemoteConfigCore.refresh())
	assert_true(RemoteConfigCore.get_bool(flag))
	assert_eq(RemoteConfigCore.get_int(count), 10, "left out of the new list: default_value again")


func test_getter_of_another_type_returns_unknown_key_value_and_logs_once_per_key() -> void:
	await start()
	await login(config([bool_entry(flag, true), int_entry(count, 42), string_entry(title, "remote")]))
	for i: int in 2:
		assert_eq(RemoteConfigCore.get_int(flag), 0)
		assert_eq(RemoteConfigCore.get_string(count), "")
		assert_false(RemoteConfigCore.get_bool(title))
	assert_eq(error_logs(), 3, "one error per key")
	assert_true(RemoteConfigCore.get_bool(flag), "the getter of the key type still reads the value")
	assert_eq(RemoteConfigCore.get_int(count), 42)
	assert_eq(RemoteConfigCore.get_string(title), "remote")


func test_unknown_key_returns_unknown_key_value_and_logs_once_per_key() -> void:
	await start()
	await login(config([]))
	for i: int in 2:
		assert_false(RemoteConfigCore.get_bool(threshold), "client false key")
		assert_eq(RemoteConfigCore.get_int(NO_KEY), 0)
		assert_eq(RemoteConfigCore.get_string(0), "")
	assert_eq(error_logs(), 3, "one error per key")


func test_unknown_key_logs_again_after_release() -> void:
	await start()
	assert_eq(RemoteConfigCore.get_int(NO_KEY), 0)
	assert_eq(error_logs(), 1)
	RemoteConfigCore.release()
	assert_true(RemoteConfigCore.init())
	assert_eq(RemoteConfigCore.get_int(NO_KEY), 0)
	assert_eq(error_logs(), 1, "the once-per-key log starts over after release")


func test_get_group_returns_assigned_group() -> void:
	await start()
	assert_eq(RemoteConfigCore.get_group(exp_a), "", "before login")
	await login(config([], [assignment(exp_a, "treatment")]))
	assert_eq(RemoteConfigCore.get_group(exp_a), "treatment")
	assert_eq(RemoteConfigCore.get_group(exp_b), "", "no assignment")
	add_get(config([], [assignment(exp_b, "control")]))
	assert_true(await RemoteConfigCore.refresh())
	assert_eq(RemoteConfigCore.get_group(exp_a), "", "left out of the new list")
	assert_eq(RemoteConfigCore.get_group(exp_b), "control")


func test_getters_do_not_allocate() -> void:
	await start()
	await login(config([bool_entry(flag, true), string_entry(title, "remote")]))
	# The ballast raises static memory to its peak, so any allocation in the loop raises the peak, even one freed before
	# the loop ends. It is made before the first read: the array object stays until the test ends.
	var ballast: PackedByteArray = PackedByteArray()
	LogCore.release()
	_read_values(100)
	var objects: float = Performance.get_monitor(Performance.OBJECT_COUNT)
	var memory: float = Performance.get_monitor(Performance.MEMORY_STATIC)
	ballast.resize(int(Performance.get_monitor(Performance.MEMORY_STATIC_MAX) - memory) + 1)
	var peak: float = Performance.get_monitor(Performance.MEMORY_STATIC_MAX)
	_read_values(1000)
	# All are read before the first assert, which allocates.
	var peak_after: float = Performance.get_monitor(Performance.MEMORY_STATIC_MAX)
	ballast.clear()
	var objects_after: float = Performance.get_monitor(Performance.OBJECT_COUNT)
	var memory_after: float = Performance.get_monitor(Performance.MEMORY_STATIC)
	assert_true(memory > 0.0, "static memory is measured")
	assert_true(objects_after <= objects, "object count")
	assert_true(memory_after <= memory, "static memory")
	assert_true(peak_after <= peak, "static memory peak: no allocation freed inside the loop")


## Reads received values and default values `times` times.
func _read_values(times: int) -> int:
	var sink: int = 0
	for i: int in times:
		if RemoteConfigCore.get_bool(flag):
			sink += 1
		sink += RemoteConfigCore.get_int(count)
		sink += RemoteConfigCore.get_string(title).length()
	return sink
