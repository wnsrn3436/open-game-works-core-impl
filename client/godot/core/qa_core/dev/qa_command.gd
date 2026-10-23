extends RefCounted
## One command of `QACore`: a debug screen or automation channel operation, its time limit and its result.

## Emitted once when the command ends.
signal finished

## Command name. External input: it is logged, its arguments are not.
var name: String = ""
var args: PackedStringArray = PackedStringArray()
## Whether the command came over the automation channel, so its response goes back there.
var from_channel: bool = false
## `id` of the automation channel request. 0 for a command that did not come over the channel.
var request_id: int = 0
## Session of `QACore` when the command was received. A command of an older session does not run.
var session: RefCounted = null
## Whether the command has started, and the real elapsed time (`TimeCore`) it started at.
var started: bool = false
var started_real_ms: int = 0
## Time limit from the start. ms.
var limit_ms: int = 0
## Whether the command has put its first device input in, and so is recorded as a telemetry input.
var input_recorded: bool = false
var done: bool = false
## Whether the end of its automation channel connection ended the command: it puts in no more device input.
var cut: bool = false
var ok: bool = false
## JSON text of `result`. Empty for none.
var result: String = ""
var bytes: PackedByteArray = PackedByteArray()
## Runs after the command ended and its response was sent. Empty for none.
var after: Callable = Callable()
## Runs when the command fails, before its response is sent. Empty for none.
var on_fail: Callable = Callable()
