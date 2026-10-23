extends Node
## A value receiver whose calls a test still counts after the receiver was destroyed: the count is in `stats`.

const _STATS := preload("res://core/tween_core/tests/support/tween_test_receiver_stats.gd")

var stats: _STATS = _STATS.new()


func on_float(_value: float) -> void:
	stats.calls += 1
