extends UnitTestCase
## `DataCore` lifecycle, `release`, `set_test_data_location`, and core module `init` that reads no data.

const Support := preload("res://core/data_core/tests/support/data_core_test_support.gd")
const DataCoreSession := preload("res://core/data_core/data_core_session.gd")
const TEST_LOCATION: String = "res://core/data_core/tests/no_data/"
## Reads of the generated containers, accessors and derived containers.
const DATA_READ: String = "GameData\\.[A-Za-z0-9_]+Table\\.|GameData\\.table_rows|(GameSetting|ReservedId|ReservedString|ReservedSound)\\.[a-z0-9_]+\\(|DataCore\\.(get_row|get_rows|has_row|has_rows)\\("

static var _index: DataIndex = null


func after_each() -> void:
	super()
	Support.release_modules()
	_index = null


static func _hook_index() -> bool:
	_index = DataCore.make_index("rating_tier", PackedStringArray(["min_rating"]))
	return true


func test_lifecycle_init_and_release() -> void:
	assert_false(DataCore.is_initialized())
	assert_true(Support.init_modules())
	assert_true(DataCore.is_initialized())
	var session: DataCoreSession = DataCore._session
	assert_true(await DataCore.load(null))
	assert_true(DataCore.register_build_derived(_hook_index))
	assert_true(DataCore.build_derived_containers())
	var silver: GameData.RatingTierRow = GameData.RatingTierTable.get_row(GameDataDev.find_id_value("[rating_tier_silver]"))
	assert_same(DataCore.get_row(_index, PackedInt64Array([silver.min_rating + 1000000])), GameData.RatingTierTable.empty_row())
	assert_eq(Support.errors(), 1)
	DataCore.release()
	assert_false(DataCore.is_initialized())
	assert_ne(DataCore._session, session)
	assert_eq(DataCore._max_file_bytes, 0)
	assert_false(DataCore._load_called)
	assert_false(DataCore._is_loaded)
	assert_eq(DataCore._data_version, "")
	assert_false(DataCore._builtin_version_read)
	assert_eq(DataCore._builtin_version, "")
	assert_eq(DataCore._builtin_location, "res://build/data/")
	assert_true(DataCore._build_derived_hook.is_null())
	assert_false(DataCore._derived_called)
	assert_false(DataCore._building_derived)
	assert_false(DataCore._derived_failed)
	assert_eq(DataCore._missing_logged.size(), 0)
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	assert_false(tree.process_frame.is_connected(session.resume))


func test_release_empties_containers_accessors_and_version_and_another_version_loads_after_init() -> void:
	assert_true(Support.init_modules())
	var first: DownloadedData = Support.write_valid_downloaded("data_core_test/first", "first")
	assert_true(await DataCore.load(first))
	assert_true(DataCore.register_build_derived(_hook_index))
	assert_true(DataCore.build_derived_containers())
	var silver: GameData.RatingTierRow = GameData.RatingTierTable.get_row(GameDataDev.find_id_value("[rating_tier_silver]"))
	var silver_key: PackedInt64Array = PackedInt64Array([silver.min_rating])
	assert_true(DataCore.has_row(_index, silver_key))
	assert_eq(GameSetting.data_core_setting(), 42)
	DataCore.release()
	for name: String in Support.table_names():
		assert_eq(GameData.table_rows(name.get_basename()).size(), 0, name)
	assert_eq(GameSetting.data_core_setting(), 0)
	assert_false(DataCore.has_row(_index, silver_key))
	assert_eq(DataCore.get_data_version(), "")
	assert_eq(Support.errors(), 1)
	assert_true(DataCore.init())
	var second: DownloadedData = Support.write_valid_downloaded("data_core_test/second", "second")
	assert_ne(second.data_version, first.data_version)
	assert_true(await DataCore.load(second))
	assert_eq(DataCore.get_data_version(), second.data_version)
	assert_true(GameData.ExperimentTable.has_row(Support.EXTRA_ID))


func test_builtin_data_version_after_release_is_empty_with_an_error_log() -> void:
	assert_true(Support.init_modules())
	assert_eq(DataCore.get_builtin_data_version(), Support.builtin_version())
	DataCore.release()
	assert_eq(DataCore.get_builtin_data_version(), "")
	assert_eq(Support.errors(), 1)
	assert_false(DataCore._builtin_version_read)
	assert_true(DataCore.init())
	assert_eq(DataCore.get_builtin_data_version(), Support.builtin_version())
	assert_eq(Support.errors(), 0)


func test_test_data_location_until_release() -> void:
	assert_eq(DataCore.get_builtin_location(), "res://build/data/")
	DataCoreDev.set_test_data_location(TEST_LOCATION)
	assert_true(Support.init_modules())
	assert_eq(DataCore.get_builtin_location(), TEST_LOCATION)
	DataCore.release()
	assert_eq(DataCore.get_builtin_location(), "res://build/data/")
	DataCoreDev.set_test_data_location(TEST_LOCATION)
	DataCore.release()
	assert_eq(DataCore.get_builtin_location(), "res://build/data/")


func test_test_data_location_after_init_is_refused() -> void:
	assert_true(Support.init_modules())
	DataCoreDev.set_test_data_location(TEST_LOCATION)
	assert_eq(Support.errors(), 1)
	assert_eq(DataCore.get_builtin_location(), "res://build/data/")


func test_init_reads_no_data() -> void:
	assert_true(Support.init_modules())
	for name: String in Support.table_names():
		assert_eq(GameData.table_rows(name.get_basename()).size(), 0, name)
	assert_false(DataCore.is_loaded())


## The source text of every core module `init` and of the same-file helpers it calls has no read of the generated
## containers, accessors and derived containers. Script source is not in a web export.
func test_core_module_init_reads_no_containers() -> void:
	UnitTestCore.require_platform(PackedStringArray(["android", "ios", "windows", "macos", "linux"]))
	if CoreBuildInfo.platform == "web":
		return
	var read: RegEx = RegEx.create_from_string(DATA_READ)
	var core: DirAccess = DirAccess.open("res://core")
	assert_not_null(core)
	if core == null:
		return
	var modules: int = 0
	for folder: String in core.get_directories():
		var path: String = "res://core/%s/%s.gd" % [folder, folder]
		if not FileAccess.file_exists(path):
			continue
		modules += 1
		var body: String = init_source(FileAccess.get_file_as_string(path))
		var found: RegExMatch = read.search(body)
		assert_null(found, "%s init reads %s" % [path, found.get_string() if found != null else ""])
	assert_gt(modules, 0)


func test_init_source_follows_same_file_helpers() -> void:
	var source: String = "\n".join(PackedStringArray([
		"static func init() -> bool:",
		"\t_prepare()",
		"\treturn true",
		"",
		"",
		"static func _prepare() -> void:",
		"\tawait _read_defaults()",
		"",
		"",
		"static func _read_defaults(",
		"\tunused: int = 0,",
		") -> void:",
		"\tvar _v: int = GameSetting.data_core_setting()",
		"",
		"",
		"static func _on_loaded() -> void:",
		"\tvar _r: Array = GameData.table_rows(\"item\")",
	]))
	var read: RegEx = RegEx.create_from_string(DATA_READ)
	var found: RegExMatch = read.search(init_source(source))
	assert_not_null(found)
	assert_eq(found.get_string() if found != null else "", "GameSetting.data_core_setting(")
	assert_false("table_rows" in init_source(source))


func test_init_source_follows_same_file_public_functions() -> void:
	var source: String = "\n".join(PackedStringArray([
		"static func init() -> bool:",
		"\tvar _first: int = get_int(0)",
		"\treturn is_initialized()",
		"",
		"",
		"static func is_initialized() -> bool:",
		"\treturn true",
		"",
		"",
		"static func get_int(key: int) -> int:",
		"\treturn _check_key(key)",
		"",
		"",
		"static func _check_key(key: int) -> int:",
		"\treturn GameData.RemoteConfigKeyTable.size() + key",
		"",
		"",
		"func set_up() -> void:",
		"\tself.load_rows()",
		"",
		"",
		"func load_rows() -> void:",
		"\tvar _r: Array = GameData.table_rows(\"item\")",
	]))
	var read: RegEx = RegEx.create_from_string(DATA_READ)
	var found: RegExMatch = read.search(init_source(source))
	assert_not_null(found)
	assert_eq(found.get_string() if found != null else "", "GameData.RemoteConfigKeyTable.")
	assert_false("table_rows" in init_source(source))


func test_init_source_follows_self_calls_and_skips_other_objects() -> void:
	var source: String = "\n".join(PackedStringArray([
		"func init() -> bool:",
		"\tself.prepare()",
		"\t_other.load_rows()",
		"\treturn true",
		"",
		"",
		"func prepare() -> void:",
		"\tvar _v: int = GameSetting.data_core_setting()",
		"",
		"",
		"func load_rows() -> void:",
		"\tvar _r: Array = GameData.table_rows(\"item\")",
	]))
	var body: String = init_source(source)
	assert_true("GameSetting.data_core_setting(" in body)
	assert_false("table_rows" in body)


## The bodies of `init` in `source` and of every same-file function it calls without a receiver or through
## `self.`, followed to any depth.
static func init_source(source: String) -> String:
	var bodies: Dictionary[String, String] = func_bodies(source)
	if not bodies.has("init"):
		return ""
	var call: RegEx = RegEx.create_from_string("(?<![A-Za-z0-9_.])(?:self\\.)?([A-Za-z_][A-Za-z0-9_]*)\\(")
	var seen: Dictionary[String, bool] = {"init": true}
	var queue: PackedStringArray = PackedStringArray(["init"])
	var out: PackedStringArray = PackedStringArray()
	while not queue.is_empty():
		var name: String = queue[queue.size() - 1]
		queue.remove_at(queue.size() - 1)
		out.append(bodies[name])
		for found: RegExMatch in call.search_all(bodies[name]):
			var callee: String = found.get_string(1)
			if bodies.has(callee) and not seen.has(callee):
				seen[callee] = true
				queue.append(callee)
	return "\n".join(out)


## The body of each top-level `func` and `static func` of `source` by name: its lines up to the next line that is
## not indented and does not close a header of more than one line.
static func func_bodies(source: String) -> Dictionary[String, String]:
	var bodies: Dictionary[String, String] = {}
	var name: String = ""
	var body: PackedStringArray = PackedStringArray()
	for line: String in source.split("\n"):
		if not line.is_empty() and not line.begins_with("\t") and not line.begins_with(" ") and not line.begins_with(")"):
			if not name.is_empty():
				bodies[name] = "\n".join(body)
			name = ""
			body = PackedStringArray()
			var header: String = line.trim_prefix("static ")
			if header.begins_with("func ") and header.find("(") > 5:
				name = header.substr(5, header.find("(") - 5).strip_edges()
			continue
		if not name.is_empty():
			body.append(line)
	if not name.is_empty():
		bodies[name] = "\n".join(body)
	return bodies
