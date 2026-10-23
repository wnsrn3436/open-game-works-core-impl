class_name InputCoreTestRecord
extends RefCounted
## One `InputCore` event, back handler call, UI pointer observer call or debug input handler call a test saw. The
## fields copy the event payload.

## `device`, `tap`, `long_press`, `drag`, `swipe`, `pinch`, `prompt`, `gamepad`, `back`, `pointer`, `debug` or
## `button`.
var kind: String = ""
var pointer_id: int = 0
var phase: InputCore.GesturePhase = InputCore.GesturePhase.START
var position: Vector2 = Vector2.ZERO
var start_position: Vector2 = Vector2.ZERO
var end_position: Vector2 = Vector2.ZERO
var delta: Vector2 = Vector2.ZERO
var center: Vector2 = Vector2.ZERO
var scale: float = 0.0
var device: InputCore.InputDevice = InputCore.InputDevice.TOUCH
var family: GameData.InputPromptFamily = GameData.InputPromptFamily.NONE
var gamepad_id: int = 0
var connected: bool = false
var pressed: bool = false
