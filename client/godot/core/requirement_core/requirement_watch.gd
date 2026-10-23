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
## Base result.
var base_passed: bool = false
var base_failed_id: int = 0
var pending: bool = false
## The batch evaluation round that judges this watch. 0 when none.
var batch_round: int = 0
