class_name VirtualPadLayout
extends Control
## Root script of a virtual pad layout prefab. The elements are the direct children whose script is `VirtualPadJoystick`
## or `VirtualButton`, in child order: a later element is drawn on top. An element's name is its node name, its area
## is its rectangle, anchored to this root, and its picture is the `CanvasItem` nodes below it. `VirtualPadCore` lays
## this root over the safe area root of the `VirtualPad` UI layer.

## Joystick mode of the layout. Every layout prefab of a game has the same one.
@export var joystick_mode: VirtualPadCore.JoystickMode = VirtualPadCore.JoystickMode.FIXED
