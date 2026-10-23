class_name LogBatch
extends RefCounted
## Everything the error queue and the event queue held when LogCore called the sender.

## `error` logs in the order they were logged.
var errors: Array[LogEntry] = []
var dropped_error_count: int = 0
## Analytics events in the order they were tracked.
var events: Array[LogAnalyticsEvent] = []
var dropped_event_count: int = 0
