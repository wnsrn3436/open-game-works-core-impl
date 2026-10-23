class_name EventCoreTestBootEntry
extends ContentEntry
## Content entry of the EventCore boot event test. `content_init` subscribes to `BootCompletedEvent` and moves the test
## clock ahead; each `BootCompletedEvent` records its `duration_ms` and the device monotonic time it came at.

## Test clock time `content_init` moves ahead, in ms. A `duration_ms` read from the test clock would hold it.
var test_clock_advance_ms: int = 0
## `duration_ms` of each `BootCompletedEvent`.
var durations: Array[int] = []
## `Time.get_ticks_msec()` when each `BootCompletedEvent` came.
var received_at_ms: Array[int] = []


func content_init() -> bool:
	EventCore.subscribe(BootCompletedEvent, _on_boot_completed)
	if test_clock_advance_ms > 0:
		UnitTestCore.advance_clock(test_clock_advance_ms, false)
	return true


func content_release() -> void:
	EventCore.unsubscribe(BootCompletedEvent, _on_boot_completed)


func _on_boot_completed(event: BootCompletedEvent) -> void:
	received_at_ms.append(Time.get_ticks_msec())
	durations.append(event.duration_ms)
