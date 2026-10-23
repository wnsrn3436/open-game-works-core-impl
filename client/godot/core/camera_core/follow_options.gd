class_name FollowOptions
extends RefCounted
## Options of `CameraCore.follow`. The caller reads the values from data. World values use x, y for a 2D camera and
## x, y, z for a 3D camera.

## Added to the target object position, world units.
var offset: Vector3 = Vector3.ZERO
## Smooth time, ms. 0 goes to the follow position at once.
var smooth_time_ms: int = 0
## Dead zone length on each axis, world units. 0 is no dead zone on that axis.
var dead_zone: Vector3 = Vector3.ZERO
