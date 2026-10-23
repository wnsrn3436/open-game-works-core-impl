extends RefCounted
## One `move_to`, `move_by_preset` or `zoom_to` request of `CameraCore`, from its start until its result.

## Emitted once when the request gets its result.
signal finished

## Read once `done` is true.
var result: CameraCore.CameraMoveResult = CameraCore.CameraMoveResult.COMPLETED
var done: bool = false
## A `move_by_preset` that waits for its tween preset to load.
var pending: bool = false
var time_basis: TweenCore.TimeBasis = TweenCore.TimeBasis.REAL_TIME
var easing: TweenCore.Easing = TweenCore.Easing.LINEAR
## Time of the start in the time basis, ms.
var start_time: int = 0
var duration_ms: int = 0
## Start and end value: a world position, or the zoom factor in x.
var start_value: Vector3 = Vector3.ZERO
var end_value: Vector3 = Vector3.ZERO
