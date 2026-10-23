class_name ShortcutNavigatedEvent
extends EventBase
## `ShortcutCore` event: a `navigate` ended in stage 9 at the screen of its shortcut.

## ID value of the `shortcut` row.
var shortcut_id: int = 0
## Target scene key of the row.
var scene_key: String = ""
## Panel keys of the panel path, in order. Empty when the path is empty.
var panel_keys: PackedStringArray = PackedStringArray()
