extends "res://core/badge_core/tests/support/badge_test_case.gd"
## Evaluators: calls merged at the frame end, `refresh`, the refresh interval and evaluator failures.


func test_evaluator_runs_after_register_and_sets_own_count() -> void:
	assert_true(await start_modules())
	Hooks.counts[a_badge] = 3
	assert_true(BadgeCore.register_evaluator(a_badge, Hooks.evaluate))
	assert_eq(Hooks.calls_of(a_badge), 0, "called at the frame end")
	await frame_end()
	assert_eq(Hooks.calls_of(a_badge), 1)
	assert_eq(BadgeCore.get_count(a_badge), 3)
	assert_eq(BadgeCore.get_count(root_badge), 3)


func test_many_user_state_changes_in_a_frame_call_each_evaluator_once() -> void:
	assert_true(await start_modules())
	assert_true(BadgeCore.register_evaluator(a_badge, Hooks.evaluate))
	assert_true(BadgeCore.register_evaluator(b_badge, Hooks.evaluate))
	await frame_end()
	Hooks.reset()
	Hooks.counts[a_badge] = 1
	var potion: int = id_of("[potion]")
	put_balance(potion, 1)
	put_balance(potion, 2)
	put_balance(potion, 3)
	await frame_end()
	assert_eq(Hooks.calls_of(a_badge), 1)
	assert_eq(Hooks.calls_of(b_badge), 1)
	assert_eq(BadgeCore.get_count(a_badge), 1)


func test_refresh_calls_the_given_badge_or_every_badge() -> void:
	assert_true(await start_modules())
	assert_true(BadgeCore.register_evaluator(a_badge, Hooks.evaluate))
	assert_true(BadgeCore.register_evaluator(b_badge, Hooks.evaluate))
	await frame_end()
	Hooks.reset()
	BadgeCore.refresh(a_badge)
	await frame_end()
	assert_eq(Hooks.calls_of(a_badge), 1)
	assert_eq(Hooks.calls_of(b_badge), 0)
	Hooks.reset()
	BadgeCore.refresh()
	BadgeCore.refresh(a_badge)
	await frame_end()
	assert_eq(Hooks.calls_of(a_badge), 1)
	assert_eq(Hooks.calls_of(b_badge), 1)


func test_refresh_interval_calls_every_evaluator() -> void:
	set_int("BadgeCore.refreshIntervalMs", 1000)
	assert_true(await start_modules())
	assert_true(BadgeCore.register_evaluator(a_badge, Hooks.evaluate))
	await frame_end()
	Hooks.reset()
	await advance(999)
	assert_eq(Hooks.calls_of(a_badge), 0)
	await advance(1)
	assert_eq(Hooks.calls_of(a_badge), 1)
	await advance(1000)
	assert_eq(Hooks.calls_of(a_badge), 2)


func test_refresh_interval_zero_never_calls() -> void:
	assert_true(await start_modules())
	assert_true(BadgeCore.register_evaluator(a_badge, Hooks.evaluate))
	await frame_end()
	Hooks.reset()
	await advance(100000000)
	assert_eq(Hooks.calls_of(a_badge), 0)


func test_failing_evaluator_keeps_own_count_and_other_badges_go_on() -> void:
	assert_true(await start_modules())
	assert_true(BadgeCore.set_count(a_badge, 2))
	await frame_end()
	Hooks.counts[b_badge] = 4
	assert_true(BadgeCore.register_evaluator(a_badge, Hooks.evaluate_failing))
	assert_true(BadgeCore.register_evaluator(b_badge, Hooks.evaluate))
	await frame_end()
	assert_eq(UnitTestCore.check_script_errors(), 1, "the evaluator stopped on a runtime error")
	assert_eq(Hooks.calls_of(a_badge), 1)
	assert_eq(Hooks.failing_finished, 0, "the evaluator never went past its runtime error")
	assert_eq(errors(), 1)
	assert_eq(BadgeCore.get_count(a_badge), 2, "own count of A stays")
	assert_eq(BadgeCore.get_count(b_badge), 4)
	assert_eq(BadgeCore.get_count(root_badge), 6)
	BadgeCore.refresh(a_badge)
	await frame_end()
	assert_eq(UnitTestCore.check_script_errors(), 1, "the next evaluation calls the evaluator again")
	assert_eq(Hooks.calls_of(a_badge), 2)
	assert_eq(errors(), 1)
	assert_eq(BadgeCore.get_count(a_badge), 2)


func test_negative_evaluator_output_keeps_own_count() -> void:
	assert_true(await start_modules())
	assert_true(BadgeCore.set_count(a_badge, 2))
	assert_true(BadgeCore.register_evaluator(a_badge, Hooks.evaluate_negative))
	await frame_end()
	assert_eq(errors(), 1)
	assert_eq(BadgeCore.get_count(a_badge), 2)


func test_evaluator_must_be_a_static_func() -> void:
	assert_true(await start_modules())
	assert_false(BadgeCore.register_evaluator(a_badge, _instance_evaluator))
	assert_false(BadgeCore.register_evaluator(a_badge, func(_id: int) -> BadgeEvaluatorResult: return null))
	assert_false(BadgeCore.register_evaluator(a_badge, Hooks.evaluate.bind(1)))
	assert_eq(errors(), 3)
	assert_true(BadgeCore.set_count(a_badge, 1), "no evaluator was registered")


func test_no_evaluator_call_after_release_and_register_works_after_init_again() -> void:
	assert_true(await start_modules())
	assert_true(BadgeCore.register_evaluator(a_badge, Hooks.evaluate))
	BadgeCore.refresh()
	BadgeCore.release()
	var potion: int = id_of("[potion]")
	put_balance(potion, 1)
	await frame_end()
	assert_eq(Hooks.calls_of(a_badge), 0)
	assert_true(BadgeCore.init())
	assert_true(BadgeCore.register_evaluator(a_badge, Hooks.evaluate))
	await frame_end()
	assert_eq(Hooks.calls_of(a_badge), 1)


func _instance_evaluator(_badge_id: int) -> BadgeEvaluatorResult:
	return BadgeEvaluatorResult.new()
