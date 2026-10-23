extends RefCounted
## Subscription record slots and reused event objects of one event type.

## Position of this state in `EventCore._type_list`.
var index: int = 0
## Event type name in logs.
var type_name: String = ""
## Callback of each slot. An empty slot holds an empty `Callable`.
var callbacks: Array[Callable] = []
## Subscriber instance ID of each slot. 0 marks an empty slot.
var subscriber_ids: PackedInt64Array = PackedInt64Array()
## Subscription serial of each slot. A delivery calls only the slots whose serial is lower than the serial at its start.
var serials: PackedInt64Array = PackedInt64Array()
## Slot reference of the next and the previous subscription of the same subscriber in each slot, -1 for none. A slot
## reference is `index << 32 | slot`. The subscriptions of one subscriber form one list across event types.
var next_refs: PackedInt64Array = PackedInt64Array()
var prev_refs: PackedInt64Array = PackedInt64Array()
## Event object of each delivery depth.
var events: Array[EventBase] = []
## Publishes of this type that have not returned.
var depth: int = 0
