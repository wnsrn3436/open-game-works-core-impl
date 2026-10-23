extends ContentEntry
## Content entry of the BootstrapCore core tests. Counts the hook calls and records what the boot had done when
## `content_init` ran.

## Emitted at the end of `content_init`, before the boot goes on.
signal initialized

## Value `content_init` returns.
var init_result: bool = true
## Scene key `select_first_scene` returns. Empty means the default (game settings `firstScene`).
var first_scene: String = ""
## When true, `select_first_scene` returns an empty string.
var first_scene_empty: bool = false
## When true, `content_init` registers `NetworkCore` hook `error_display`.
var register_hook: bool = false
## When true, `content_init` calls `BootstrapCore.report_fatal` before it returns.
var fatal_in_init: bool = false
## When true, `content_init` registers the `DataCore` `build_derived` hook that calls `BootstrapCore.report_fatal`
## and returns false.
var fatal_in_build_derived: bool = false
## When true, `select_first_scene` calls `BootstrapCore.report_fatal` and returns an empty string.
var fatal_in_select: bool = false
## When true, the next `content_init` calls `BootstrapCore.request_restart` before it returns, and sets this false.
var restart_in_init: bool = false
## When true, `content_init` registers the `RequirementCore` judge hook of the game-defined requirement type the core
## test data badges use.
var register_judge: bool = false
## When true, `content_init`, `select_first_scene` and `content_release` stop on a GDScript runtime error, an
## out-of-bounds read, after counting the call.
var throw_in_init: bool = false
var throw_in_select: bool = false
var throw_in_release: bool = false
## When true, `content_init` subscribes to `BootCompletedEvent` and `content_release` unsubscribes.
var record_boot_durations: bool = false

var init_count: int = 0
var release_count: int = 0
var select_count: int = 0
## `DataCore.is_loaded()` when `content_init` ran.
var data_loaded_at_init: bool = false
## The `BootstrapCore` trace when `content_init` ran.
var trace_at_init: PackedStringArray = PackedStringArray()
## Whether the boot block was active when `content_init` ran.
var blocked_at_init: bool = false
## Results of the hook registrations, in call order.
var register_results: Array[bool] = []
## `duration_ms` of each `BootCompletedEvent` while `record_boot_durations`.
var boot_durations: Array[int] = []
## Empty: reading `_none[0]` stops a function on a GDScript runtime error.
var _none: PackedInt32Array = PackedInt32Array()


func content_init() -> bool:
	init_count += 1
	data_loaded_at_init = DataCore.is_loaded()
	trace_at_init = BootstrapCore._trace.duplicate()
	blocked_at_init = BootstrapCore._has_boot_block and InputBlockCore.is_active(BootstrapCore._boot_block)
	if register_hook:
		register_results.append(NetworkCore.register_error_display(_error_display))
	if register_judge:
		var kinds: Array[GDScript] = []
		register_results.append(RequirementCore.register_judge(GameData.RequirementType.ITEM_AT_LEAST, _judge, kinds, ""))
	if record_boot_durations:
		EventCore.subscribe(BootCompletedEvent, _on_boot_completed)
	if fatal_in_build_derived:
		register_results.append(DataCore.register_build_derived(_build_derived_with_fatal))
	if fatal_in_init:
		BootstrapCore.report_fatal("content_init failure")
	if restart_in_init:
		restart_in_init = false
		BootstrapCore.request_restart()
	initialized.emit()
	if throw_in_init:
		return _none[0] > 0
	return init_result


func content_release() -> void:
	release_count += 1
	if record_boot_durations:
		EventCore.unsubscribe(BootCompletedEvent, _on_boot_completed)
	if throw_in_release:
		release_count += _none[0]


func select_first_scene() -> String:
	select_count += 1
	if fatal_in_select:
		BootstrapCore.report_fatal("select_first_scene failure")
		return ""
	if throw_in_select:
		return str(_none[0])
	if first_scene_empty:
		return ""
	if first_scene.is_empty():
		return super()
	return first_scene


func _on_boot_completed(event: BootCompletedEvent) -> void:
	boot_durations.append(event.duration_ms)


static func _build_derived_with_fatal() -> bool:
	BootstrapCore.report_fatal("build_derived failure")
	return false


static func _error_display(_code: int, _request_name: String) -> ErrorDisplay:
	return ErrorDisplay.new()


static func _judge(_row: GameData.RequirementRow) -> bool:
	return false
