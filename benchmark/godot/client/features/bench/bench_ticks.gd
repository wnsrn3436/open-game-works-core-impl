class_name BenchTicks
extends RefCounted
## The tick count of the user, read from the `BenchUserState` cache.


## The tick count the server recorded. 0 before the first tick.
static func current() -> int:
	var state: GameContract.BenchUserState = UserStateCore.get_single(GameContract.BenchUserState) as GameContract.BenchUserState
	if state == null:
		return 0
	return state.tick_count


## Whether the server takes one more tick: the count is below `[tick_count_max]`.
static func can_record(count: int) -> bool:
	return count >= 0 and count < GameSetting.tick_count_max()
