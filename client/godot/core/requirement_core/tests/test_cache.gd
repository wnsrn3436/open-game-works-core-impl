extends "res://core/requirement_core/tests/support/requirement_test_case.gd"
## Cache: a judged condition is not judged again until a kind it sees changes, a time-dependent condition is judged on
## every `evaluate`, `register_judge` drops the cache of the conditions of its type, and a failed judge hook leaves no
## cache.


func test_a_second_evaluate_without_a_delta_does_not_call_the_judge_hook() -> void:
	await start()
	register_flags()
	answer(true)
	RequirementCore.evaluate(id_of(SINGLE))
	RequirementCore.evaluate(id_of(SINGLE))
	assert_eq(Hooks.count(FLAG_A), 1)


func test_a_delta_of_a_seen_kind_judges_the_condition_and_its_upper_conditions_again() -> void:
	await start()
	register_flags()
	answer(true, false, true)
	var nested: int = id_of(NESTED_1)
	assert_true(RequirementCore.evaluate(nested).passed)
	assert_eq(PackedInt32Array([Hooks.count(FLAG_A), Hooks.count(FLAG_B), Hooks.count(FLAG_C)]), PackedInt32Array([1, 1, 1]))
	# FlagA reads TutorialProgressUserState: its condition and the top condition are judged again, the inner Any is a
	# cache.
	put_tutorial()
	assert_true(RequirementCore.evaluate(nested).passed)
	assert_eq(PackedInt32Array([Hooks.count(FLAG_A), Hooks.count(FLAG_B), Hooks.count(FLAG_C)]), PackedInt32Array([2, 1, 1]))
	# FlagB reads ItemBalanceUserState: FlagB, the inner Any and the top condition are judged again; FlagC sees no kind.
	put_balance(id_of("[gold]"), 10)
	assert_true(RequirementCore.evaluate(nested).passed)
	assert_eq(PackedInt32Array([Hooks.count(FLAG_A), Hooks.count(FLAG_B), Hooks.count(FLAG_C)]), PackedInt32Array([2, 2, 1]))
	put_balance(id_of("[gold]"), 20)
	assert_true(RequirementCore.evaluate(id_of(NESTED_3)).passed, "the inner Any alone")
	assert_eq(Hooks.count(FLAG_B), 3)


func test_a_delta_of_a_kind_the_condition_does_not_see_keeps_the_cache() -> void:
	await start()
	register_flags()
	answer(true, false, true)
	var nested: int = id_of(NESTED_1)
	RequirementCore.evaluate(nested)
	put_shop(id_of("[shop_basic]"), 1, 0)
	RequirementCore.evaluate(nested)
	RequirementCore.evaluate(id_of(NESTED_3))
	assert_eq(PackedInt32Array([Hooks.count(FLAG_A), Hooks.count(FLAG_B), Hooks.count(FLAG_C)]), PackedInt32Array([1, 1, 1]))


func test_a_time_dependent_sub_condition_is_judged_on_every_evaluate_and_the_others_keep_their_cache() -> void:
	await start()
	register_flags(true)
	answer(true, false, true)
	var nested: int = id_of(NESTED_1)
	assert_true(RequirementCore.evaluate(nested).passed)
	assert_true(RequirementCore.evaluate(nested).passed)
	assert_eq(Hooks.count(FLAG_C), 2, "FlagC is a time-dependent type")
	assert_eq(Hooks.count(FLAG_A), 1, "FlagA is not")
	assert_eq(Hooks.count(FLAG_B), 1, "FlagB is not")


func test_register_judge_after_judging_a_type_without_a_hook_makes_the_next_evaluate_call_the_hook() -> void:
	await start()
	var a_kinds: Array[GDScript] = [CoreContract.TutorialProgressUserState]
	var b_kinds: Array[GDScript] = [CoreContract.ItemBalanceUserState]
	assert_true(RequirementCore.register_judge(FLAG_A, Hooks.flag, a_kinds, GUIDE_A))
	assert_true(RequirementCore.register_judge(FLAG_B, Hooks.flag, b_kinds, GUIDE_B))
	answer(true, false, true)
	var nested: int = id_of(NESTED_1)
	assert_result(RequirementCore.evaluate(nested), false, id_of(NESTED_4), GUIDE_B, "FlagC has no hook")
	assert_eq(errors(), 1, "the type without a hook")
	var no_kinds: Array[GDScript] = []
	assert_true(RequirementCore.register_judge(FLAG_C, Hooks.flag, no_kinds, GUIDE_C))
	assert_result(RequirementCore.evaluate(nested), true, 0, "", "FlagC is judged by its hook")
	assert_eq(Hooks.count(FLAG_C), 1)
	assert_eq(Hooks.count(FLAG_A), 1, "the FlagA condition has no FlagC: its cache stays")


func test_an_evaluate_while_a_delta_is_applied_judges_with_the_entries_applied_so_far() -> void:
	await start()
	var b_kinds: Array[GDScript] = [CoreContract.ItemBalanceUserState]
	assert_true(RequirementCore.register_judge(FLAG_A, Hooks.balances_at_least, b_kinds, GUIDE_A))
	var single: int = id_of(SINGLE)
	Hooks.balance_items = PackedInt32Array([id_of("[gold]"), id_of("[potion]")])
	Hooks.balance_least = 5
	assert_false(RequirementCore.evaluate(single).passed)
	assert_eq(Hooks.count(FLAG_A), 1)
	Hooks.update_requirement = single
	assert_true(UserStateCore.register_after_update(CoreContract.ItemBalanceUserState, Hooks.evaluate_after_update))
	put_balances(Hooks.balance_items, 5)
	assert_eq(Hooks.update_passed, [false, true] as Array[bool], "after gold alone, then after gold and potion")
	assert_eq(Hooks.count(FLAG_A), 3, "each after_update hook judges again")
	assert_true(RequirementCore.evaluate(single).passed)
	assert_eq(Hooks.count(FLAG_A), 3, "the result judged in the last after_update hook is the cache")
	assert_eq(errors(), 0)


func test_a_failed_judge_hook_gives_the_failure_value_and_the_next_evaluate_calls_it_again() -> void:
	await start()
	var no_kinds: Array[GDScript] = []
	assert_true(RequirementCore.register_judge(FLAG_A, Hooks.broken, no_kinds, GUIDE_A))
	var single: int = id_of(SINGLE)
	assert_result(RequirementCore.evaluate(single), false, single, "", "failure value")
	assert_eq(errors(), 1)
	assert_result(RequirementCore.evaluate(single), false, single, "", "failure value again")
	assert_eq(errors(), 1)
	assert_eq(Hooks.count(FLAG_A), 2, "no cache after a failed judge hook")


func test_a_throwing_judge_hook_gives_the_failure_value_one_error_log_and_the_next_evaluate_calls_it_again() -> void:
	await start()
	var no_kinds: Array[GDScript] = []
	assert_true(RequirementCore.register_judge(FLAG_A, Hooks.throwing, no_kinds, GUIDE_A))
	var single: int = id_of(SINGLE)
	assert_result(RequirementCore.evaluate(single), false, single, "", "failure value")
	assert_eq(UnitTestCore.check_script_errors(), 1, "the judge hook threw")
	assert_eq(errors(), 1)
	assert_result(RequirementCore.evaluate(single), false, single, "", "failure value again")
	assert_eq(UnitTestCore.check_script_errors(), 1, "the next evaluate called the judge hook again")
	assert_eq(errors(), 1)
	assert_eq(Hooks.count(FLAG_A), 2, "no cache after a throw")
	assert_eq(Hooks.throw_finished, 0, "the judge hook never went past its runtime error")


func test_a_failed_judge_hook_in_a_sub_condition_gives_the_failure_value_of_the_evaluated_id() -> void:
	await start()
	var no_kinds: Array[GDScript] = []
	assert_true(RequirementCore.register_judge(FLAG_A, Hooks.flag, no_kinds, GUIDE_A))
	assert_true(RequirementCore.register_judge(FLAG_B, Hooks.broken, no_kinds, GUIDE_B))
	assert_true(RequirementCore.register_judge(FLAG_C, Hooks.flag, no_kinds, GUIDE_C))
	answer(true, false, true)
	var all: int = id_of(ALL_1)
	assert_result(RequirementCore.evaluate(all), false, all, "", "failure value with the input ID")
	assert_eq(errors(), 1)
	assert_eq(Hooks.count(FLAG_C), 0, "judging stops at the failed hook")
	RequirementCore.evaluate(all)
	assert_eq(errors(), 1)
	assert_eq(Hooks.count(FLAG_A), 1, "the FlagA condition judged before the failure keeps its cache")
	assert_eq(Hooks.count(FLAG_B), 2)
