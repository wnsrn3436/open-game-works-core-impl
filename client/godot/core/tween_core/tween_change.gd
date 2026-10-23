class_name TweenChange
extends Resource
## One property change of a `TweenStep`. Values are 4 component vectors; the property uses only its components.

@export var property: TweenCore.TweenProperty = TweenCore.TweenProperty.POSITION
@export var target_value: Vector4 = Vector4.ZERO
## When false the change starts from the property value at the end of its delay.
@export var use_start_value: bool = false
@export var start_value: Vector4 = Vector4.ZERO
## Duration in ms.
@export var duration: int = 0
## Delay in ms before the change starts.
@export var delay: int = 0
@export var easing: TweenCore.Easing = TweenCore.Easing.LINEAR
