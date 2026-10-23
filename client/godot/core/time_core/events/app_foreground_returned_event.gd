class_name AppForegroundReturnedEvent
extends EventBase
## TimeCore event: the app returned from the background.

## Background elapsed time of this return. ms.
var background_ms: int = 0
## Background returns after `init`, this one included.
var resume_count: int = 0
