class_name DragEvent
extends EventBase
## `InputCore` event: a drag phase was judged.

## Pointer ID of the dragging pointer.
var pointer_id: int = 0
## Drag phase.
var phase: InputCore.GesturePhase = InputCore.GesturePhase.START
## Press position in game coordinates.
var start_position: Vector2 = Vector2.ZERO
## Pointer position in game coordinates.
var position: Vector2 = Vector2.ZERO
## Difference from the position of the previous drag event of the pointer; from the press position for `START`.
var delta: Vector2 = Vector2.ZERO
