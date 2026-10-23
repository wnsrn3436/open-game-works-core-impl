extends "res://core/requirement_core/tests/support/requirement_test_case.gd"
## Combination: the pass flag of `None`, `All` and `Any`, the stop item, the first failed condition and its guide key,
## requirement ID 0, and the core test fixture `requirement-evaluation`.


func test_logic_none_passes_by_its_self_judgement() -> void:
	await start()
	register_flags()
	answer(true)
	assert_result(RequirementCore.evaluate(id_of(SINGLE)), true, 0, "", "FlagA passes")
	restart()
	answer(false)
	assert_result(RequirementCore.evaluate(id_of(SINGLE)), false, id_of(SINGLE), GUIDE_A, "FlagA fails")
	assert_eq(Hooks.count(FLAG_A), 2)


func test_logic_all_passes_when_every_item_passes_and_stops_at_the_first_failed_item() -> void:
	await start()
	register_flags()
	answer(true, true, true)
	assert_result(RequirementCore.evaluate(id_of(ALL_1)), true, 0, "", "all pass")
	assert_eq([Hooks.count(FLAG_A), Hooks.count(FLAG_B), Hooks.count(FLAG_C)], [1, 1, 1])
	_check_all(false, true, true, ALL_2, GUIDE_A, PackedInt32Array([1, 0, 0]))
	_check_all(true, false, true, ALL_3, GUIDE_B, PackedInt32Array([1, 1, 0]))
	_check_all(true, true, false, ALL_4, GUIDE_C, PackedInt32Array([1, 1, 1]))


func _check_all(a: bool, b: bool, c: bool, failed: String, guide: String, expected_calls: PackedInt32Array) -> void:
	restart()
	Hooks.calls = {}
	answer(a, b, c)
	assert_result(RequirementCore.evaluate(id_of(ALL_1)), false, id_of(failed), guide, "fails at " + failed)
	assert_eq(PackedInt32Array([Hooks.count(FLAG_A), Hooks.count(FLAG_B), Hooks.count(FLAG_C)]), expected_calls, "calls when failing at " + failed)


func test_logic_any_passes_when_an_item_passes_and_stops_at_the_first_passed_item() -> void:
	await start()
	register_flags()
	answer(true, false)
	assert_result(RequirementCore.evaluate(id_of(ANY_1)), true, 0, "", "first passes")
	assert_eq([Hooks.count(FLAG_A), Hooks.count(FLAG_B)], [1, 0], "FlagB after the stop item is not judged")
	restart()
	Hooks.calls = {}
	answer(false, true)
	assert_result(RequirementCore.evaluate(id_of(ANY_1)), true, 0, "", "second passes")
	assert_eq([Hooks.count(FLAG_A), Hooks.count(FLAG_B)], [1, 1])
	restart()
	Hooks.calls = {}
	answer(false, false)
	assert_result(RequirementCore.evaluate(id_of(ANY_1)), false, id_of(ANY_2), GUIDE_A, "none passes: the first item")
	assert_eq([Hooks.count(FLAG_A), Hooks.count(FLAG_B)], [1, 1])


func test_the_first_failed_condition_of_a_sub_condition_item_is_its_own_first_failed_condition() -> void:
	await start()
	register_flags()
	answer(true, false, false)
	assert_result(RequirementCore.evaluate(id_of(NESTED_1)), false, id_of(NESTED_4), GUIDE_B, "inner Any fails at its first item")
	restart()
	Hooks.calls = {}
	answer(false, true, true)
	assert_result(RequirementCore.evaluate(id_of(NESTED_1)), false, id_of(NESTED_2), GUIDE_A, "FlagA fails first")
	assert_eq([Hooks.count(FLAG_A), Hooks.count(FLAG_B), Hooks.count(FLAG_C)], [1, 0, 0], "the sub-condition after the stop item is not judged")
	restart()
	answer(true, false, true)
	assert_result(RequirementCore.evaluate(id_of(NESTED_1)), true, 0, "", "FlagC passes the inner Any")
	assert_result(RequirementCore.evaluate(id_of(NESTED_3)), true, 0, "", "the inner Any alone")


func test_guide_key_is_the_one_register_judge_got_for_the_type() -> void:
	await start()
	var no_kinds: Array[GDScript] = []
	assert_true(RequirementCore.register_judge(FLAG_A, Hooks.flag, no_kinds, "requirement_test.other_guide"))
	answer(false)
	assert_result(RequirementCore.evaluate(id_of(OTHER_A)), false, id_of(OTHER_A), "requirement_test.other_guide")


func test_requirement_zero_passes_without_a_judge_hook_call_or_a_log() -> void:
	await start()
	register_flags()
	answer(false, false, false)
	assert_result(RequirementCore.evaluate(0), true, 0, "")
	assert_eq(Hooks.calls.size(), 0)
	assert_eq(errors(), 0)


## Each case of the core test fixture `requirement-evaluation`: the judge results of the flags, the requirement ID name
## (or 0), and the expected `passed` and `failed_requirement_id`. The server `validation` core test reads the same
## fixture.
func test_core_fixture_requirement_evaluation() -> void:
	await start()
	register_flags()
	assert_gt(_run_fixture(), 0, "cases")


# ogw:input_boundary
func _run_fixture() -> int:
	var parsed: Variant = JSON.parse_string(UnitTestCore.read_core_fixture("requirement-evaluation"))
	assert_true(parsed is Dictionary, "the fixture is a JSON object")
	if not parsed is Dictionary:
		return 0
	var root: Dictionary = parsed
	var cases: Array = root["cases"]
	for item: Variant in cases:
		var case: Dictionary = item
		var case_name: String = case["name"]
		var input: Dictionary = case["input"]
		var expected: Dictionary = case["expected"]
		var user_state: Array = input["user_state"]
		assert_eq(user_state.size(), 0, case_name + ": the flag judge hooks read no UserState")
		restart()
		var judge: Dictionary = input["judge"]
		for key: Variant in judge:
			var element: String = key
			var value: bool = judge[key]
			Hooks.answers[_flag_type(element)] = value
		var result: RequirementResult = RequirementCore.evaluate(_id_value(input["requirement"]))
		var expected_passed: bool = expected["passed"]
		assert_eq(result.passed, expected_passed, case_name + ": passed")
		assert_eq(result.failed_requirement_id, _id_value(expected["failed_requirement_id"]), case_name + ": failed_requirement_id")
	return cases.size()


## The ID value of a fixture value: the number 0 or an ID name.
# ogw:input_boundary
func _id_value(value: Variant) -> int:
	if value is String:
		var id_name: String = value
		return id_of(id_name)
	return 0


func _flag_type(element: String) -> int:
	match element:
		"FlagA":
			return FLAG_A
		"FlagB":
			return FLAG_B
		"FlagC":
			return FLAG_C
	fail_test("unknown judge element " + element)
	return 0
