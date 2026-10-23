class_name SwipeEvent
extends EventBase
## `InputCore` event: a swipe was judged.

## Pointer ID of the released pointer.
var pointer_id: int = 0
## Press position in game coordinates.
var start_position: Vector2 = Vector2.ZERO
## Release position in game coordinates.
var end_position: Vector2 = Vector2.ZERO
