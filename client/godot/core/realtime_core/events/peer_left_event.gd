class_name PeerLeftEvent
extends EventBase
## `RealtimeCore` did the leave handling of a participant.

## Participant index.
var participant: int = 0
var reason: RealtimeCore.PeerLeaveReason = RealtimeCore.PeerLeaveReason.LEFT
