extends "res://core/remote_config_core/tests/support/remote_config_test_case.gd"
## Applying received lists: dropped entries and `RemoteConfigChangedEvent`.


func test_invalid_entries_are_dropped_and_the_others_applied() -> void:
	await start()
	var entries: Array[CoreContract.RemoteConfigEntry] = [
		bool_entry(NO_KEY, true),
		bool_entry(threshold, false),
		int_entry(flag, 1),
		int_entry(count, 42),
		int_entry(count, 7),
		string_entry(title, "remote"),
	]
	await login(config(entries))
	assert_false(RemoteConfigCore.get_bool(flag), "kind INT for a Bool key: dropped")
	assert_eq(RemoteConfigCore.get_int(count), 42, "the first entry of a key that came twice")
	assert_eq(RemoteConfigCore.get_string(title), "remote")
	assert_eq(warn_logs(), 2, "one warn per key not in remote_config_key")
	assert_eq(error_logs(), 2, "kind mismatch and duplicate")
	add_get(config(entries))
	assert_true(await RemoteConfigCore.refresh())
	assert_eq(warn_logs(), 0, "the unknown key warn is once per key until release")
	assert_eq(error_logs(), 2, "kind mismatch and duplicate log on every apply")
	assert_eq(RemoteConfigCore.get_int(count), 42)


func test_unknown_key_warn_comes_again_after_release_and_init() -> void:
	await start()
	var entries: Array[CoreContract.RemoteConfigEntry] = [bool_entry(NO_KEY, true)]
	await login(config(entries))
	assert_eq(warn_logs(), 1)
	add_get(config(entries))
	assert_true(await RemoteConfigCore.refresh())
	assert_eq(warn_logs(), 0, "once per key until release")
	RemoteConfigCore.release()
	assert_true(RemoteConfigCore.init())
	add_get(config(entries))
	assert_true(await RemoteConfigCore.refresh())
	assert_eq(warn_logs(), 1, "the warn comes again after release and init")
	assert_eq(error_logs(), 0)


func test_entry_without_value_is_dropped() -> void:
	await start()
	var empty: CoreContract.RemoteConfigEntry = CoreContract.RemoteConfigEntry.new()
	empty.key_id = flag
	var unspecified: CoreContract.RemoteConfigEntry = entry(
		count, CoreContract.RemoteConfigValueKind.REMOTE_CONFIG_VALUE_KIND_UNSPECIFIED
	)
	await login(config([empty, unspecified, string_entry(title, "remote")]))
	assert_false(RemoteConfigCore.get_bool(flag))
	assert_eq(RemoteConfigCore.get_int(count), 10)
	assert_eq(RemoteConfigCore.get_string(title), "remote")
	assert_eq(error_logs(), 2)


func test_changed_event_only_for_an_apply_that_changes() -> void:
	await start()
	await login(config([int_entry(count, 10)]))
	assert_eq(changed_events, 0, "the value equals default_value")
	assert_true(RemoteConfigCore.has_received())
	add_get(config([bool_entry(flag, true)]))
	assert_true(await RemoteConfigCore.refresh())
	assert_eq(changed_events, 1, "flag changed")
	add_get(config([bool_entry(flag, true)]))
	assert_true(await RemoteConfigCore.refresh())
	assert_eq(changed_events, 1, "the same list again")
	add_get(config([bool_entry(flag, true)], [assignment(exp_a, "treatment")]))
	assert_true(await RemoteConfigCore.refresh())
	assert_eq(changed_events, 2, "only the assignment changed")
	add_get(config([bool_entry(flag, true), string_entry(title, "hello")], [assignment(exp_a, "treatment")]))
	assert_true(await RemoteConfigCore.refresh())
	assert_eq(changed_events, 2, "a new entry equal to default_value")
	add_get(config([]))
	assert_true(await RemoteConfigCore.refresh())
	assert_eq(changed_events, 3, "flag and the assignment back to none")


func test_changed_event_for_a_login_value() -> void:
	await start()
	await login(config([string_entry(title, "remote")]))
	assert_eq(changed_events, 1)
