class_name GetAttendanceResult
extends RefCounted
## Output of `UserStateCore.get_attendance`, the same values as server `attendance` `get_attendance`.

## The last day claimed in the current progress. 0 when none.
var day: int = 0
## The day a claim now would get. 0 when no claim is possible.
var next_day: int = 0
