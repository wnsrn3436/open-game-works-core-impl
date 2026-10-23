extends GutTest
## Decode of the table binaries by the Godot generated data code (`client-core` Godot `### generated code`).

const DATA_DIR: String = "res://build/data"


## Every table binary of the build by file name.
static func table_files() -> Dictionary[String, PackedByteArray]:
	var files: Dictionary[String, PackedByteArray] = {}
	for name: String in DirAccess.get_files_at(DATA_DIR):
		if name.ends_with(".bin") and not name.begins_with("translation_"):
			files[name] = FileAccess.get_file_as_bytes(DATA_DIR + "/" + name)
	return files


func before_each() -> void:
	GameData.clear()
	GameDataDev.clear_settings()
	assert_true(GameData.load_tables(table_files()))


func after_each() -> void:
	GameData.clear()
	GameDataDev.clear_settings()


func test_data_row_has_every_column_type() -> void:
	var a: int = GameDataDev.find_id_value("[tool_test_a]")
	var gold: int = GameDataDev.find_id_value("[gold]")
	var gem: int = GameDataDev.find_id_value("[gem]")
	assert_gt(a, 0)
	var row: GameData.ToolTestRow = GameData.ToolTestTable.get_row(a)
	assert_eq(row.id, a)
	assert_eq(row.name, "tool_test.name.%d" % a)
	assert_eq(row.small, 7)
	assert_eq(row.maybe, 0)
	assert_eq(row.large, -9000000000)
	assert_eq(row.ratio, 1.5)
	assert_eq(row.precise, -2.25)
	assert_true(row.flag)
	assert_eq(row.note, "plain %d" % gold)
	assert_eq(row.starts_at, 1767323045000)
	assert_eq(row.period, 5400000)
	assert_eq(row.grade, GameData.ToolTestGrade.GOLD)
	assert_eq(row.maybe_grade, GameData.ToolTestGrade.NONE)
	assert_eq(row.item, gold)
	assert_eq(row.cell, Vector2i(3, -4))
	assert_eq(row.offset, Vector3(1.5, 2.0, -0.5))
	assert_eq(row.smalls, PackedInt32Array([1, -2, 3]))
	assert_eq(row.larges, PackedInt64Array([-9000000000, 5]))
	assert_eq(row.ratios, PackedFloat32Array([0.5, -1.25]))
	assert_eq(row.notes, PackedStringArray(["first", "second"]))
	assert_eq(row.flags.size(), 3)
	if row.flags.size() == 3:
		assert_true(row.flags[0] and not row.flags[1] and row.flags[2])
	assert_eq(row.grades, PackedInt32Array([GameData.ToolTestGrade.GOLD, GameData.ToolTestGrade.SILVER]))
	assert_eq(row.cells.size(), 2)
	if row.cells.size() == 2:
		assert_eq(row.cells[0], Vector2i(1, 2))
		assert_eq(row.cells[1], Vector2i(-3, 4))
	assert_eq(row.grid.size(), 3)
	if row.grid.size() == 3:
		assert_eq(row.grid[0], PackedInt32Array([1, 2]))
		assert_eq(row.grid[1], PackedInt32Array())
		assert_eq(row.grid[2], PackedInt32Array([3]))
	assert_eq(row.switches.size(), 2)
	if row.switches.size() == 2:
		var first: Array[bool] = row.switches[0]
		var second: Array[bool] = row.switches[1]
		assert_eq(first.size(), 2)
		assert_eq(second.size(), 1)
	assert_eq(row.rewards.size(), 2)
	if row.rewards.size() == 2:
		assert_eq(row.rewards[0].item_id, gold)
		assert_eq(row.rewards[0].amount, 5)
		assert_eq(row.rewards[1].item_id, gem)
		assert_eq(row.rewards[1].amount, 300)
		assert_eq(row.rewards[1].big_amount, "")
	assert_eq(row.slots.size(), 2)
	if row.slots.size() == 2:
		assert_eq(row.slots[0].grade, GameData.ToolTestGrade.GOLD)
		assert_eq(row.slots[0].count, 2)
		assert_eq(row.slots[1].grade, GameData.ToolTestGrade.SILVER)
		assert_eq(row.slots[1].count, 1)


func test_data_zero_values_and_nullable_columns() -> void:
	var row: GameData.ToolTestRow = GameData.ToolTestTable.get_row(GameDataDev.find_id_value("[tool_test_b]"))
	assert_eq(row.small, 0)
	assert_eq(row.maybe, 4)
	assert_eq(row.maybe_grade, GameData.ToolTestGrade.GOLD)
	assert_eq(row.note, "")
	assert_eq(row.cell, Vector2i.ZERO)
	assert_eq(row.smalls.size(), 0)
	assert_eq(row.slots.size(), 0)


func test_data_server_column_is_not_in_the_client_row() -> void:
	var row: GameData.ToolTestRow = GameData.ToolTestRow.new()
	assert_false("server_only" in row)
	assert_true("small" in row)


func test_data_keyed_container_finds_rows_and_returns_the_empty_row() -> void:
	var a: int = GameDataDev.find_id_value("[tool_test_a]")
	assert_eq(GameData.ToolTestTable.all_rows().size(), 2)
	assert_true(GameData.ToolTestTable.has_row(a))
	assert_false(GameData.ToolTestTable.has_row(0))
	assert_same(GameData.ToolTestTable.get_row(a), GameData.ToolTestTable.get_row(a))
	assert_same(GameData.ToolTestTable.get_row(0), GameData.ToolTestTable.empty_row())
	assert_same(GameData.ToolTestTable.all_rows(), GameData.ToolTestTable.all_rows())


func test_data_id_container_returns_the_rows_of_an_id_value() -> void:
	var a: int = GameDataDev.find_id_value("[tool_test_a]")
	var b: int = GameDataDev.find_id_value("[tool_test_b]")
	var rows: Array[GameData.ToolTestLevelRow] = GameData.ToolTestLevelTable.get_rows(a)
	assert_eq(rows.size(), 2)
	if rows.size() == 2:
		assert_eq(rows[0].level, 1)
		assert_eq(rows[1].level, 2)
	assert_same(GameData.ToolTestLevelTable.get_rows(a), rows)
	assert_eq(GameData.ToolTestLevelTable.get_rows(b).size(), 1)
	assert_true(GameData.ToolTestLevelTable.has_rows(b))
	assert_false(GameData.ToolTestLevelTable.has_rows(0))
	assert_eq(GameData.ToolTestLevelTable.get_rows(0).size(), 0)


func test_data_game_setting_accessors_read_every_type() -> void:
	assert_eq(GameSetting.tool_test_max(), 50)
	assert_eq(GameSetting.tool_test_scale(), 1.25)
	assert_true(GameSetting.tool_test_on())
	assert_eq(GameSetting.tool_test_grade(), GameData.ToolTestGrade.GOLD)
	assert_eq(GameSetting.tool_test_cell(), Vector2i(2, -3))
	assert_eq(GameSetting.tool_test_list(), PackedInt32Array([4, 5, 6]))
	assert_eq(GameSetting.tool_test_words(), PackedStringArray(["a", "b"]))
	assert_eq(GameSetting.tool_test_since(), 1767323045000)


func test_data_game_setting_test_values_come_first_until_cleared() -> void:
	GameDataDev.set_setting_tool_test_max(7)
	GameDataDev.set_setting_tool_test_grade(GameData.ToolTestGrade.SILVER)
	assert_eq(GameSetting.tool_test_max(), 7)
	assert_eq(GameSetting.tool_test_grade(), GameData.ToolTestGrade.SILVER)
	GameDataDev.clear_settings()
	assert_eq(GameSetting.tool_test_max(), 50)


func test_data_reserved_accessors() -> void:
	assert_eq(ReservedId.tool_test_reserved(), GameDataDev.find_id_value("[tool_test_a]"))
	assert_ne(ReservedString.auth_terms_title(), "")


func test_data_dev_accessor_maps_id_names_and_values() -> void:
	var a: int = GameDataDev.find_id_value("[tool_test_a]")
	assert_eq(GameDataDev.find_id_name(a), "[tool_test_a]")
	assert_eq(GameDataDev.find_id_value("[no_such_name]"), 0)
	assert_eq(GameDataDev.find_id_name(0), "")


func test_data_derived_container_functions() -> void:
	var a: int = GameDataDev.find_id_value("[tool_test_a]")
	assert_eq(GameData.table_rows("tool_test").size(), 2)
	assert_eq(GameData.table_rows("no_such_table").size(), 0)
	assert_same(GameData.table_empty_row("tool_test"), GameData.ToolTestTable.empty_row())
	assert_null(GameData.table_empty_row("no_such_table"))
	assert_true(GameData.is_key_column("tool_test", "grade"))
	assert_true(GameData.is_key_column("tool_test", "item"))
	assert_false(GameData.is_key_column("tool_test", "note"))
	assert_false(GameData.is_key_column("no_such_table", "id"))
	var row: GameData.ToolTestRow = GameData.ToolTestTable.get_row(a)
	assert_eq(GameData.key_value("tool_test", "grade", row), GameData.ToolTestGrade.GOLD)
	assert_eq(GameData.key_value("tool_test", "id", row), a)
	assert_eq(GameData.key_value("tool_test", "large", row), -9000000000)


func test_data_load_fails_without_filling_on_a_missing_or_bad_binary() -> void:
	GameData.clear()
	assert_eq(GameData.ToolTestTable.all_rows().size(), 0)
	assert_eq(GameSetting.tool_test_max(), 0)
	var files: Dictionary[String, PackedByteArray] = table_files()
	files.erase("item.bin")
	assert_false(GameData.load_tables(files))
	assert_eq(GameData.ToolTestTable.all_rows().size(), 0)
	files = table_files()
	files["tool_test.bin"] = PackedByteArray([0x0A, 0x05, 0x08])
	assert_false(GameData.load_tables(files))
	assert_eq(GameData.ItemTable.all_rows().size(), 0)
