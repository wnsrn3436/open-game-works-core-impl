class_name GetMousePositionResult
extends RefCounted
## Result of `InputCore.get_mouse_position`.

## True when there is a mouse position.
var ok: bool = false
## Mouse position in game coordinates. (0, 0) when `ok` is false.
var position: Vector2 = Vector2.ZERO
