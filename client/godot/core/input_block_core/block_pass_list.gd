class_name BlockPassList
extends RefCounted
## What a block lets through. The caller makes it, may reuse it and may give it to several blocks; it does not change
## it while a block that has it is active.

## Actions that pass the block.
var actions: Array[StringName] = []
## UI elements whose screen area and focus (the element and its descendants) pass the block.
var elements: Array[Control] = []
