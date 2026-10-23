class_name ScheduledLocalPush
extends RefCounted
## One local push the fake notification adapter has scheduled: an item of `PushCoreDev.list_scheduled_local`.

## `local_push` ID value.
var id: int = 0
## ms until the notification shows. 0 when the time has come.
var remaining_ms: int = 0
