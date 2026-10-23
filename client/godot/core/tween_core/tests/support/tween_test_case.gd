extends UnitTestCase
## Base of the TweenCore core tests: test settings, the modules TweenCore depends on started in module list order,
## test targets freed after the test, definition builders and the input block count.

const TAG: String = "TweenCore"
const ERROR: String = "error"
const MAX_DURATION_MS: int = 10000
const MAX_REPEAT_COUNT: int = 5
const RESOURCES: String = "res://core/tween_core/tests/resources/"
## Tween preset: one change, `Position` to (100, 0) in 100 ms.
const MOVE: String = "tween/tween_test_move"
## Tween preset: one step with one change whose fields are all left at their defaults.
const DEFAULTS: String = "tween/tween_test_defaults"
const POOL_OBJECT: String = "prefab/tween_test_pool_object"
## Not in the test key list.
const MISSING: String = "tween/tween_test_missing"
const _RECORDER := preload("res://core/tween_core/tests/support/tween_test_recorder.gd")

var recorder: _RECORDER = null
var _nodes: Array[Node] = []


func before_each() -> void:
	super()
	assert_true(UnitTestCore.set_test_settings("TweenCore.maxDurationMs", MAX_DURATION_MS))
	assert_true(UnitTestCore.set_test_settings("TweenCore.maxRepeatCount", MAX_REPEAT_COUNT))
	assert_true(UnitTestCore.set_test_settings("InputBlockCore.maxDurationMs", 600000))


func after_each() -> void:
	super()
	TweenCore.release()
	InputBlockCore.release()
	PoolCore.release()
	ResourceCore.release()
	LocalDataCore.release()
	TimeCore.release()
	EventCore.release()
	LogCore.release()
	for node: Node in _nodes:
		if is_instance_valid(node):
			node.free()
	_nodes.clear()
	recorder = null


## Starts TweenCore and the modules it depends on in module list order, and the recorder subscribed to
## `TweenStartedEvent`.
func start() -> void:
	var keys: Dictionary[String, String] = {
		MOVE: RESOURCES + "test_move.tres",
		DEFAULTS: RESOURCES + "test_defaults.tres",
		POOL_OBJECT: RESOURCES + "test_pool_object.tscn",
	}
	ResourceCoreDev.set_test_key_list(keys)
	var started: bool = (
		LogCore.init() and EventCore.init() and TimeCore.init() and LocalDataCore.init() and ResourceCore.init()
		and PoolCore.init() and InputBlockCore.init() and TweenCore.init()
	)
	assert_true(started, "TweenCore and its dependencies init")
	recorder = _RECORDER.new()
	keep(recorder)
	assert_true(recorder.subscribe_started())


## Adds `node` to the tree and frees it after the test. Returns it.
func keep(node: Node) -> Node:
	(Engine.get_main_loop() as SceneTree).root.add_child(node)
	_nodes.append(node)
	return node


func node_2d() -> Node2D:
	return keep(Node2D.new()) as Node2D


## Moves the test clock and lets the core node run its frame processing after it.
func advance(ms: int) -> void:
	UnitTestCore.advance_clock(ms, false)
	await UnitTestCore.wait_frames(2)


## Waits until the frame this is called in has ended.
func frame_end() -> void:
	await UnitTestCore.wait_frames(1)


func errors() -> int:
	return UnitTestCore.check_logs(ERROR, TAG)


func change(
	property: TweenCore.TweenProperty, target: Vector4, duration: int, delay: int = 0,
	easing: TweenCore.Easing = TweenCore.Easing.LINEAR
) -> TweenChange:
	var made: TweenChange = TweenChange.new()
	made.property = property
	made.target_value = target
	made.duration = duration
	made.delay = delay
	made.easing = easing
	return made


## `change` that starts from `start_value`.
func change_from(
	property: TweenCore.TweenProperty, start_value: Vector4, target: Vector4, duration: int,
	easing: TweenCore.Easing = TweenCore.Easing.LINEAR
) -> TweenChange:
	var made: TweenChange = change(property, target, duration, 0, easing)
	made.use_start_value = true
	made.start_value = start_value
	return made


## `change` that does not use its start value, with `start_value` set.
func change_unused_start(
	property: TweenCore.TweenProperty, start_value: Vector4, target: Vector4, duration: int
) -> TweenChange:
	var made: TweenChange = change(property, target, duration)
	made.use_start_value = false
	made.start_value = start_value
	return made


func step(changes: Array[TweenChange]) -> TweenStep:
	var made: TweenStep = TweenStep.new()
	made.changes = changes
	return made


func definition(steps: Array[TweenStep], repeat_count: int = 1) -> TweenDefinition:
	var made: TweenDefinition = TweenDefinition.new()
	made.steps = steps
	made.repeat_count = repeat_count
	return made


## A definition of one step with one change.
func single(one: TweenChange, repeat_count: int = 1) -> TweenDefinition:
	return definition([step([one])], repeat_count)


## `Position` x from 0 to 100 in `duration` ms.
func move(duration: int = 100, repeat_count: int = 1) -> TweenDefinition:
	return single(change_from(TweenCore.TweenProperty.POSITION, Vector4.ZERO, Vector4(100, 0, 0, 0), duration),
			repeat_count)


## Options with the recorder callback, and the other values given.
func options(
	tag: String = "", input_block: bool = false, pass_list: BlockPassList = null,
	time_basis: TweenCore.TimeBasis = TweenCore.TimeBasis.REAL_TIME
) -> TweenOptions:
	var made: TweenOptions = TweenOptions.new()
	made.callback = recorder.on_end
	made.tag = tag
	made.input_block = input_block
	made.block_pass_list = pass_list
	made.time_basis = time_basis
	return made


## Number of active blocks of reason tag `tween`.
func tween_blocks() -> int:
	var count: int = InputBlockCoreDev.count_active()
	var buffer: Array[ActiveBlockInfo] = []
	buffer.resize(count)
	var filled: int = InputBlockCoreDev.list_active(buffer)
	var tween_count: int = 0
	for i: int in filled:
		if buffer[i].reason == "tween":
			tween_count += 1
	return tween_count


## One definition per definition check item, each breaking only that item, for a `Node2D` target.
func failing_definitions() -> Dictionary[String, TweenDefinition]:
	var empty_step: TweenStep = TweenStep.new()
	var nan_target: Vector4 = Vector4(NAN, 0, 0, 0)
	var flat: Vector4 = Vector4(1, 1, 0, 0)
	var position: TweenCore.TweenProperty = TweenCore.TweenProperty.POSITION
	var scale: TweenCore.TweenProperty = TweenCore.TweenProperty.SCALE
	var opacity: TweenCore.TweenProperty = TweenCore.TweenProperty.OPACITY
	var failing: Dictionary[String, TweenDefinition] = {
		"step without change": definition([step([change(position, flat, 100)]), empty_step]),
		"duration below 0": single(change(position, flat, -1)),
		"duration above max": single(change(position, flat, MAX_DURATION_MS + 1)),
		"delay below 0": single(change(position, flat, 100, -1)),
		"delay above max": single(change(position, flat, 100, MAX_DURATION_MS + 1)),
		"repeat count below 0": single(change(position, flat, 100), -1),
		"repeat count above max": single(change(position, flat, 100), MAX_REPEAT_COUNT + 1),
		"target value not finite": single(change(position, nan_target, 100)),
		"start value not finite": single(change_from(position, nan_target, flat, 100)),
		"color out of range": single(change(TweenCore.TweenProperty.COLOR, Vector4(1, 1, 1, 1.5), 100)),
		"opacity start out of range": single(change_from(opacity, Vector4(-0.5, 0, 0, 0), Vector4.ZERO, 100)),
		"opacity target in unused components": single(change(opacity, Vector4(1, 1, 1, 0), 100)),
		"opacity start in unused components": single(change_from(opacity, Vector4(0, 0, 0, 1), Vector4.ZERO, 100)),
		"unused start value not finite": single(change_unused_start(position, nan_target, flat, 100)),
		"unused opacity start out of range": single(
			change_unused_start(opacity, Vector4(1.5, 0, 0, 0), Vector4.ZERO, 100)
		),
		"unused opacity start in unused components": single(
			change_unused_start(opacity, Vector4(0, 0, 0, 1), Vector4.ZERO, 100)
		),
		"2D position target in unused components": single(change(position, Vector4(10, 20, 5, 0), 100)),
		"2D rotation target in unused components": single(
			change(TweenCore.TweenProperty.ROTATION, Vector4(90, 90, 0, 0), 100)
		),
		"forever with cycle time 0": single(change(position, flat, 0), 0),
		"one property twice in a step": definition([step([change(scale, flat, 100), change(scale, flat, 50)])]),
		"color and opacity in a step": definition([
			step([change(TweenCore.TweenProperty.COLOR, Vector4.ONE, 100), change(opacity, Vector4.ZERO, 100)])
		]),
	}
	return failing


## A definition that changes `Color` of an object without one: the target lacks the property for a `Node3D`.
func color_definition() -> TweenDefinition:
	return single(change(TweenCore.TweenProperty.COLOR, Vector4(1, 0, 0, 1), 100))
