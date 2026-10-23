extends RefCounted
## One update popup `GameUpdateCore` opened: what happened to it, and the signal its open flow waits on.

## Emitted once, when the popup's outcome is decided or `GameUpdateCore.release` drops it.
signal resolved

## Index of the pressed button. -1 when no button was pressed.
var button: int = -1
## Whether the popup was hidden.
var hidden: bool = false
## Whether `resolved` was emitted.
var done: bool = false
## Outcome: the pressed button's index, or one of the `GameUpdateCore` choice constants.
var choice: int = -1
