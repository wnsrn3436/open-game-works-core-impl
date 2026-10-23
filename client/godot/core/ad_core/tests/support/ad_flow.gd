extends RefCounted
## An AdCore async operation a core test starts and awaits later: `Flow.new()`, then `show`, `start` or
## `open_privacy_options`, then `wait`.

signal done

var finished: bool = false
## `AdCore.AdShowResult` of `show`, or -1.
var result: int = -1
## Success flag of `start` or `open_ad_privacy_options`.
var flag: bool = false


func show(placement_id: int) -> void:
	result = await AdCore.show(placement_id)
	_finish()


func start() -> void:
	flag = await AdCore.start()
	_finish()


func open_privacy_options() -> void:
	flag = await AdCore.open_ad_privacy_options()
	_finish()


func wait() -> void:
	if not finished:
		await done


func _finish() -> void:
	finished = true
	done.emit()
