extends "res://core/tutorial_core/tests/support/tutorial_test_case.gd"
## Time-dependent conditions of `complete_requirement` and `start_requirement`.

const PASS_AFTER_MS: int = 10000


func test_a_time_dependent_requirement_step_ends_after_the_pass_time_and_the_recheck() -> void:
	assert_true(await start())
	_sync()
	Hooks.flag_b_at = TimeCore.get_server_time() + PASS_AFTER_MS
	respond_saved(id_of("[tutorial_time_step]"), 1)
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_time_step]"])))
	await advance(PASS_AFTER_MS - 1)
	assert_eq(events, PackedStringArray(["started:[tutorial_time_step]:1"]))
	await advance(1)
	await advance(TIME_RECHECK_MS)
	assert_eq(events, PackedStringArray(["started:[tutorial_time_step]:1", "completed:[tutorial_time_step]:false"]))


func test_a_time_dependent_start_requirement_starts_its_tutorial_without_other_start_checks() -> void:
	assert_true(await start())
	_sync()
	Hooks.flag_b_at = TimeCore.get_server_time() + PASS_AFTER_MS
	allow(PackedStringArray(["[tutorial_time_start]"]))
	assert_false(TutorialCore.check_start())
	await advance(PASS_AFTER_MS - 1)
	assert_eq(events, PackedStringArray())
	await advance(1)
	await advance(TIME_RECHECK_MS)
	assert_eq(events, PackedStringArray(["started:[tutorial_time_start]:1"]))


## Syncs the server time to `SERVER_TIME` unless a response did.
func _sync() -> void:
	if not TimeCore.is_synced():
		var now: int = TimeCore.get_monotonic_time()
		TimeCore.sync_server_time(SERVER_TIME, now, now)
	assert_true(TimeCore.is_synced())
