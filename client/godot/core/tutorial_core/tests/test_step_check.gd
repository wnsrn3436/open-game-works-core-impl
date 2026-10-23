extends "res://core/tutorial_core/tests/support/tutorial_test_case.gd"
## Step check: the `tutorial_step` data check rules applied again before a start. The core test data passes the data
## check, so the tests put broken steps into the definitions TutorialCore made from the data.

func _step(number: int) -> TutorialCore._STEP:
	var step: TutorialCore._STEP = TutorialCore._STEP.new()
	step.step = number
	step.complete = GameData.TutorialComplete.ADVANCE
	return step


const CASE_COUNT: int = 11


## The broken step list of rule case `index`.
func _broken_case(index: int) -> Array[TutorialCore._STEP]:
	var steps: Array[TutorialCore._STEP] = []
	var step: TutorialCore._STEP = _step(1)
	match index:
		0:
			step.pointer = true
		1:
			step.restrict_input = true
		2:
			step.complete = GameData.TutorialComplete.ANCHOR_TAP
		3:
			step.complete = GameData.TutorialComplete.REQUIREMENT
		4:
			step.anchor = "tc_anchor"
			step.anchor_key = -1
		5:
			step.anchor_key = 5
		6:
			step.complete = GameData.TutorialComplete.CUE
		7:
			steps.append(_step(1))
			step = _popup_step(2)
			step.panel = PANEL
		8:
			steps.append(_step(1))
			step = _popup_step(2)
			step.restrict_input = false
		9:
			step = _popup_step(1)
		10:
			var saved: TutorialCore._STEP = _step(1)
			saved.save = true
			steps.append(saved)
			step = _popup_step(2)
	steps.append(step)
	return steps


## A valid popup step when it is not a resume start step.
func _popup_step(number: int) -> TutorialCore._STEP:
	var step: TutorialCore._STEP = _step(number)
	step.anchor = "tc_anchor"
	step.restrict_input = true
	step.popup = POPUP
	return step


func test_a_tutorial_with_a_step_that_breaks_a_rule_does_not_start_and_logs_an_error() -> void:
	assert_true(await start())
	var first: int = id_of("[tutorial_first]")
	allow(PackedStringArray(["[tutorial_first]"]))
	for i: int in CASE_COUNT:
		TutorialCore.release()
		assert_true(TutorialCore.init())
		assert_true(TutorialCore.register_can_start_tutorial(_can_start))
		assert_true(TutorialCore._make_defs())
		TutorialCore._defs_by_id[first].steps = _broken_case(i)
		assert_false(TutorialCore.check_start(), "case %d" % i)
		assert_eq(errors(), 1, "case %d" % i)
		assert_false(TutorialCore.check_start(), "case %d again" % i)
		assert_eq(errors(), 0, "case %d is not checked again" % i)
	assert_eq(events, PackedStringArray())


func test_valid_steps_pass_the_step_check() -> void:
	assert_true(await start())
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_popup]"])))
	assert_eq(errors(), 0)
	assert_eq(events, PackedStringArray(["started:[tutorial_popup]:1"]))
