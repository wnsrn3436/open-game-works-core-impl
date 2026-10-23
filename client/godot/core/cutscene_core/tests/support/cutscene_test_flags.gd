extends RefCounted
## The judge hooks of the core tests: the requirement types `FlagA`, `FlagB` and `FlagC` of the core test data pass when
## their flag is true.

static var flag_a: bool = false
static var flag_b: bool = false
static var flag_c: bool = false


static func reset() -> void:
	flag_a = false
	flag_b = false
	flag_c = false


static func judge_a(_row: GameData.RequirementRow) -> bool:
	return flag_a


static func judge_b(_row: GameData.RequirementRow) -> bool:
	return flag_b


static func judge_c(_row: GameData.RequirementRow) -> bool:
	return flag_c
