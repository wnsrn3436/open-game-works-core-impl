extends RefCounted
## A realtime message received while no `on_realtime_message` hook was registered.

var participant: int = 0
var channel: RealtimeCore.RealtimeChannel = RealtimeCore.RealtimeChannel.RELIABLE
## Copy of the message bytes.
var bytes: PackedByteArray = PackedByteArray()
