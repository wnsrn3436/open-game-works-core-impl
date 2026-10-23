class_name LogEntry
extends RefCounted
## One `error` log in the error queue and in a `LogBatch`.

## Device time of the log. Unix ms.
var time: int = 0
var level: LogCore.Level = LogCore.Level.ERROR
var tag: String = ""
var message: String = ""
## Calling frames from the log operation call outward, joined with LF. Empty where the runtime gives no frames.
var stack_trace: String = ""
