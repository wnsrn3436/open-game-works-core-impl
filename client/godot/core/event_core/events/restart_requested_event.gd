class_name RestartRequestedEvent
extends EventBase
## Boot event: a core module outside `BootstrapCore` needs a restart. `BootstrapCore` subscribes.

## Name of the module that published it.
var module: String = ""
