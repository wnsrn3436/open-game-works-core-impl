extends RefCounted
## Hooks of the BadgeCore core tests: evaluators that give the count a test sets and count their calls, and the
## requirement judge of type `ItemAtLeast`.

## Own count each `evaluate` call gives, by badge ID value. 0 when not set.
static var counts: Dictionary[int, int] = {}
## Evaluator calls by badge ID value.
static var calls: Dictionary[int, int] = {}
## Calls of `evaluate_failing` that went on past its runtime error.
static var failing_finished: int = 0


static func reset() -> void:
	counts = {}
	calls = {}
	failing_finished = 0


static func calls_of(badge_id: int) -> int:
	return calls[badge_id] if calls.has(badge_id) else 0


static func evaluate(badge_id: int) -> BadgeEvaluatorResult:
	_count_call(badge_id)
	var result: BadgeEvaluatorResult = BadgeEvaluatorResult.new()
	result.count = counts[badge_id] if counts.has(badge_id) else 0
	return result


## An evaluator that stops on a GDScript runtime error, an out-of-bounds read, after counting the call. A GDScript
## function with an object return type returns `null` when it stops.
static func evaluate_failing(badge_id: int) -> BadgeEvaluatorResult:
	_count_call(badge_id)
	var none: PackedInt64Array = PackedInt64Array()
	var result: BadgeEvaluatorResult = BadgeEvaluatorResult.new()
	result.count = none[badge_id]
	failing_finished += 1
	return result


static func evaluate_negative(badge_id: int) -> BadgeEvaluatorResult:
	_count_call(badge_id)
	var result: BadgeEvaluatorResult = BadgeEvaluatorResult.new()
	result.count = -1
	return result


## Judge hook of `ItemAtLeast(<item>, <least balance>)`.
static func item_at_least(row: GameData.RequirementRow) -> bool:
	return UserStateCore.get_item_balance(row.target_id) >= row.value


static func _count_call(badge_id: int) -> void:
	calls[badge_id] = calls_of(badge_id) + 1
