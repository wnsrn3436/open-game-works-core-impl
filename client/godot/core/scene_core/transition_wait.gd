extends RefCounted
## A wait of the transition: until a real elapsed time, which the frame check of `SceneCore` reports, or until the
## preload items end. `release` emits `reached` to stop the wait.

signal reached

## Preload items that did not end yet.
var remaining: int = 0
