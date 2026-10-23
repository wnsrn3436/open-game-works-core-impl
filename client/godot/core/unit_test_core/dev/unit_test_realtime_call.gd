class_name UnitTestRealtimeCall
extends RefCounted
## One transport operation call the fake realtime transport received: an item of `UnitTestCore.realtime_calls`.

## Transport operation name, for example `start_matching`.
var name: String = ""
## Inputs in order as text: integers and booleans as `str()`, a packet as lower case hex.
var inputs: PackedStringArray = PackedStringArray()
