class_name AnchorResult
extends RefCounted
## Result of `UICore.get_anchor_rect`.

## An anchor match `UIAnchor` is in the UI tree.
var found: bool = false
## One of the anchor match `UIAnchor`s is visible.
var visible: bool = false
## Game coordinates rectangle of the visible anchor match. The empty rectangle when none is visible.
var rect: Rect2 = Rect2()
## The UI element the visible `UIAnchor` is on. `null` when none is visible.
var element: Control = null
## Key of the nearest panel or popup instance holding `element`. Empty when there is none or none is visible.
var owner: String = ""
