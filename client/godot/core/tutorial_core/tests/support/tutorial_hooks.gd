extends RefCounted
## Static `RequirementCore` judge hooks of the TutorialCore core tests and the results they return.

## Result of the `FlagA` judge.
static var flag_a: bool = false
## Server time at which the time-dependent `FlagB` judge passes. 0 never passes.
static var flag_b_at: int = 0
## Number of the `can_start_not_bool` calls.
static var not_bool_calls: int = 0


static func reset() -> void:
	flag_a = false
	flag_b_at = 0
	not_bool_calls = 0


static func judge_flag_a(_row: GameData.RequirementRow) -> bool:
	return flag_a


static func judge_flag_b(_row: GameData.RequirementRow) -> bool:
	return flag_b_at > 0 and TimeCore.is_synced() and TimeCore.get_server_time() >= flag_b_at


## A `can_start_tutorial` hook that returns an `int`, not a `bool`, and counts its calls.
static func can_start_not_bool(_tutorial_id: int) -> int:
	not_bool_calls += 1
	return 1
