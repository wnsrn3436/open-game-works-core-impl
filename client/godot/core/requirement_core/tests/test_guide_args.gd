extends "res://core/requirement_core/tests/support/requirement_test_case.gd"
## `fill_guide_args`: clears `FormatArgs`, then only the guide argument hook of the type of the first failed condition
## puts values.

const RecordingArgs := preload("res://core/requirement_core/tests/support/recording_format_args.gd")


func _register_level_with_guide() -> void:
	var no_kinds: Array[GDScript] = []
	assert_true(RequirementCore.register_judge(TYPE_LEVEL, Hooks.flag, no_kinds, GUIDE_LEVEL, Hooks.guide_args))


func _stale_args() -> RecordingArgs:
	var args: RecordingArgs = RecordingArgs.new()
	args.set_string("stale", "left by the caller")
	args.set_int("count", 99)
	return args


func test_fill_guide_args_leaves_only_what_the_hook_put() -> void:
	await start()
	_register_level_with_guide()
	Hooks.answers[TYPE_LEVEL] = false
	Hooks.guide_name = "level"
	var result: RequirementResult = RequirementCore.evaluate(id_of(LEVEL))
	assert_result(result, false, id_of(LEVEL), GUIDE_LEVEL)
	var args: RecordingArgs = _stale_args()
	RequirementCore.fill_guide_args(result, args)
	var expected: Dictionary[String, String] = {"count": "i:1", "name": "s:level"}
	assert_eq(args.values, expected)
	assert_eq(Hooks.guide_calls, 1)
	assert_eq(Hooks.guide_row, id_of(LEVEL), "the hook got the row of the first failed condition")
	assert_eq(errors(), 0)


func test_a_throwing_guide_argument_hook_leaves_it_empty_with_an_error_log() -> void:
	await start()
	var no_kinds: Array[GDScript] = []
	assert_true(RequirementCore.register_judge(TYPE_LEVEL, Hooks.flag, no_kinds, GUIDE_LEVEL, Hooks.guide_args_throwing))
	Hooks.answers[TYPE_LEVEL] = false
	var result: RequirementResult = RequirementCore.evaluate(id_of(LEVEL))
	var args: RecordingArgs = _stale_args()
	RequirementCore.fill_guide_args(result, args)
	assert_eq(UnitTestCore.check_script_errors(), 1, "the guide argument hook threw")
	assert_eq(args.values.size(), 0, "nothing of the hook that threw is left")
	assert_eq(errors(), 1)
	RequirementCore.fill_guide_args(result, args)
	assert_eq(UnitTestCore.check_script_errors(), 1, "the next call called the hook again")
	assert_eq(Hooks.guide_calls, 2)
	assert_eq(errors(), 1)
	assert_eq(Hooks.throw_finished, 0)


func test_fill_guide_args_of_a_passed_result_leaves_it_empty() -> void:
	await start()
	_register_level_with_guide()
	Hooks.answers[TYPE_LEVEL] = true
	var args: RecordingArgs = _stale_args()
	RequirementCore.fill_guide_args(RequirementCore.evaluate(id_of(LEVEL)), args)
	assert_eq(args.values.size(), 0)
	assert_eq(Hooks.guide_calls, 0)


func test_fill_guide_args_of_a_type_without_a_guide_argument_hook_leaves_it_empty() -> void:
	await start()
	register_flags()
	answer(true, false, false)
	var result: RequirementResult = RequirementCore.evaluate(id_of(NESTED_1))
	assert_eq(result.failed_requirement_id, id_of(NESTED_4))
	var args: RecordingArgs = _stale_args()
	RequirementCore.fill_guide_args(result, args)
	assert_eq(args.values.size(), 0)
	assert_eq(errors(), 0)
