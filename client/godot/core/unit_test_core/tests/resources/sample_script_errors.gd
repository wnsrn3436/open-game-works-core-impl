extends UnitTestCase
## Sample test file of the nested runs: an unchecked engine script runtime error, two checked ones, and none.

var _values: Array[int] = []


func test_unchecked_script_error() -> void:
	_stop()


func test_checked_script_errors() -> void:
	_stop()
	_stop()
	assert_eq(UnitTestCore.check_script_errors(), 2)
	assert_eq(UnitTestCore.check_script_errors(), 0, "checked errors are not counted again")


func test_no_script_error() -> void:
	assert_eq(UnitTestCore.check_script_errors(), 0)


## Stops on a GDScript runtime error: an index out of range.
func _stop() -> int:
	return _values[3]
