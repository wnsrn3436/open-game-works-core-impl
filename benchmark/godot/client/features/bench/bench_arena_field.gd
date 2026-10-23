class_name BenchArenaField
extends Control
## Code-drawn shapes on spiral orbits that move every frame: the drawing load of the arena. The shape count, size
## and spin come from `game_setting`.

var _count: int = 0
var _side: float = 0.0
var _spin: float = 0.0
var _elapsed: float = 0.0


func _ready() -> void:
	_count = GameSetting.arena_shape_count()
	_side = float(GameSetting.arena_shape_size())
	_spin = float(GameSetting.arena_spin_permille()) / float(BenchConstants.PERMILLE)


func _process(delta: float) -> void:
	_elapsed += delta
	queue_redraw()


func _draw() -> void:
	if _count <= 0:
		return
	var center: Vector2 = size * 0.5
	var radius: float = minf(size.x, size.y) * BenchConstants.ARENA_OUTER_RADIUS
	var extent: Vector2 = Vector2(_side, _side)
	for i: int in _count:
		var ratio: float = float(i) / float(_count)
		var angle: float = TAU * ratio * BenchConstants.ARENA_SPIRAL_TURNS + _elapsed * _spin * (1.0 + ratio)
		var orbit: float = radius * lerpf(BenchConstants.ARENA_INNER_RADIUS, 1.0, ratio)
		var at: Vector2 = center + Vector2(cos(angle), sin(angle)) * orbit
		draw_rect(Rect2(at - extent * 0.5, extent), Color.from_hsv(ratio, BenchConstants.ARENA_SATURATION, BenchConstants.ARENA_VALUE))
