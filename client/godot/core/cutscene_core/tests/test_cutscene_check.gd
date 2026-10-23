extends "res://core/cutscene_core/tests/support/cutscene_test_case.gd"
## The cutscene check of `play`: every rule of the data check on the rows of the cutscene, and the failed `play` of a
## cutscene that breaks it.


## A cutscene of `ROWS` that breaks one rule, and the problem the cutscene check gives for it.
class BrokenCutscene:
	var cutscene_id: int = 0
	var problem: String = ""

	func _init(id_value: int, problem_text: String) -> void:
		cutscene_id = id_value
		problem = problem_text


var _rows: ROWS = null
var _cases: Array[BrokenCutscene] = []


func before_each() -> void:
	super()
	_rows = ROWS.new()
	_cases = []
	var cut: int = _add("step 0 is less than 1")
	_rows.step(cut, 0, GameData.CutsceneCommand.CUE, false, "", "", "", 0, GameData.CutsceneCue.FIRST)
	_rows.step(cut, 1, GameData.CutsceneCommand.END)
	cut = _add("step 1 is in two rows")
	_rows.step(cut, 1, GameData.CutsceneCommand.CUE, false, "", "", "", 0, GameData.CutsceneCue.FIRST)
	_rows.step(cut, 1, GameData.CutsceneCommand.END)
	cut = _add("voice %s is in two rows" % VOICE_HELLO)
	_rows.step(cut, 1, GameData.CutsceneCommand.LINE, false, "", "", "", 0, GameData.CutsceneCue.NONE, "One", VOICE_HELLO)
	_rows.step(cut, 2, GameData.CutsceneCommand.LINE, false, "", "", "", 0, GameData.CutsceneCue.NONE, "Two", VOICE_HELLO)
	cut = _add("step 1 has no command")
	_rows.step(cut, 1, GameData.CutsceneCommand.NONE)
	cut = _add("step 1: the command does not use actor, which is not empty")
	_rows.step(cut, 1, GameData.CutsceneCommand.CUE, false, "hero", "", "", 0, GameData.CutsceneCue.FIRST)
	cut = _add("step 1: target is empty")
	_rows.step(cut, 1, GameData.CutsceneCommand.MOVE, true, "hero", "", MOVE)
	cut = _add("step 1: Hero is not snake_case")
	_rows.step(cut, 1, GameData.CutsceneCommand.MOVE, true, "Hero", "spot", MOVE)
	cut = _add("step 1: next_step 5 is not a step")
	_rows.step(cut, 1, GameData.CutsceneCommand.JUMP, false, "", "", "", 5)
	_rows.step(cut, 2, GameData.CutsceneCommand.END)
	cut = _add("step 2: next_step 1 is not after the step")
	_rows.step(cut, 1, GameData.CutsceneCommand.CUE, false, "", "", "", 0, GameData.CutsceneCue.FIRST)
	_rows.step(cut, 2, GameData.CutsceneCommand.JUMP, false, "", "", "", 1)
	cut = _add("step 1 choice 1 is in two cutscene_choice rows")
	_rows.step(cut, 1, GameData.CutsceneCommand.CHOICE)
	_rows.step(cut, 2, GameData.CutsceneCommand.END)
	_rows.choice(cut, 1, 1, 2)
	_rows.choice(cut, 1, 1, 2)
	cut = _add("cutscene_choice step 3 is not a step")
	_rows.step(cut, 1, GameData.CutsceneCommand.CHOICE)
	_rows.step(cut, 2, GameData.CutsceneCommand.END)
	_rows.choice(cut, 1, 1, 2)
	_rows.choice(cut, 3, 1, 2)
	cut = _add("cutscene_choice step 1 is not a Choice")
	_rows.step(cut, 1, GameData.CutsceneCommand.CUE, false, "", "", "", 0, GameData.CutsceneCue.FIRST)
	_rows.step(cut, 2, GameData.CutsceneCommand.END)
	_rows.choice(cut, 1, 1, 2)
	cut = _add("step 1 choice 1: next_step 9 is not a step")
	_rows.step(cut, 1, GameData.CutsceneCommand.CHOICE)
	_rows.step(cut, 2, GameData.CutsceneCommand.END)
	_rows.choice(cut, 1, 1, 9)
	cut = _add("Choice step 1 has no choice without a requirement")
	_rows.step(cut, 1, GameData.CutsceneCommand.CHOICE)
	_rows.step(cut, 2, GameData.CutsceneCommand.END)
	_rows.choice(cut, 1, 1, 2, 1)


func _add(problem: String) -> int:
	var cut: int = _rows.new_id()
	_cases.append(BrokenCutscene.new(cut, problem))
	return cut


func sorted_steps(cutscene_id: int) -> Array[GameData.CutsceneStepRow]:
	var steps: Array[GameData.CutsceneStepRow] = GameData.CutsceneStepTable.get_rows(cutscene_id).duplicate()
	steps.sort_custom(CutsceneCore._is_step_before)
	return steps


func test_the_cutscene_check_gives_the_broken_rule_of_each_cutscene() -> void:
	assert_true(await start(true, true, _rows.tables()))
	for broken: BrokenCutscene in _cases:
		assert_true(GameData.CutsceneStepTable.has_rows(broken.cutscene_id), broken.problem)
		assert_eq(CutsceneCore._cutscene_check(broken.cutscene_id, sorted_steps(broken.cutscene_id)), broken.problem)


func test_the_cutscene_check_passes_every_cutscene_of_the_core_test_data() -> void:
	assert_true(await start())
	for name: String in ["[cut_order]", "[cut_branch]", "[cut_choice]", "[cut_skip]", "[cut_stop]", "[cut_staging]"]:
		assert_eq(CutsceneCore._cutscene_check(id(name), sorted_steps(id(name))), "", name)


func test_play_of_a_cutscene_that_fails_the_cutscene_check_fails_without_starting() -> void:
	assert_true(await start(true, true, _rows.tables()))
	for broken: BrokenCutscene in _cases:
		var result: CutsceneResult = await CutsceneCore.play(broken.cutscene_id, scope)
		assert_eq(result.status, CutsceneCore.CutsceneStatus.FAILED, broken.problem)
		assert_eq(result.choices.size(), 0, broken.problem)
		assert_eq(errors(), 1, broken.problem)
		assert_false(CutsceneCore.is_playing(), broken.problem)
		assert_false(root().visible, "the cutscene root is hidden: " + broken.problem)
		assert_eq(root().get_child_count(), 0, "no cutscene view: " + broken.problem)
		assert_false(block_reasons().has("cutscene"), "no cutscene block: " + broken.problem)
	var call: PLAY = await play("[cut_plain]")
	assert_true(line_running(), "a cutscene that passes plays after the failures")
	await press_advance()
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	assert_eq(errors(), 0)
