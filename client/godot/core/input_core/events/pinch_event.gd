class_name PinchEvent
extends EventBase
## `InputCore` event: a pinch phase was judged.

## Pinch phase.
var phase: InputCore.GesturePhase = InputCore.GesturePhase.START
## Midpoint of the two pinch pointers in game coordinates.
var center: Vector2 = Vector2.ZERO
## Distance of the two pinch pointers ÷ their distance at `START`.
var scale: float = 1.0
