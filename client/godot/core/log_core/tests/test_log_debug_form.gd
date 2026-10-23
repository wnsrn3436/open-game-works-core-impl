extends UnitTestCase
## Every `log_debug` call of the core code is a one-line statement `LogCore.log_debug(...)`, the form STG and PROD
## builds replace with `pass`. The static check before the core test checks the same from the parsed source; this
## test reads the source files where the run has them.

const SELF: String = "res://core/log_core/tests/test_log_debug_form.gd"
const CORE_DIR: String = "res://core"


static func _collect(dir: String, out: PackedStringArray) -> void:
	for file_name: String in DirAccess.get_files_at(dir):
		if file_name.ends_with(".gd"):
			out.append(dir + "/" + file_name)
	for child: String in DirAccess.get_directories_at(dir):
		_collect(dir + "/" + child, out)


func test_core_log_debug_calls_are_the_removal_form() -> void:
	var removal: RegEx = RegEx.create_from_string("^[ \\t]*LogCore\\.log_debug\\(.*\\)[ \\t]*$")
	var declaration: RegEx = RegEx.create_from_string("^static func log_debug\\(")
	var files: PackedStringArray = PackedStringArray()
	_collect(CORE_DIR, files)
	if files.is_empty():
		pass_test("no GDScript source files in this run")
		return
	var wrong: PackedStringArray = PackedStringArray()
	for path: String in files:
		if path == SELF:
			continue
		var lines: PackedStringArray = FileAccess.get_file_as_string(path).split("\n")
		for i: int in lines.size():
			var line: String = lines[i]
			if not line.contains("log_debug") or line.strip_edges().begins_with("#"):
				continue
			if removal.search(line) == null and declaration.search(line) == null:
				wrong.append("%s:%d" % [path, i + 1])
	assert_eq(wrong, PackedStringArray())
