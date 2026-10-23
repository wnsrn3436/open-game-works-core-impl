extends UnitTestCase
## `format` and `get_text`: the core test fixture `text-format`, the timezone offset, error slots, the length limit.

const _SUPPORT := preload("res://core/localization_core/tests/support/localization_test_support.gd")
const _KEY: String = _SUPPORT.TEXT_KEY
const _HOUR_MS: int = 3600000


func after_each() -> void:
	super()
	_SUPPORT.stop()


## Starts with the current language `code` for the culture rule, the device timezone offset 0 and `text` at `_KEY`.
func _start_text(code: String, text: String) -> void:
	assert_ne(await _SUPPORT.start_language("en"), 0)
	LocalizationCore._language_code = code
	LocalizationCore._test_timezone_offset_set = true
	LocalizationCore._test_timezone_offset_ms = 0
	_SUPPORT.put_text(_KEY, text)


func _dev(slot: String) -> String:
	return "‼ " + slot if CoreBuildInfo.has_dev_code else ""


## Runs every case of the core test fixture `text-format`; the number of cases.
# ogw:input_boundary
func _run_fixture() -> int:
	var parsed: Variant = JSON.parse_string(UnitTestCore.read_core_fixture("text-format"))
	if not parsed is Dictionary:
		return 0
	var root: Dictionary = parsed
	if not root.has("cases") or not root["cases"] is Array:
		return 0
	var items: Array = root["cases"]
	for item: Variant in items:
		var case: Dictionary = item
		_run_case(case)
	return items.size()


# ogw:input_boundary
func _run_case(case: Dictionary) -> void:
	var input: Dictionary = case["input"]
	var kind: String = input["kind"]
	var value: String = input["value"]
	var text: String = input["text"]
	var language: String = input["language"]
	var expected: Variant = case["expected"]
	var case_name: String = case["name"]
	LocalizationCore._language_code = language
	_SUPPORT.put_text(_KEY, text)
	var args: FormatArgs = FormatArgs.new()
	match kind:
		"int":
			args.set_int("v", value.to_int())
		"float":
			args.set_float("v", NAN if value == "NaN" else value.to_float())
		_:
			args.set_string("v", value)
	var result: String = LocalizationCore.format(_KEY, args)
	if expected is String:
		var text_expected: String = expected
		assert_eq(result, text_expected, case_name)
	else:
		assert_eq(result, _dev(text), case_name)
		assert_eq(_SUPPORT.errors(), 1, case_name)


func test_text_format_fixture() -> void:
	await _start_text("en", "")
	assert_gt(_run_fixture(), 0)


func test_date_with_a_9_hour_timezone_offset_is_the_date_9_hours_later_at_offset_0() -> void:
	await _start_text("ja", "{v:datetime}")
	var args: FormatArgs = FormatArgs.new()
	var time: int = 1704442140000
	args.set_int("v", time + 9 * _HOUR_MS)
	var later_at_zero: String = LocalizationCore.format(_KEY, args)
	LocalizationCore._test_timezone_offset_ms = 9 * _HOUR_MS
	args.set_int("v", time)
	assert_eq(LocalizationCore.format(_KEY, args), later_at_zero)
	assert_eq(later_at_zero, "2024/01/05 17:09")
	_SUPPORT.put_text(_KEY, "{v:date}")
	args.set_int("v", 1704495540000)
	assert_eq(LocalizationCore.format(_KEY, args), "2024/01/06")


func test_format_keeps_the_format_args() -> void:
	await _start_text("en", "{a:n} {b} {c:이/가}")
	var args: FormatArgs = FormatArgs.new()
	args.set_int("a", 1234)
	args.set_float("b", 2.5)
	args.set_string("c", "Sam")
	assert_eq(LocalizationCore.format(_KEY, args), "1,234 2.5 Sam이")
	assert_eq(args._kinds.size(), 3)
	assert_eq(args._ints["a"], 1234)
	assert_eq(args._floats["b"], 2.5)
	assert_eq(args._strings["c"], "Sam")
	assert_eq(LocalizationCore.format(_KEY, args), "1,234 2.5 Sam이")
	args.set_int("a", 5)
	assert_eq(LocalizationCore.format(_KEY, args), "5 2.5 Sam이")
	args.clear()
	assert_true(args._kinds.is_empty())


func test_error_slots_are_empty_and_logged_each_time() -> void:
	await _start_text("en", "a{x}b{v:nope}c{v:ordinal}d{ v }e{v")
	var args: FormatArgs = FormatArgs.new()
	args.set_float("v", 1.5)
	var expected: String = "a" + _dev("{x}") + "b" + _dev("{v:nope}") + "c" + _dev("{v:ordinal}") + "d" + _dev("{ v }") + "e" + _dev("{v")
	assert_eq(LocalizationCore.format(_KEY, args), expected)
	assert_eq(_SUPPORT.errors(), 5)
	assert_eq(LocalizationCore.get_text(_KEY), "a" + _dev("{x}") + "b" + _dev("{v:nope}") + "c" + _dev("{v:ordinal}") + "d" + _dev("{ v }") + "e" + _dev("{v"))
	assert_eq(_SUPPORT.errors(), 5)


func test_unpaired_braces() -> void:
	await _start_text("en", "}{v}} {{v} {v")
	var args: FormatArgs = FormatArgs.new()
	args.set_int("v", 7)
	assert_eq(LocalizationCore.format(_KEY, args), "}7} " + _dev("{") + "7 " + _dev("{v"))
	assert_eq(_SUPPORT.errors(), 2)


func test_real_without_a_fraction_formats_as_an_integer() -> void:
	await _start_text("en", "{v} {v:ordinal} {v:compact}")
	var args: FormatArgs = FormatArgs.new()
	args.set_float("v", 1234.0)
	assert_eq(LocalizationCore.format(_KEY, args), "1234 1234th 1.23K")


func test_integer_minimum_formats_as_the_maximum() -> void:
	await _start_text("en", "{v}")
	var args: FormatArgs = FormatArgs.new()
	args.set_int("v", -9223372036854775807 - 1)
	assert_eq(LocalizationCore.format(_KEY, args), "9223372036854775807")


func test_result_longer_than_the_limit_drops_pieces_from_the_one_that_goes_over() -> void:
	assert_true(UnitTestCore.set_test_settings("LocalizationCore.maxFormattedLength", 5))
	await _start_text("en", "ab{v}cdef")
	var args: FormatArgs = FormatArgs.new()
	args.set_string("v", "xyz")
	assert_eq(LocalizationCore.format(_KEY, args), "abxyz")
	assert_eq(_SUPPORT.errors(), 1)
	_SUPPORT.put_text(_KEY, "😀😀😀{v}")
	args.set_string("v", "12")
	assert_eq(LocalizationCore.format(_KEY, args), "😀😀😀12")
	args.set_string("v", "123")
	assert_eq(LocalizationCore.format(_KEY, args), "😀😀😀")
	assert_eq(_SUPPORT.errors(), 1)
	_SUPPORT.put_text(_KEY, "abcdef")
	assert_eq(LocalizationCore.get_text(_KEY), "")
	assert_eq(_SUPPORT.errors(), 1)


func test_inline_icon_counts_as_one_for_the_limit() -> void:
	assert_true(UnitTestCore.set_test_settings("LocalizationCore.maxFormattedLength", 5))
	await _start_text("en", "{action:back}abcd")
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	assert_true(await LocalizationCore.load_prompt_icons())
	var icon: String = "[img=0x10]" + _SUPPORT.RESOURCES + "key_escape.tres[/img]"
	assert_eq(LocalizationCore.get_text(_KEY, 10), icon + "abcd")
	_SUPPORT.put_text(_KEY, "{action:back}abcde")
	assert_eq(LocalizationCore.get_text(_KEY, 10), icon)
	assert_eq(_SUPPORT.errors(), 1)
