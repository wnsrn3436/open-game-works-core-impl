extends RefCounted
## Static hooks of the ShortcutCore core tests: param builders, `RequirementCore` judge hooks and a guide argument
## hook. They record their calls in the trace and do what the static test config says.

const Trace := preload("res://core/shortcut_core/tests/support/shortcut_trace.gd")
const TestParam := preload("res://core/shortcut_core/tests/support/shortcut_test_param.gd")

## Format argument name and value the guide argument hook puts.
const GUIDE_ARG_NAME: String = "count"
const GUIDE_ARG_VALUE: int = 3

## Rows the param builders got, in call order.
static var builder_rows: Array[GameData.ShortcutRow] = []
## Params the param builders returned by short panel name.
static var built: Dictionary[String, UIParam] = {}
## The param builders return `null`.
static var builder_returns_none: bool = false
## Results of the judge hooks of `FlagA`, `FlagB` and `FlagC`.
static var flag_a: bool = true
static var flag_b: bool = false
static var flag_c: bool = false


static func reset() -> void:
	builder_rows = []
	built = {}
	builder_returns_none = false
	flag_a = true
	flag_b = false
	flag_c = false


## Param builders of the test panels B, C, D and R. Each records `builder:<panel>:<is_target>`.
static func build_b(row: GameData.ShortcutRow, is_target: bool) -> UIParam:
	return _build("b", row, is_target)


static func build_c(row: GameData.ShortcutRow, is_target: bool) -> UIParam:
	return _build("c", row, is_target)


static func build_d(row: GameData.ShortcutRow, is_target: bool) -> UIParam:
	return _build("d", row, is_target)


static func build_r(row: GameData.ShortcutRow, is_target: bool) -> UIParam:
	return _build("r", row, is_target)


## Param builder that returns a `RefCounted` that is not a `UIParam`.
static func build_wrong_type(_row: GameData.ShortcutRow, _is_target: bool) -> RefCounted:
	Trace.add("builder:wrong_type")
	return RefCounted.new()


## Param builder that throws: it stops on a GDScript runtime error, an out-of-bounds read, after its trace entry.
static func build_throwing(_row: GameData.ShortcutRow, _is_target: bool) -> UIParam:
	Trace.add("builder:throwing")
	var none: Array[UIParam] = []
	return none[0]


static func judge_a(_row: GameData.RequirementRow) -> bool:
	Trace.add("judge:a")
	return flag_a


static func judge_b(_row: GameData.RequirementRow) -> bool:
	Trace.add("judge:b")
	return flag_b


static func judge_c(_row: GameData.RequirementRow) -> bool:
	Trace.add("judge:c")
	return flag_c


## Guide argument hook of `FlagB`.
static func guide_args(_row: GameData.RequirementRow, args: FormatArgs) -> void:
	Trace.add("guide_args")
	args.set_int(GUIDE_ARG_NAME, GUIDE_ARG_VALUE)


static func _build(panel: String, row: GameData.ShortcutRow, is_target: bool) -> UIParam:
	builder_rows.append(row)
	Trace.add("builder:%s:%s" % [panel, is_target])
	if builder_returns_none:
		return null
	var param: TestParam = TestParam.new()
	param.panel = panel
	param.is_target = is_target
	built[panel] = param
	return param
