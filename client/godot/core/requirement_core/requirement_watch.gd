extends RefCounted
## One watch of `RequirementCore.watch`.

var requirement_id: int = 0
## The entry of the watched condition.
var entry: RefCounted = null
## Copies of the triggers of the watch.
var triggers: Array[RequirementTrigger] = []
## Bit `1 << kind` for each `RequirementCore.TriggerKind` of its triggers but `CONTENT_EVENT`.
var kinds_mask: int = 0
## Content event types of its `CONTENT_EVENT` triggers, each once.
var event_types: Array[Script] = []
var callback: Callable = Callable()
## Instance ID of the owner object. 0 when there is none.
var owner_id: int = 0
## Its slot in `RequirementCore._watches`.
var slot: int = -1
## Index of its slot in `RequirementCore._owner_slots`. -1 when there is no owner object.
var owner_index: int = -1
## Its links in the lists of `RequirementCore`: the list of its requirement ID; the lists of its `REQUEST_COMPLETED`,
## `UI_OPENED`, `UI_CLOSED` and `CONTENT_EVENT` triggers; the lists of the UserState kinds that mark it; the list of
## time-dependent watches (-1 when its condition is not time-dependent).
var id_link: int = -1
var trigger_links: PackedInt32Array = PackedInt32Array()
var state_links: PackedInt32Array = PackedInt32Array()
var time_link: int = -1
## Base result.
var base_passed: bool = false
var base_failed_id: int = 0
## The pending buffer it is in (`RequirementCore._QUEUE_*`), and its index there.
var queue: int = 0
var queue_index: int = -1
