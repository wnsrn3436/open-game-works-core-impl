extends RefCounted
## A packet the network simulation transport holds until its arrival time.

var deliver_at: int = 0
var participant: int = 0
var channel: RealtimeCore.RealtimeChannel = RealtimeCore.RealtimeChannel.RELIABLE
var packet: PackedByteArray = PackedByteArray()
