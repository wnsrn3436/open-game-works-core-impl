class_name RealtimeHookOwner
extends Node
## Test owner of the `on_realtime_message` hook. Keeps each message it gets as `<participant>:<channel>:<bytes>`.

## First byte of a message `on_message_throwing` throws for.
const THROW: int = 255

var messages: PackedStringArray = PackedStringArray()


func on_message(participant: int, channel: RealtimeCore.RealtimeChannel, bytes: PackedByteArray) -> void:
	messages.append("%d:%d:%s" % [participant, channel, bytes.hex_encode()])


## Like `on_message`, but stops on a GDScript runtime error, an out-of-bounds read, after keeping a message whose
## first byte is `THROW`.
func on_message_throwing(participant: int, channel: RealtimeCore.RealtimeChannel, bytes: PackedByteArray) -> void:
	on_message(participant, channel, bytes)
	if bytes.size() > 0 and bytes[0] == THROW:
		messages.append(str(bytes[bytes.size()]))
