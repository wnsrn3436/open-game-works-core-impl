extends UnitTestCase
## Sample test file of the nested runs: `set_test_settings` and the next test, an unknown key, values of another
## type than the key's type in the core settings type file (an array element, an object, `null`, a value for a `?`
## type), and values of the key's type; `set_invalid_test_settings` with values of another type and the next test,
## and an unknown key; a key of the settings file that the type file does not have, and a type file type that is no
## settings type.

const KEY: String = "UnitTestCore.testTimeLimitMs"
const VALUE: int = 4321
## A number key whose settings file value is not whole, and an integer array key.
const NUMBER_KEY: String = "UICore.dimOpacity"
const INT_ARRAY_KEY: String = "ResolutionCore.fillColor"
## Object keys: string member values, and number array member values.
const STRING_MAP_KEY: String = "environments.DEV.adapters"
const MATRICES_KEY: String = "AccessibilityCore.colorMatrices"
## An `array<object>` key, and an `integer?` key.
const OBJECT_ARRAY_KEY: String = "QualityCore.deviceClasses"
const NULLABLE_INT_KEY: String = "consent.minimumAge"


func test_a_sets_a_value() -> void:
	assert_true(UnitTestCore.set_test_settings(KEY, VALUE))
	assert_eq(CoreSettings.get_int(KEY), VALUE)


func test_b_reads_the_value_without_it() -> void:
	assert_true(CoreSettings.has_int(KEY))
	assert_ne(CoreSettings.get_int(KEY), VALUE)


func test_c_unknown_key() -> void:
	assert_true(LogCore.init(), "LogCore.init")
	assert_false(UnitTestCore.set_test_settings("UnitTestCore.noSuchKey", 1))
	assert_eq(UnitTestCore.check_logs("error", "UnitTestCore"), 1)


func test_d_value_of_another_type() -> void:
	assert_true(LogCore.init(), "LogCore.init")
	assert_false(UnitTestCore.set_test_settings(KEY, "text"))
	assert_eq(UnitTestCore.check_logs("error", "UnitTestCore"), 1)
	assert_ne(CoreSettings.get_int(KEY), 0)


func test_e_fraction_for_an_integer_key() -> void:
	assert_true(LogCore.init(), "LogCore.init")
	assert_false(UnitTestCore.set_test_settings(KEY, 1.5))
	assert_eq(UnitTestCore.check_logs("error", "UnitTestCore"), 1)
	assert_true(CoreSettings.has_int(KEY), "the key keeps an integer value")


func test_f_array_element_of_another_type() -> void:
	assert_true(LogCore.init(), "LogCore.init")
	assert_false(UnitTestCore.set_test_settings(INT_ARRAY_KEY, [1, "a", 3]))
	assert_eq(UnitTestCore.check_logs("error", "UnitTestCore"), 1)


func test_g_values_of_the_type_of_the_key() -> void:
	assert_true(UnitTestCore.set_test_settings(KEY, 4321.0), "a whole float for an integer key")
	assert_eq(CoreSettings.get_int(KEY), VALUE)
	assert_true(UnitTestCore.set_test_settings(NUMBER_KEY, 1), "an integer for a number key")
	assert_true(UnitTestCore.set_test_settings(NUMBER_KEY, 0.25), "a fraction for a number key")
	assert_eq(CoreSettings.get_float(NUMBER_KEY), 0.25)
	assert_true(UnitTestCore.set_test_settings(INT_ARRAY_KEY, PackedInt64Array([4, 5, 6])), "an integer array")


func test_h_invalid_values_of_another_type() -> void:
	assert_true(UnitTestCore.set_invalid_test_settings(KEY, "text"), "a string for an integer key")
	assert_false(CoreSettings.has_int(KEY), "the key has no integer value")
	assert_eq(CoreSettings.get_json(KEY), '"text"')
	assert_true(UnitTestCore.set_invalid_test_settings(INT_ARRAY_KEY, [1, "a", 3]), "an array element of another type")
	assert_false(CoreSettings.has_int_array(INT_ARRAY_KEY), "the key has no integer array value")
	assert_true(UnitTestCore.set_invalid_test_settings(KEY, VALUE), "a value of the type of the key")
	assert_eq(CoreSettings.get_int(KEY), VALUE)
	assert_true(UnitTestCore.set_invalid_test_settings(NUMBER_KEY, null), "null")
	assert_eq(CoreSettings.get_json(NUMBER_KEY), "null")


func test_i_reads_the_values_without_the_invalid_ones() -> void:
	assert_true(CoreSettings.has_int(KEY))
	assert_ne(CoreSettings.get_int(KEY), VALUE)
	assert_true(CoreSettings.has_int_array(INT_ARRAY_KEY))
	assert_true(CoreSettings.has_float(NUMBER_KEY))


func test_j_invalid_unknown_key() -> void:
	assert_true(LogCore.init(), "LogCore.init")
	assert_false(UnitTestCore.set_invalid_test_settings("UnitTestCore.noSuchKey", "text"))
	assert_eq(UnitTestCore.check_logs("error", "UnitTestCore"), 1)
	assert_false(CoreSettings.has_key("UnitTestCore.noSuchKey"), "no test value")


func test_k_string_for_an_object_key() -> void:
	assert_true(LogCore.init(), "LogCore.init")
	assert_false(UnitTestCore.set_test_settings(STRING_MAP_KEY, "ads-admob"))
	assert_eq(UnitTestCore.check_logs("error", "UnitTestCore"), 1)
	assert_true(CoreSettings.has_string_map(STRING_MAP_KEY), "the key keeps a string map value")


func test_l_array_element_that_is_no_object() -> void:
	assert_true(LogCore.init(), "LogCore.init")
	assert_false(UnitTestCore.set_test_settings(OBJECT_ARRAY_KEY, [{"level": "High"}, 5]))
	assert_eq(UnitTestCore.check_logs("error", "UnitTestCore"), 1)


func test_m_objects_of_the_type_of_the_key() -> void:
	assert_true(UnitTestCore.set_test_settings(STRING_MAP_KEY, {"ads": "ads-admob"}), "a string map")
	assert_eq(CoreSettings.get_string_map(STRING_MAP_KEY), {"ads": "ads-admob"})
	assert_true(UnitTestCore.set_test_settings(STRING_MAP_KEY, {}), "an empty object")
	assert_true(UnitTestCore.set_test_settings(STRING_MAP_KEY, {"ads": 5}), "an object with a number member")
	var matrices: Dictionary[String, PackedFloat64Array] = {"Protanopia": PackedFloat64Array([1.0, 0.5])}
	assert_true(UnitTestCore.set_test_settings(MATRICES_KEY, matrices), "number arrays")
	assert_true(UnitTestCore.set_test_settings(MATRICES_KEY, {"Protanopia": [1, "a"]}), "an object with other members")


func test_n_null_for_a_key_whose_type_has_no_question_mark() -> void:
	assert_true(LogCore.init(), "LogCore.init")
	assert_false(UnitTestCore.set_test_settings(NUMBER_KEY, null))
	assert_eq(UnitTestCore.check_logs("error", "UnitTestCore"), 1)
	assert_true(CoreSettings.has_float(NUMBER_KEY), "the key keeps a number value")


func test_o_string_for_a_nullable_integer_key() -> void:
	assert_true(LogCore.init(), "LogCore.init")
	assert_false(UnitTestCore.set_test_settings(NULLABLE_INT_KEY, "18"))
	assert_eq(UnitTestCore.check_logs("error", "UnitTestCore"), 1)


## `NUMBER_KEY` is in the settings file but not in the type file during the calls.
func test_p_key_of_the_settings_file_only() -> void:
	assert_true(LogCore.init(), "LogCore.init")
	var settings_type: String = UnitTestCore._settings_types[NUMBER_KEY]
	assert_true(UnitTestCore._settings_types.erase(NUMBER_KEY))
	assert_false(UnitTestCore.set_test_settings(NUMBER_KEY, 0.5), "set_test_settings")
	assert_false(UnitTestCore.set_invalid_test_settings(NUMBER_KEY, "text"), "set_invalid_test_settings")
	UnitTestCore._settings_types[NUMBER_KEY] = settings_type
	assert_eq(UnitTestCore.check_logs("error", "UnitTestCore"), 2)
	assert_true(CoreSettings.has_float(NUMBER_KEY), "no test value")


## The type file gives `KEY` the type `int` during the calls.
func test_q_type_file_type_that_is_no_settings_type() -> void:
	assert_true(LogCore.init(), "LogCore.init")
	var settings_type: String = UnitTestCore._settings_types[KEY]
	UnitTestCore._settings_types[KEY] = "int"
	assert_false(UnitTestCore.set_test_settings(KEY, VALUE), "set_test_settings")
	assert_true(UnitTestCore.set_invalid_test_settings(KEY, VALUE), "set_invalid_test_settings does not check the type")
	UnitTestCore._settings_types[KEY] = settings_type
	assert_eq(UnitTestCore.check_logs("error", "UnitTestCore"), 1)
