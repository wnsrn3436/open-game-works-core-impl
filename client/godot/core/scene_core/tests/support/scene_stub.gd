extends SceneBase
## Root script of the SceneCore test scenes. Records its callbacks in the scene trace as `<callback>:<scene key>` and
## does what the static test config says.

const Trace := preload("res://core/scene_core/tests/support/scene_trace.gd")
const Gate := preload("res://core/scene_core/tests/support/gate.gd")
const TestLoading := preload("res://core/scene_core/tests/support/loading_screen_stub.gd")

## Results of the next `on_prepare` calls, in order. `true` when empty.
static var prepare_results: Array[bool] = []
## Resource keys `on_preload` puts into the preload request, as `PackedScene`.
static var preload_keys: PackedStringArray = PackedStringArray()
## Resource keys `on_preload` puts into the pool list, with the scene scope.
static var prefill_keys: PackedStringArray = PackedStringArray()
## When set, `on_prepare` waits for it and returns its result.
static var prepare_gate: Gate = null
## When set, `on_start` waits for it.
static var start_gate: Gate = null
## When valid, `on_start` calls it with the scene.
static var start_hook: Callable = Callable()
## When valid, `on_prepare` calls it with the scene first.
static var prepare_hook: Callable = Callable()
## When valid, `on_exit` calls it with the scene last.
static var exit_hook: Callable = Callable()
## When valid, `on_preload` calls it with the scene last.
static var preload_hook: Callable = Callable()
## The preload request the last `on_preload` got.
static var preload_request_ref: WeakRef = null
## The last scene that got `on_preload`.
static var last: Node = null
## The progress values the test loading screen had got when `on_preload` was called.
static var progress_at_preload: PackedInt32Array = PackedInt32Array()

## A child the scene code reads from `on_preload`.
@export var probe: Node2D = null

## Frames this scene ran `_process`.
var process_count: int = 0
## `probe` and the `@onready` child were usable in `on_preload`.
var children_ready_in_preload: bool = false
## `process_count` when `on_preload`, `on_prepare` and `on_start` were called.
var process_count_in_preload: int = -1
var process_count_in_prepare: int = -1
## Whether a visual child was visible in tree when `on_preload` was called.
var visible_in_preload: bool = true

@onready var _first_child: Node = get_child(0) if get_child_count() > 0 else null


static func reset() -> void:
	prepare_results = []
	preload_keys = PackedStringArray()
	prefill_keys = PackedStringArray()
	prepare_gate = null
	start_gate = null
	start_hook = Callable()
	prepare_hook = Callable()
	exit_hook = Callable()
	preload_hook = Callable()
	preload_request_ref = null
	last = null
	progress_at_preload = PackedInt32Array()


func _ready() -> void:
	Trace.add("loaded:" + scene_key)


func _process(_delta: float) -> void:
	process_count += 1


func on_exit() -> void:
	Trace.add("exit:" + scene_key)
	if exit_hook.is_valid():
		exit_hook.call(self)


func on_preload(preload_request: PreloadRequest, prefill_items: Array[PrefillItem]) -> void:
	last = self
	progress_at_preload = TestLoading.progress.duplicate()
	children_ready_in_preload = probe != null and probe.is_inside_tree() and _first_child != null
	process_count_in_preload = process_count
	visible_in_preload = probe != null and probe.is_visible_in_tree()
	for key: String in preload_keys:
		preload_request.add_item(key, ResourceCore.BaseKind.PACKED_SCENE)
	for key: String in prefill_keys:
		var item: PrefillItem = PrefillItem.new()
		item.resource_key = key
		item.pool_scope = scope
		item.count = 1
		prefill_items.append(item)
	Trace.add("preload:" + scene_key)
	preload_request_ref = weakref(preload_request)
	if preload_hook.is_valid():
		preload_hook.call(self)


func on_prepare() -> bool:
	process_count_in_prepare = process_count
	if prepare_hook.is_valid():
		prepare_hook.call(self)
	Trace.add("prepare:" + scene_key)
	if prepare_gate != null:
		var gated: bool = await prepare_gate.wait()
		return gated
	if prepare_results.is_empty():
		return true
	var result: bool = prepare_results.pop_front()
	return result


func on_start() -> void:
	Trace.add("start:" + scene_key)
	if start_hook.is_valid():
		start_hook.call(self)
	if start_gate != null:
		await start_gate.wait()


func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		if UICore.is_initialized():
			Trace.add("stack:%d" % UICore.get_panel_stack().size())
		Trace.add("destroyed:" + scene_key)
