extends UnitTestCase
## Sample test file of the nested runs: the fixture reads of a run of either kind. The fixture folder of the nested
## run is the core fixture folder of the outer run.


func _fixture_name() -> String:
	var access: DirAccess = DirAccess.open(_fixture_dir())
	if access == null:
		return ""
	for file: String in access.get_files():
		if file.ends_with(".json"):
			return file.get_basename()
	return ""


func _fixture_dir() -> String:
	if UnitTestCore._run.kind == "core":
		return UnitTestCore._run.config.core_fixture_dir
	return UnitTestCore._run.config.shared_fixture_dir


func test_core_fixture() -> void:
	var fixture_name: String = _fixture_name()
	assert_false(fixture_name.is_empty(), "a fixture file")
	var expected: String = FileAccess.get_file_as_string(_fixture_dir().path_join(fixture_name + ".json"))
	assert_eq(UnitTestCore.read_core_fixture(fixture_name), expected)


func test_missing_core_fixture() -> void:
	assert_true(LogCore.init(), "LogCore.init")
	assert_eq(UnitTestCore.read_core_fixture("no_such_fixture"), "")
	assert_eq(UnitTestCore.check_logs("error", "UnitTestCore"), 1)


func test_shared_fixture() -> void:
	var fixture_name: String = _fixture_name()
	assert_false(fixture_name.is_empty(), "a fixture file")
	var expected: String = FileAccess.get_file_as_string(_fixture_dir().path_join(fixture_name + ".json"))
	assert_eq(UnitTestCore.read_shared_fixture(fixture_name), expected)


func test_missing_shared_fixture() -> void:
	assert_true(LogCore.init(), "LogCore.init")
	assert_eq(UnitTestCore.read_shared_fixture("no_such_fixture"), "")
	assert_eq(UnitTestCore.check_logs("error", "UnitTestCore"), 1)
