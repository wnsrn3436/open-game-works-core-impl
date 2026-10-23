extends RefCounted
## Static judge hooks and guide argument hooks for the RequirementCore core tests: the answer of each type and the
## calls each hook got.

## Answer of the flag judge hooks by `RequirementType` value. A type without an answer judges `false`.
static var answers: Dictionary[int, bool] = {}
## Calls of each judge hook by `RequirementType` value.
static var calls: Dictionary[int, int] = {}
## `recovery_at_least`: the recovery item it reads and the least balance that passes.
static var recovery_item: int = 0
static var recovery_least: int = 0
## `shop_unbought`: the shop product it reads.
static var shop_product: int = 0
## `balances_at_least`: the two items it reads and the least balance of each that passes.
static var balance_items: PackedInt32Array = PackedInt32Array()
static var balance_least: int = 0
## `evaluate_after_update`: the requirement ID value it evaluates, and the `passed` of each call.
static var update_requirement: int = 0
static var update_passed: Array[bool] = []
## What `guide_args` puts: the `value` of the row as `{count}`, and `{name}`.
static var guide_name: String = ""
## Calls of `guide_args`, and the requirement ID value of the row of the last call.
static var guide_calls: int = 0
static var guide_row: int = 0
## Calls of `throwing` and `guide_args_throwing` that went on past their runtime error.
static var throw_finished: int = 0


static func reset() -> void:
	answers = {}
	calls = {}
	recovery_item = 0
	recovery_least = 0
	shop_product = 0
	balance_items = PackedInt32Array()
	balance_least = 0
	update_requirement = 0
	update_passed = []
	guide_name = ""
	guide_calls = 0
	guide_row = 0
	throw_finished = 0


static func count(type: int) -> int:
	return calls[type] if calls.has(type) else 0


static func _called(type: int) -> void:
	calls[type] = count(type) + 1


static func flag(row: GameData.RequirementRow) -> bool:
	_called(row.type)
	return answers[row.type] if answers.has(row.type) else false


## Passes while the balance of `recovery_item`, with its recovery up to the server time, is at least `recovery_least`.
static func recovery_at_least(row: GameData.RequirementRow) -> bool:
	_called(row.type)
	return UserStateCore.get_item_balance(recovery_item) >= recovery_least


## Passes while `shop_product` was not bought in the current limit period.
static func shop_unbought(row: GameData.RequirementRow) -> bool:
	_called(row.type)
	return UserStateCore.get_shop_purchase_count(shop_product) == 0


## Passes while the balance of every item of `balance_items` is at least `balance_least`.
static func balances_at_least(row: GameData.RequirementRow) -> bool:
	_called(row.type)
	for item: int in balance_items:
		if UserStateCore.get_item_balance(item) < balance_least:
			return false
	return true


## An `after_update` hook that evaluates `update_requirement` while the delta is being applied.
static func evaluate_after_update(_value: ContractMessage) -> void:
	update_passed.append(RequirementCore.evaluate(update_requirement).passed)


## A judge hook whose output is not a `bool`: the failure of a wrong output format.
static func broken(row: GameData.RequirementRow) -> RefCounted:
	_called(row.type)
	return null


## A judge hook that throws: it stops on a GDScript runtime error, an out-of-bounds read, after counting the call. A
## `-> bool` function that stops returns `false`, so only the runtime error tells the throw.
static func throwing(row: GameData.RequirementRow) -> bool:
	_called(row.type)
	var none: PackedInt32Array = PackedInt32Array()
	var passed: bool = none[row.id] > 0
	throw_finished += 1
	return passed


## A guide argument hook that puts `{count}` and then throws.
static func guide_args_throwing(row: GameData.RequirementRow, args: FormatArgs) -> void:
	guide_calls += 1
	args.set_int("count", row.value)
	var none: PackedInt32Array = PackedInt32Array()
	args.set_int("more", none[row.id])
	throw_finished += 1


static func guide_args(row: GameData.RequirementRow, args: FormatArgs) -> void:
	guide_calls += 1
	guide_row = row.id
	args.set_int("count", row.value)
	args.set_string("name", guide_name)
