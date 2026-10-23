class_name ItemChangedEvent
extends EventBase
## Core event: a response carried item changes. `UserStateCore.notify_item_changes` publishes it.

## The response's `item_changes`, in order.
var changes: Array[CoreContract.ItemChange] = []
