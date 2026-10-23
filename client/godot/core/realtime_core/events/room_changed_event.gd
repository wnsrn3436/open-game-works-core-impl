class_name RoomChangedEvent
extends EventBase
## The `RoomInfo` of `RealtimeCore` changed or became empty.

## The `RoomInfo` after the change.
var room: RoomInfo = null
var reason: RealtimeCore.RoomChangeReason = RealtimeCore.RoomChangeReason.UPDATED
