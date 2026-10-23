extends RefCounted
## State of one data badge: its `badge` row, own count, item badges, evaluator and the counts last published.

var id: int = 0
## Badge ID value of the parent data badge. 0 when it has none.
var parent_id: int = 0
var display: GameData.BadgeDisplay = GameData.BadgeDisplay.NONE
var persist: bool = false
## Requirement ID value. 0 when the badge has no requirement.
var requirement: int = 0
## Badge ID values of the child data badges.
var children: PackedInt64Array = PackedInt64Array()
## Index in the badge order, children before their parent. -1 when the badge is not in the order.
var order_index: int = -1

## Own count: the last evaluator output or the `set_count` value.
var own_count: int = 0
## Evaluator hook. Null when none is registered.
var evaluator: Callable = Callable()
## Count of each item badge by item key. Every count is 1 or more.
var items: Dictionary[int, int] = {}
## Sum of the counts in `items`.
var item_sum: int = 0
## Count of each item badge changed since the last frame end, by item key, as it was at that frame end.
var items_before: Dictionary[int, int] = {}
## Requirement judgement: `passed` of the last `RequirementCore.evaluate`. True when the badge has no requirement.
var passed: bool = false
## Total count published at the last frame end.
var total: int = 0
## Instance IDs of the `BadgeView`s bound to this badge or one of its item badges.
var view_ids: Dictionary[int, bool] = {}

## Evaluator call and requirement judgement waiting for the frame end.
var evaluate_pending: bool = false
var judge_pending: bool = false
## The own count, an item count or the requirement judgement changed since the last frame end.
var recalc_pending: bool = false
## The badge is in the list of badges with work at the frame end.
var touched: bool = false
