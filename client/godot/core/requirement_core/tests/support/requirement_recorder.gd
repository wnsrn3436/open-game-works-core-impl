extends RefCounted
## A watch callback for the RequirementCore core tests: what each call got.

## `<requirement ID value>:<passed>:<failed_requirement_id>` of each call, in order.
var calls: PackedStringArray = PackedStringArray()
## The result object of the last call.
var last: RequirementResult = null
## Called inside each call with the requirement ID value, when valid.
var inside: Callable = Callable()
## Calls of `on_result_failing`, and the calls of it that went on past its runtime error.
var failing_calls: int = 0
var failing_finished: int = 0


func on_result(requirement_id: int, result: RequirementResult) -> void:
	calls.append("%d:%s:%d" % [requirement_id, result.passed, result.failed_requirement_id])
	last = result
	if inside.is_valid():
		inside.call(requirement_id)


## A watch callback that stops on a GDScript runtime error, an out-of-bounds read, after counting the call.
func on_result_failing(requirement_id: int, _result: RequirementResult) -> void:
	failing_calls += 1
	var none: PackedStringArray = PackedStringArray()
	calls.append(none[requirement_id])
	failing_finished += 1


func count() -> int:
	return calls.size()
