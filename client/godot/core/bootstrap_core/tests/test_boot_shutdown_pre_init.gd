extends UnitTestCase
## DEV `shutdown` between tests and the values that operations called before `init` set: a value one test set before
## `init` of a module that it did not `init` does not reach the next test. The two tests run in this order; the second
## reads what the first left, after the `shutdown` of its test setup.

const _TEST_LOCATION: String = "res://core/bootstrap_core/tests/resources/no_data/"
const _TEST_KEY: String = "test/shutdown_pre_init"
const _TEST_PATH: String = "res://core/bootstrap_core/tests/resources/boot_test_first.tscn"
## The generated resource key list file. The core project has none.
const _KEY_LIST_FILE: String = "res://generated/resource_keys.json"

## The built-in data location `DataCore` read before the first test set its test location: the default location.
static var _default_location: String = ""
## Whether the first test set the values; the second test needs it.
static var _first_ran: bool = false


func test_1_values_set_before_init_by_a_test_that_ends_without_init() -> void:
	assert_false(DataCore.is_initialized())
	assert_false(ResourceCore.is_initialized())
	_default_location = DataCore.get_builtin_location()
	assert_ne(_default_location, _TEST_LOCATION)
	DataCoreDev.set_test_data_location(_TEST_LOCATION)
	var keys: Dictionary[String, String] = {_TEST_KEY: _TEST_PATH}
	ResourceCoreDev.set_test_key_list(keys)
	assert_eq(DataCore.get_builtin_location(), _TEST_LOCATION)
	_first_ran = true


func test_2_next_test_reads_the_default_data_location_and_the_generated_key_list() -> void:
	assert_true(_first_ran, "the first test of this file ran before this one")
	assert_eq(DataCore.get_builtin_location(), _default_location)
	# ResourceCore reads the generated key list file, which the core project does not have, and not the test list of
	# the first test: its `init` fails with one error log.
	assert_false(FileAccess.file_exists(_KEY_LIST_FILE), "the core project has no resource key list file")
	assert_true(LogCore.init())
	assert_false(ResourceCore.init(), "init reads the generated key list file, not the list of the first test")
	assert_eq(UnitTestCore.check_logs("error", "ResourceCore"), 1)
	assert_false(ResourceCore.is_initialized())
