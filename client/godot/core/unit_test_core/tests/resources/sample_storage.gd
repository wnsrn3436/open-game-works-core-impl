extends UnitTestCase
## Sample test file of the nested runs: the first test writes an app storage file, the second looks for it.

const DIR: String = "user://unit_test_core_sample"
const FILE: String = "user://unit_test_core_sample/written.txt"


func test_a_writes_a_file() -> void:
	assert_eq(DirAccess.make_dir_recursive_absolute(DIR), OK, "make the folder")
	var file: FileAccess = FileAccess.open(FILE, FileAccess.WRITE)
	assert_not_null(file, "open the file")
	if file == null:
		return
	assert_true(file.store_string("written"), "write the file")
	file.close()
	assert_true(FileAccess.file_exists(FILE))


func test_b_does_not_find_it() -> void:
	assert_false(FileAccess.file_exists(FILE), "file of the test before")
	assert_false(DirAccess.dir_exists_absolute(DIR), "folder of the test before")
