extends InputCoreTestCase
## The prompt table and `get_prompt` before the core test data loads.

var prompt: InputPrompt = InputPrompt.new()


func test_get_prompt_before_and_after_the_data_loads() -> void:
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	assert_false(DataCore.is_loaded())
	assert_true(InputCore.get_prompt(&"jump", prompt))
	assert_eq(prompt.family, GameData.InputPromptFamily.KEYBOARD_MOUSE)
	assert_eq(prompt.input, "J")
	assert_eq(prompt.icon, "", "no row while the data is not loaded")
	assert_eq(prompt.name_key, "")
	assert_false(InputCore._prompt_rows_built, "the prompt table is not built while the data is not loaded")
	assert_eq(errors() + warns(), 0, "no log")
	assert_true(await DataCore.load(null), "core test data loads")
	assert_true(InputCore.get_prompt(&"jump", prompt))
	assert_eq(prompt.icon, "icon/key_j")
	var row: GameData.InputPromptRow = null
	for candidate: GameData.InputPromptRow in GameData.InputPromptTable.all_rows():
		if candidate.family == GameData.InputPromptFamily.KEYBOARD_MOUSE and candidate.input == "J":
			row = candidate
	assert_not_null(row, "the core test data has the row")
	if row != null:
		assert_eq(prompt.name_key, row.name)
	assert_true(InputCore._prompt_rows_built)
	assert_eq(InputCore._prompt_rows.size(), GameData.InputPromptTable.all_rows().size(), "every row in the table")
