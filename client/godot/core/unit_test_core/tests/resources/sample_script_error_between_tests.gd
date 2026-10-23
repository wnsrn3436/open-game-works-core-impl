extends UnitTestCase
## Sample test file of the nested runs: an engine script runtime error after the end checks of the first test, before
## the setup of the second.

var _values: Array[int] = []


func after_each() -> void:
	await super()
	if _values.is_empty():
		_stop()
		_values.append(1)


func test_a_passes() -> void:
	assert_true(true)


func test_b_runs_after_it() -> void:
	assert_true(true)


## Stops on a GDScript runtime error: an index out of range.
func _stop() -> int:
	return _values[3]
