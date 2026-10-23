extends Node
## Records the TimeCore events in delivery order, with their payloads and the server time at each foreground return.

## Event names in delivery order: `jumped`, `day`, `background`, `foreground`.
var order: PackedStringArray = PackedStringArray()
var jump_previous: PackedInt64Array = PackedInt64Array()
var jump_current: PackedInt64Array = PackedInt64Array()
var day_starts: PackedInt64Array = PackedInt64Array()
var background_ms: PackedInt64Array = PackedInt64Array()
var resume_counts: PackedInt64Array = PackedInt64Array()
## `TimeCore.get_server_time` inside each `AppForegroundReturnedEvent` callback after the first sync. Before it the
## server time is a failure value with an `error` log, so nothing is recorded.
var server_time_at_foreground: PackedInt64Array = PackedInt64Array()
## Whether the LogCore running marker existed inside each `AppBackgroundEnteredEvent` and `AppForegroundReturnedEvent`
## callback.
var marker_at_background: Array[bool] = []
var marker_at_foreground: Array[bool] = []


func subscribe() -> bool:
	return (
		EventCore.subscribe(ServerTimeJumpedEvent, _on_jumped)
		and EventCore.subscribe(DayChangedEvent, _on_day_changed)
		and EventCore.subscribe(AppBackgroundEnteredEvent, _on_background)
		and EventCore.subscribe(AppForegroundReturnedEvent, _on_foreground)
	)


func count(name: String) -> int:
	return order.count(name)


func _on_jumped(event: ServerTimeJumpedEvent) -> void:
	order.append("jumped")
	jump_previous.append(event.previous_server_time)
	jump_current.append(event.server_time)


func _on_day_changed(event: DayChangedEvent) -> void:
	order.append("day")
	day_starts.append(event.day_start)


## Path of the LogCore running marker of the test app storage root.
func marker_path() -> String:
	return CoreBuildInfo.storage_root + "log/running"


func _on_background(_event: AppBackgroundEnteredEvent) -> void:
	order.append("background")
	marker_at_background.append(FileAccess.file_exists(marker_path()))


func _on_foreground(event: AppForegroundReturnedEvent) -> void:
	order.append("foreground")
	background_ms.append(event.background_ms)
	resume_counts.append(event.resume_count)
	marker_at_foreground.append(FileAccess.file_exists(marker_path()))
	if TimeCore.is_synced():
		server_time_at_foreground.append(TimeCore.get_server_time())
