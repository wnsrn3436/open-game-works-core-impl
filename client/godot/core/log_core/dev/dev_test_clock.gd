class_name DevTestClock
extends RefCounted
## The test clock `TimeCore` and `LogCore` read instead of the device. Only the test clock operations of
## `UnitTestCore` change it.

## Monotonic time. ms.
var monotonic_ms: int = 0
## Device time. Unix ms.
var device_time_ms: int = 0
