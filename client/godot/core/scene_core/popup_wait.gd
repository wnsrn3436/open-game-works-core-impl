extends RefCounted
## The answer to one retry popup: the button pressed or the close without a button. `SceneCore` sets `outcome` from
## the popup callbacks and emits `decided` after the callback returns.

signal decided

## `SceneCore._OUTCOME_*`. `_OUTCOME_NONE` until the popup is answered.
var outcome: int = 0
