extends RefCounted
## Result of one match that `join_match`, `rejoin_match`, `start_room` and `wait_match` wait for.

signal finished

var done: bool = false
var status: RealtimeCore.MatchJoinStatus = RealtimeCore.MatchJoinStatus.FAILED
var fail_reason: CoreContract.MatchFailReason = CoreContract.MatchFailReason.MATCH_FAIL_REASON_UNSPECIFIED
var error_code: int = 0


## Sets the result once and wakes the waiting operations.
func finish(result_status: RealtimeCore.MatchJoinStatus, reason: CoreContract.MatchFailReason, code: int) -> void:
	if done:
		return
	done = true
	status = result_status
	fail_reason = reason
	error_code = code
	finished.emit()


## A new result with the values of this match.
func to_result() -> MatchJoinResult:
	var result: MatchJoinResult = MatchJoinResult.new()
	result.status = status
	result.fail_reason = fail_reason
	result.error_code = error_code
	return result
