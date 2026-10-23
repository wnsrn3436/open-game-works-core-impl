extends RefCounted
## State of one element of the virtual pad: what the layout prefab gave, the user settings and the pointer.

var control: Control = null
var element_name: String = ""
var is_joystick: bool = false
## Action of a button.
var action: StringName = &""
## Direction actions of a joystick: negative x, positive x, negative y, positive y.
var actions: Array[StringName] = []
## Last injected strength of each direction action.
var strengths: PackedFloat64Array = PackedFloat64Array([0.0, 0.0, 0.0, 0.0])
var base_control: Control = null
var handle_control: Control = null
## Default base center and base radius, element local.
var base_default: Vector2 = Vector2.ZERO
var base_radius: float = 0.0
## Base center now, element local.
var base_center: Vector2 = Vector2.ZERO
## Pointer ID of the pointer the element has; -1 when it has none.
var pointer_id: int = -1
## Position of that pointer, element local.
var pointer: Vector2 = Vector2.ZERO
## Anchors and offsets of the layout prefab: left, top, right, bottom.
var anchors: Vector4 = Vector4.ZERO
var offsets: Vector4 = Vector4.ZERO
## User settings.
var offset: Vector2 = Vector2.ZERO
var scale: float = 1.0
var opacity: float = 1.0
