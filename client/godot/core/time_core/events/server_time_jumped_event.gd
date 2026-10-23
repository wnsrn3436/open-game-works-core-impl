class_name ServerTimeJumpedEvent
extends EventBase
## TimeCore event: a sync moved the server time by `TimeCore.jumpThresholdMs` or more.

## Server time just before the sync. Unix ms.
var previous_server_time: int = 0
## Server time just after the sync. Unix ms.
var server_time: int = 0
