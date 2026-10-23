extends "res://core/time_core/tests/support/time_test_case.gd"
## Game day and reset cycle boundaries, `get_current_day` and `DayChangedEvent`.

## Offsets of the boundary tests: 0, positive and the negative offset of UTC+9 midnight.
const OFFSETS: PackedInt64Array = [0, 5 * 3600000, -9 * 3600000]


## One case of core test fixture `reset-time`.
class ResetCase:
	extends RefCounted
	var name: String = ""
	var offset_ms: int = 0
	var cycle: GameData.ResetCycle = GameData.ResetCycle.NONE
	var time: int = 0
	var day_number: int = 0
	var period_start: int = 0
	var next_reset: int = 0


func test_reset_time_fixture_cases() -> void:
	assert_true(LogCore.init())
	var cases: Array[ResetCase] = _read_reset_cases(UnitTestCore.read_core_fixture("reset-time"))
	assert_gt(cases.size(), 0)
	for case: ResetCase in cases:
		reinit_with_offset(case.offset_ms)
		assert_eq(TimeCore.get_day_number(case.time), case.day_number, "%s day_number" % case.name)
		assert_eq(TimeCore.get_period_start(case.cycle, case.time), case.period_start, "%s period_start" % case.name)
		assert_eq(TimeCore.get_next_reset(case.cycle, case.time), case.next_reset, "%s next_reset" % case.name)


func test_none_cycle_gives_0_and_a_non_element_fails() -> void:
	init_modules()
	assert_eq(TimeCore.get_period_start(GameData.ResetCycle.NONE, SERVER_TIME), 0)
	assert_eq(TimeCore.get_next_reset(GameData.ResetCycle.NONE, SERVER_TIME), 0)
	assert_eq(TimeCore.get_period_start(99 as GameData.ResetCycle, SERVER_TIME), 0)
	assert_eq(TimeCore.get_next_reset(99 as GameData.ResetCycle, SERVER_TIME), 0)
	assert_eq(UnitTestCore.check_logs(ERROR, TAG), 2)


func test_day_start_next_boundary_and_same_day_around_the_boundary() -> void:
	assert_true(LogCore.init())
	for offset: int in OFFSETS:
		reinit_with_offset(offset)
		var b: int = boundary(offset)
		var label: String = "offset %d" % offset
		assert_eq(TimeCore.get_day_start(b - 1), (b - 1) - UtilCore.floor_mod(b - 1 - offset, DAY_MS), label)
		assert_eq(TimeCore.get_day_start(b - 1), b - DAY_MS, label)
		assert_eq(TimeCore.get_day_start(b), b, label)
		assert_eq(TimeCore.get_next_day_boundary(b - 1), b, label)
		assert_eq(TimeCore.get_next_day_boundary(b), b + DAY_MS, label)
		assert_false(TimeCore.is_same_day(b - 1, b), label)
		assert_true(TimeCore.is_same_day(b, b + DAY_MS - 1), label)
		assert_true(TimeCore.is_same_day(b - DAY_MS, b - 1), label)
		assert_eq(TimeCore.get_day_number(b) - TimeCore.get_day_number(b - 1), 1, label)


func test_current_day_changes_at_boundary_plus_margin() -> void:
	init_modules()
	var b: int = boundary(0)
	sync_to(b + MARGIN_MS - 1)
	assert_eq(TimeCore.get_current_day(), b - DAY_MS)
	advance(1)
	assert_eq(TimeCore.get_current_day(), b)


func test_current_day_uses_the_offset() -> void:
	set_int("dailyResetOffsetMs", -9 * 3600000)
	init_modules()
	var b: int = boundary(-9 * 3600000)
	sync_to(b + MARGIN_MS - 1)
	assert_eq(TimeCore.get_current_day(), b - DAY_MS)
	advance(1)
	assert_eq(TimeCore.get_current_day(), b)


func test_day_changed_event() -> void:
	init_with_recorder()
	var b: int = boundary(0)
	sync_to(b + MARGIN_MS - 1)
	assert_eq(recorder.count("day"), 0, "the first sync does not publish")
	advance(1)
	assert_eq(recorder.day_starts, PackedInt64Array([b]), "once at boundary + margin")
	advance(1000)
	assert_eq(recorder.count("day"), 1, "no event inside the day")
	sync_to(b + 3 * DAY_MS + MARGIN_MS)
	assert_eq(recorder.day_starts, PackedInt64Array([b, b + 3 * DAY_MS]), "once for a sync over 3 days")
	sync_to(b + 3 * DAY_MS + MARGIN_MS - 1)
	assert_eq(recorder.day_starts, PackedInt64Array([b, b + 3 * DAY_MS, b + 2 * DAY_MS]), "once for a sync back")
	await UnitTestCore.wait_frames(2)
	assert_eq(recorder.count("day"), 3, "the frame checks do not publish again")


func test_no_day_check_before_the_first_sync() -> void:
	init_with_recorder()
	advance(2 * DAY_MS)
	await UnitTestCore.wait_frames(2)
	assert_eq(recorder.count("day"), 0)


# ogw:input_boundary
func _read_reset_cases(text: String) -> Array[ResetCase]:
	var cases: Array[ResetCase] = []
	var root: Variant = JSON.parse_string(text)
	if not root is Dictionary:
		fail_test("reset-time is not a JSON object")
		return cases
	var root_dict: Dictionary = root
	var items: Variant = root_dict.get("cases")
	if not items is Array:
		fail_test("reset-time has no cases")
		return cases
	var item_list: Array = items
	for item: Variant in item_list:
		if not item is Dictionary:
			fail_test("a reset-time case is not an object")
			continue
		var case_dict: Dictionary = item
		var input: Dictionary = case_dict.get("input", {})
		var expected: Dictionary = case_dict.get("expected", {})
		var case: ResetCase = ResetCase.new()
		case.name = str(case_dict.get("name", ""))
		case.offset_ms = _int_of(input.get("offset_ms"))
		case.cycle = _cycle_of(str(input.get("cycle", "")))
		case.time = _int_of(input.get("time"))
		case.day_number = _int_of(expected.get("day_number"))
		case.period_start = _int_of(expected.get("period_start"))
		case.next_reset = _int_of(expected.get("next_reset"))
		cases.append(case)
	return cases


# ogw:input_boundary
func _int_of(value: Variant) -> int:
	if value is int:
		return value
	if value is float:
		var number: float = value
		return int(number)
	if value is String:
		var text: String = value
		if text.is_valid_int():
			return text.to_int()
	fail_test("not an integer in reset-time")
	return 0


func _cycle_of(element: String) -> GameData.ResetCycle:
	match element:
		"Daily":
			return GameData.ResetCycle.DAILY
		"Weekly":
			return GameData.ResetCycle.WEEKLY
		"Monthly":
			return GameData.ResetCycle.MONTHLY
	fail_test("unknown ResetCycle element %s" % element)
	return GameData.ResetCycle.NONE
