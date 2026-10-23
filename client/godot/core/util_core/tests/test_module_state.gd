extends UnitTestCase
## UtilCore has no module state, no lifecycle and no log call.

const _UTIL_CORE := preload("res://core/util_core/util_core.gd")
const _UTIL_RANDOM := preload("res://core/util_core/util_random.gd")
const _UTIL_BIG_INTEGER := preload("res://core/util_core/util_big_integer.gd")
const _UTIL_STATE_MACHINE := preload("res://core/util_core/util_state_machine.gd")
const _UTIL_STATE_CALLBACKS := preload("res://core/util_core/util_state_callbacks.gd")
const _UTIL_STATE_TRANSITION := preload("res://core/util_core/util_state_transition.gd")
const _APPLY_PERMILLE_RESULT := preload("res://core/util_core/apply_permille_result.gd")
const _BIG_TO_INT_RESULT := preload("res://core/util_core/big_to_int_result.gd")
const _BIG_COMPARE_RESULT := preload("res://core/util_core/big_compare_result.gd")
const _SCRIPTS: Array[Script] = [
	_UTIL_CORE,
	_UTIL_RANDOM,
	_UTIL_BIG_INTEGER,
	_UTIL_STATE_MACHINE,
	_UTIL_STATE_CALLBACKS,
	_UTIL_STATE_TRANSITION,
	_APPLY_PERMILLE_RESULT,
	_BIG_TO_INT_RESULT,
	_BIG_COMPARE_RESULT,
]
const _LOG_CALLS: PackedStringArray = [
	"LogCore", "print(", "printerr(", "prints(", "printt(", "print_rich(", "print_verbose(", "push_error(", "push_warning("
]
const _LIFECYCLE: PackedStringArray = ["init", "release", "is_initialized"]


## Names of the static vars of a script.
# ogw:input_boundary
static func _static_vars(script: Script) -> PackedStringArray:
	var names: PackedStringArray = PackedStringArray()
	for property: Dictionary in script.get_property_list():
		var usage: int = property.get("usage", 0)
		if usage & PROPERTY_USAGE_SCRIPT_VARIABLE:
			names.append(str(property.get("name", "")))
	return names


## Names of the methods a script declares.
# ogw:input_boundary
static func _method_names(script: Script) -> PackedStringArray:
	var names: PackedStringArray = PackedStringArray()
	for method: Dictionary in script.get_script_method_list():
		names.append(str(method.get("name", "")))
	return names


func test_no_static_var_in_the_module_folder() -> void:
	for script: Script in _SCRIPTS:
		assert_eq(_static_vars(script), PackedStringArray(), script.resource_path)


func test_no_lifecycle() -> void:
	var names: PackedStringArray = _method_names(_SCRIPTS[0])
	assert_true(names.has("floor_div"))
	for lifecycle: String in _LIFECYCLE:
		assert_false(names.has(lifecycle), lifecycle)


func test_no_log_call_in_the_module_folder() -> void:
	for script: Script in _SCRIPTS:
		if not script.has_source_code():
			pass_test("source not in this run: " + script.resource_path)
			continue
		var source: String = script.source_code
		for log_call: String in _LOG_CALLS:
			assert_false(source.contains(log_call), script.resource_path + " " + log_call)


func test_failures_leave_no_log() -> void:
	var random: UtilRandom = UtilCore.create_random(1)
	var none: Array[UtilStateTransition] = []
	var empty: Dictionary[int, UtilStateCallbacks] = {}
	assert_eq(UtilCore.floor_div(1, 0), 0)
	assert_eq(UtilCore.floor_mod(1, 0), 0)
	assert_eq(UtilCore.clamp_int(1, 3, 2), 3)
	assert_false(UtilCore.apply_permille(9223372036854775807, 2).ok)
	assert_false(UtilCore.big_to_int("x").ok)
	assert_false(UtilCore.big_compare("x", "1").ok)
	assert_eq(UtilCore.big_add("x", "1"), "")
	assert_eq(UtilCore.big_floor_div("1", "0"), "")
	assert_eq(UtilCore.big_apply_permille("x", 1), "")
	assert_eq(UtilCore.range_int(random, 2, 1), 2)
	assert_eq(UtilCore.shuffle_indices(random, -1), PackedInt64Array())
	assert_eq(UtilCore.pick_weighted(random, PackedInt64Array([-1])), -1)
	assert_null(UtilCore.create_state_machine(PackedInt64Array(), none, 0, empty))
	var machine: UtilStateMachine = UtilCore.create_state_machine(PackedInt64Array([0]), none, 0, empty)
	assert_false(UtilCore.change_state(machine, 1))
	assert_false(UtilCore.is_snake_case(""))
