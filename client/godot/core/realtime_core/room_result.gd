class_name RoomResult
extends RefCounted
## Result of `RealtimeCore.create_room` and `join_room`.

var ok: bool = false
## Error code of a room failed or a matchmaker lost; 0 otherwise.
var error_code: int = 0
