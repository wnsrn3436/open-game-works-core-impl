extends RefCounted
## State of one message kind: its queue, the message on screen and the prefab values of its message object.

## Display step of the message on screen. `IDLE` is no message on screen.
enum Phase { IDLE, ENTER, HOLD, EXIT }

## True for the toast kind, false for the black box message kind.
var is_toast: bool = false
## Display time of the kind. Core settings `MessageCore.toastDurationMs` or `MessageCore.blackBoxDurationMs`.
var duration_ms: int = 0
## Enter and exit tween preset keys. An empty string is no tween.
var enter_tween: String = ""
var exit_tween: String = ""

## Waiting message texts. Entries before `head` are already shown.
var queue: PackedStringArray = PackedStringArray()
var head: int = 0

var phase: Phase = Phase.IDLE
## Text of the message on screen.
var text: String = ""
## Message object of the message on screen and its instance ID.
var object: Control = null
var object_id: int = 0
## True while the message on screen holds a toast object borrowed from `PoolCore`.
var pooled: bool = false
var pool_handle: Vector4i = Vector4i.ZERO
## True while the enter or exit tween of the message on screen plays.
var tweening: bool = false
var tween_handle: int = 0
## Real elapsed time at which the display time ends.
var hold_until_ms: int = 0
## True while the message on screen holds its `InputBlockCore` block.
var blocked: bool = false
var block_token: int = 0

## Values of the tween properties in the prefab. Display step 1 puts them back.
var anchors: Vector4 = Vector4(0.0, 0.0, 1.0, 1.0)
var offsets: Vector4 = Vector4.ZERO
var rotation: float = 0.0
var scale: Vector2 = Vector2.ONE
var modulate: Color = Color.WHITE


## Number of waiting messages.
func waiting_count() -> int:
	return queue.size() - head


## True when `value` is the text on screen or a waiting text.
func has_text(value: String) -> bool:
	if phase != Phase.IDLE and text == value:
		return true
	return queue.find(value, head) >= 0


## Puts the message on screen back to no message. The caller has lowered the object.
func clear_current() -> void:
	phase = Phase.IDLE
	text = ""
	object = null
	object_id = 0
	pooled = false
	pool_handle = Vector4i.ZERO
	tweening = false
	tween_handle = 0
	hold_until_ms = 0
	blocked = false
	block_token = 0
