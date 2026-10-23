extends "res://core/requirement_core/tests/support/requirement_test_case.gd"
## Each row of the error table: the result and the number of error logs.


## A requirement ID value that is not 0 and not in the requirement table of the core test data.
func _missing_id(start_at: int) -> int:
	var id: int = start_at
	while GameData.RequirementTable.has_row(id):
		id += 1
	return id


func test_evaluate_of_an_id_not_in_the_table_gives_the_failure_value_and_one_error_per_id() -> void:
	await start()
	register_flags()
	var missing: int = _missing_id(900000)
	var other: int = _missing_id(missing + 1)
	assert_result(RequirementCore.evaluate(missing), false, missing, "")
	assert_result(RequirementCore.evaluate(missing), false, missing, "")
	assert_eq(errors(), 1, "once for the ID")
	assert_result(RequirementCore.evaluate(other), false, other, "")
	assert_eq(errors(), 1, "once for the other ID")


func test_a_type_without_a_judge_hook_fails_its_item_with_one_error_per_type() -> void:
	await start()
	var b_kinds: Array[GDScript] = [CoreContract.ItemBalanceUserState]
	assert_true(RequirementCore.register_judge(FLAG_B, Hooks.flag, b_kinds, GUIDE_B))
	answer(true, true)
	assert_result(RequirementCore.evaluate(id_of(SINGLE)), false, id_of(SINGLE), "", "FlagA has no hook")
	assert_eq(errors(), 1)
	assert_result(RequirementCore.evaluate(id_of(OTHER_A)), false, id_of(OTHER_A), "", "another FlagA condition")
	assert_result(RequirementCore.evaluate(id_of(ANY_1)), true, 0, "", "the failed FlagA item does not stop Any")
	assert_eq(errors(), 0, "no second log for FlagA")


func test_register_judge_of_a_registered_type_or_none_fails_and_keeps_the_first_hook() -> void:
	await start()
	var no_kinds: Array[GDScript] = []
	assert_true(RequirementCore.register_judge(FLAG_A, Hooks.flag, no_kinds, GUIDE_A))
	assert_false(RequirementCore.register_judge(FLAG_A, Hooks.broken, no_kinds, GUIDE_B))
	assert_eq(errors(), 1, "registered type")
	assert_false(RequirementCore.register_judge(GameData.RequirementType.NONE, Hooks.flag, no_kinds, GUIDE_B))
	assert_eq(errors(), 1, "None")
	answer(true)
	assert_result(RequirementCore.evaluate(id_of(SINGLE)), true, 0, "", "the first hook stays")
	answer(false)
	put_tutorial()
	assert_result(RequirementCore.evaluate(id_of(OTHER_A)), false, id_of(OTHER_A), GUIDE_A, "the first guide key stays")
	assert_eq(errors(), 0)


func test_watch_fails_for_each_error_row() -> void:
	await start()
	register_flags()
	var recorder: Recorder = Recorder.new()
	var single: int = id_of(SINGLE)
	assert_true(RequirementCore.watch(single, triggers(content_trigger()), recorder.on_result))
	assert_eq(errors(), 0)
	assert_false(RequirementCore.watch(single, triggers(user_state_trigger()), recorder.on_result), "same ID and callback")
	assert_eq(errors(), 1, "same ID and callback")
	var other: Recorder = Recorder.new()
	assert_false(RequirementCore.watch(0, triggers(content_trigger()), other.on_result), "ID 0")
	assert_eq(errors(), 1, "ID 0")
	assert_false(RequirementCore.watch(_missing_id(900000), triggers(content_trigger()), other.on_result), "ID not in the table")
	assert_eq(errors(), 1, "ID not in the table")
	var none: Array[RequirementTrigger] = []
	assert_false(RequirementCore.watch(single, none, other.on_result), "empty trigger list")
	assert_eq(errors(), 1, "empty trigger list")
	var owner: Node = Node.new()
	owner.free()
	assert_false(RequirementCore.watch(single, triggers(content_trigger()), other.on_result, owner), "destroyed owner object")
	assert_eq(errors(), 1, "destroyed owner object")
	assert_eq(other.count(), 0)
	assert_eq(recorder.count(), 0)


func test_a_batch_evaluation_over_the_round_limit_drops_the_remaining_pending_evaluations() -> void:
	await start()
	var no_kinds: Array[GDScript] = []
	assert_true(RequirementCore.register_judge(FLAG_A, Hooks.flag, no_kinds, GUIDE_A, Callable(), true))
	answer(false)
	var recorder: Recorder = Recorder.new()
	# Each callback flips the answer and raises the trigger again, so every round has a pending evaluation.
	recorder.inside = func(_id: int) -> void:
		answer(not Hooks.answers[FLAG_A])
		publish_content()
	assert_true(RequirementCore.watch(id_of(SINGLE), triggers(content_trigger()), recorder.on_result))
	answer(true)
	publish_content()
	await frame()
	assert_eq(recorder.count(), MAX_ROUNDS, "one callback per round")
	assert_eq(errors(), 1)
	assert_eq(RequirementCore._pending_count, 0)
	await frame()
	assert_eq(recorder.count(), MAX_ROUNDS, "the dropped pending evaluation is not judged in the next frame")
