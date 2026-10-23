extends RefCounted
## The state an accept click is judged by: before an accept event, whether the action of the focus owner's `UIButton`
## was pressed and released this frame.

## Process frame of the accept event.
var frame: int = -1
## The accept event, or `null` for a state taken at the click.
var event: InputEvent = null
## The `UIButton` of the focus owner at the accept event.
var button: UIButton = null
var was_pressed: bool = false
var was_released: bool = false
