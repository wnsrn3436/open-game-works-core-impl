class_name FatalErrorRequestedEvent
extends EventBase
## Boot event: a core module outside `BootstrapCore` met an unrecoverable failure. `BootstrapCore` subscribes.

## Name of the module that published it.
var module: String = ""
## English text of the failure.
var reason: String = ""
