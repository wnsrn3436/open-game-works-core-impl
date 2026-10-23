class_name GetOverlayStateResult
extends RefCounted
## State of one channel overlay from `ScreenEffectCoreDev.get_overlay_state`.

## Position and size of the overlay in game coordinates.
var rect: Rect2 = Rect2()
## Overlay color (r, g, b). Alpha is 1.
var color: Color = Color.BLACK
var opacity: float = 0.0
var visible: bool = false
