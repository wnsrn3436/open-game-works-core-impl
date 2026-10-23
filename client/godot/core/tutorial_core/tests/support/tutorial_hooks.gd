extends RefCounted
## Static `RequirementCore` judge hooks of the TutorialCore core tests and the results they return.

## Result of the `FlagA` judge.
static var flag_a: bool = false
## Server time at which the time-dependent `FlagB` judge passes. 0 never passes.
static var flag_b_at: int = 0


static func reset() -> void:
	flag_a = false
	flag_b_at = 0


static func judge_flag_a(_row: GameData.RequirementRow) -> bool:
	return flag_a


static func judge_flag_b(_row: GameData.RequirementRow) -> bool:
	return flag_b_at > 0 and TimeCore.is_synced() and TimeCore.get_server_time() >= flag_b_at
