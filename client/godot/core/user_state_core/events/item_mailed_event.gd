class_name ItemMailedEvent
extends EventBase
## Core event: a response carried items sent by mail. `UserStateCore.notify_item_mails` publishes it.

## The response's `item_mails`, in order.
var mails: Array[CoreContract.ItemMail] = []
