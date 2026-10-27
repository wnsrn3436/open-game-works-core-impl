extends RefCounted
## Telemetry of `QACore`: the play record judge agents and performance checks read. Times are `TimeCore` device
## times (Unix ms). Durations and `play_at` are telemetry time: `TimeCore` real elapsed time while the time step mode
## is off, and the game time the steps moved while it is on.

const _JSON := preload("res://core/qa_core/dev/qa_json.gd")

## Feedback kinds, in the order of the feedback event table.
enum Feedback { SOUND, CAMERA_SHAKE, SCREEN_EFFECT, TWEEN, EFFECT }

const FEEDBACK_NAMES: PackedStringArray = ["Sound", "CameraShake", "ScreenEffect", "Tween", "Effect"]
const NO_LATENCY: int = -1


class InputRecord:
	extends RefCounted
	var at: int = 0
	## Telemetry time of the input.
	var time: int = 0
	var command: String = ""
	## ms to the first response event; `NO_LATENCY` when there is none yet.
	var latency_ms: int = NO_LATENCY
	## Count by `Feedback`.
	var feedback: PackedInt64Array = PackedInt64Array([0, 0, 0, 0, 0])


class RewardRecord:
	extends RefCounted
	var at: int = 0
	var play_at: int = 0
	var kind: String = ""
	var id: int = 0
	var amount: int = 0


class MarkRecord:
	extends RefCounted
	var at: int = 0
	var play_at: int = 0
	var kind: String = ""


class SpanRecord:
	extends RefCounted
	var start_at: int = 0
	var end_at: int = 0
	var duration_ms: int = 0


class GoalRecord:
	extends RefCounted
	var start_at: int = 0
	var end_at: int = 0
	var duration_ms: int = 0
	var input_count: int = 0


class SceneLoadRecord:
	extends RefCounted
	var at: int = 0
	var scene_key: String = ""
	var duration_ms: int = 0


var feedback_window_ms: int = 0
var idle_threshold_ms: int = 0
var max_records: int = 1

var started_at: int = 0
var dropped: int = 0
var inputs: Array[InputRecord] = []
var rewards: Array[RewardRecord] = []
var marks: Array[MarkRecord] = []
var idle_spans: Array[SpanRecord] = []
var goal_intervals: Array[GoalRecord] = []
var scene_loads: Array[SceneLoadRecord] = []

## Telemetry time folded so far, the real elapsed time and the game time it was folded at, and whether the time step
## mode was on then.
var _time_ms: int = 0
var _folded_real_ms: int = 0
var _folded_game_ms: int = 0
var _step_mode: bool = false
## Telemetry time of the start.
var _start_time: int = 0
## Last input or state event: telemetry time and device time.
var _last_activity_time: int = 0
var _last_activity_at: int = 0
## Start of the goal interval that goes on: device time and telemetry time.
var _goal_start_at: int = 0
var _goal_start_time: int = 0
var _goal_inputs: int = 0


## Empties every item and starts from now.
func start() -> void:
	fold()
	inputs.clear()
	rewards.clear()
	marks.clear()
	idle_spans.clear()
	goal_intervals.clear()
	scene_loads.clear()
	dropped = 0
	started_at = device_now()
	_start_time = _time_ms
	_last_activity_time = _time_ms
	_last_activity_at = started_at
	_goal_start_at = started_at
	_goal_start_time = _time_ms
	_goal_inputs = 0


## Telemetry time now. ms.
func now() -> int:
	fold()
	return _time_ms


## Adds the time since the last fold: the game time the steps moved when the time step mode was on, else the real
## elapsed time. Then reads whether step mode is on now. Call before and after step mode changes.
func fold() -> void:
	var real: int = _real_now()
	var game: int = _game_now()
	var increment: int = game - _folded_game_ms if _step_mode else real - _folded_real_ms
	if increment > 0:
		_time_ms += increment
	_folded_real_ms = real
	_folded_game_ms = game
	_step_mode = TimeCore.is_initialized() and TimeCoreDev.is_step_mode()


## Telemetry time since the start. ms.
func play_now() -> int:
	return now() - _start_time


func device_now() -> int:
	return TimeCore.get_device_time() if TimeCore.is_initialized() else 0


func add_input(command: String) -> void:
	var time: int = now()
	_activity(time)
	var record: InputRecord = InputRecord.new()
	record.at = device_now()
	record.time = time
	record.command = command
	_goal_inputs += 1
	inputs.append(record)
	if inputs.size() > max_records:
		inputs.pop_front()
		dropped += 1


## A release input: an input for idle spans only.
func add_release() -> void:
	_activity(now())


## A feedback event: counted on the last input in the feedback window, then a response event.
func add_feedback(kind: Feedback) -> void:
	var time: int = now()
	for i: int in range(inputs.size() - 1, -1, -1):
		var record: InputRecord = inputs[i]
		if time - record.time >= feedback_window_ms:
			break
		record.feedback[kind] += 1
		break
	add_response(time)


## A response event at telemetry time `time`: the latency of every input in the feedback window that has none.
func add_response(time: int) -> void:
	for i: int in range(inputs.size() - 1, -1, -1):
		var record: InputRecord = inputs[i]
		if time - record.time >= feedback_window_ms:
			break
		if record.latency_ms == NO_LATENCY:
			record.latency_ms = time - record.time
	add_state_event(time)


func add_state_event(time: int) -> void:
	_activity(time)


func add_reward(kind: String, id: int, amount: int) -> void:
	var record: RewardRecord = RewardRecord.new()
	record.at = device_now()
	record.play_at = play_now()
	record.kind = kind
	record.id = id
	record.amount = amount
	rewards.append(record)
	if rewards.size() > max_records:
		rewards.pop_front()
		dropped += 1


func add_mark(kind: String) -> void:
	var record: MarkRecord = MarkRecord.new()
	record.at = device_now()
	record.play_at = play_now()
	record.kind = kind
	marks.append(record)
	if marks.size() > max_records:
		marks.pop_front()
		dropped += 1


## A `Goal` mark: the interval from the telemetry start or the last `Goal` mark.
func add_goal() -> void:
	var time: int = now()
	var record: GoalRecord = GoalRecord.new()
	record.start_at = _goal_start_at
	record.end_at = device_now()
	record.duration_ms = time - _goal_start_time
	record.input_count = _goal_inputs
	goal_intervals.append(record)
	if goal_intervals.size() > max_records:
		goal_intervals.pop_front()
		dropped += 1
	_goal_start_at = record.end_at
	_goal_start_time = time
	_goal_inputs = 0


func add_scene_load(scene_key: String, duration_ms: int) -> void:
	var record: SceneLoadRecord = SceneLoadRecord.new()
	record.at = device_now()
	record.scene_key = scene_key
	record.duration_ms = duration_ms
	scene_loads.append(record)
	if scene_loads.size() > max_records:
		scene_loads.pop_front()
		dropped += 1


## Telemetry JSON. An idle span that goes on now has `end_at` and `duration_ms` `null`.
func to_json() -> String:
	var time: int = now()
	var input_items: PackedStringArray = PackedStringArray()
	for record: InputRecord in inputs:
		var feedback_pairs: PackedStringArray = PackedStringArray()
		for kind: int in FEEDBACK_NAMES.size():
			if record.feedback[kind] > 0:
				feedback_pairs.append(_JSON.pair(FEEDBACK_NAMES[kind], _JSON.integer(record.feedback[kind])))
		input_items.append(_JSON.object(PackedStringArray([
			_JSON.pair("at", _JSON.integer(record.at)),
			_JSON.pair("command", _JSON.text(record.command)),
			_JSON.pair("latency_ms", _JSON.NULL if record.latency_ms == NO_LATENCY else _JSON.integer(record.latency_ms)),
			_JSON.pair("feedback", _JSON.object(feedback_pairs)),
		])))
	var reward_items: PackedStringArray = PackedStringArray()
	for record: RewardRecord in rewards:
		reward_items.append(_JSON.object(PackedStringArray([
			_JSON.pair("at", _JSON.integer(record.at)),
			_JSON.pair("play_at", _JSON.integer(record.play_at)),
			_JSON.pair("kind", _JSON.text(record.kind)),
			_JSON.pair("id", _JSON.integer(record.id)),
			_JSON.pair("amount", _JSON.integer(record.amount)),
		])))
	var mark_items: PackedStringArray = PackedStringArray()
	for record: MarkRecord in marks:
		mark_items.append(_JSON.object(PackedStringArray([
			_JSON.pair("at", _JSON.integer(record.at)),
			_JSON.pair("play_at", _JSON.integer(record.play_at)),
			_JSON.pair("kind", _JSON.text(record.kind)),
		])))
	var span_items: PackedStringArray = PackedStringArray()
	for record: SpanRecord in idle_spans:
		span_items.append(_span_json(record.start_at, _JSON.integer(record.end_at), _JSON.integer(record.duration_ms)))
	if time - _last_activity_time > idle_threshold_ms:
		span_items.append(_span_json(_last_activity_at, _JSON.NULL, _JSON.NULL))
	var goal_items: PackedStringArray = PackedStringArray()
	for record: GoalRecord in goal_intervals:
		goal_items.append(_JSON.object(PackedStringArray([
			_JSON.pair("start_at", _JSON.integer(record.start_at)),
			_JSON.pair("end_at", _JSON.integer(record.end_at)),
			_JSON.pair("duration_ms", _JSON.integer(record.duration_ms)),
			_JSON.pair("input_count", _JSON.integer(record.input_count)),
		])))
	var scene_items: PackedStringArray = PackedStringArray()
	for record: SceneLoadRecord in scene_loads:
		scene_items.append(_JSON.object(PackedStringArray([
			_JSON.pair("at", _JSON.integer(record.at)),
			_JSON.pair("scene_key", _JSON.text(record.scene_key)),
			_JSON.pair("duration_ms", _JSON.integer(record.duration_ms)),
		])))
	return _JSON.object(PackedStringArray([
		_JSON.pair("started_at", _JSON.integer(started_at)),
		_JSON.pair("inputs", _JSON.array(input_items)),
		_JSON.pair("rewards", _JSON.array(reward_items)),
		_JSON.pair("marks", _JSON.array(mark_items)),
		_JSON.pair("idle_spans", _JSON.array(span_items)),
		_JSON.pair("goal_intervals", _JSON.array(goal_items)),
		_JSON.pair("scene_loads", _JSON.array(scene_items)),
		_JSON.pair("dropped", _JSON.integer(dropped)),
	]))


## An input or a state event at telemetry time `time`: closes an idle span longer than the threshold.
func _activity(time: int) -> void:
	if time - _last_activity_time > idle_threshold_ms:
		var span: SpanRecord = SpanRecord.new()
		span.start_at = _last_activity_at
		span.end_at = device_now()
		span.duration_ms = time - _last_activity_time
		idle_spans.append(span)
		if idle_spans.size() > max_records:
			idle_spans.pop_front()
			dropped += 1
	_last_activity_time = time
	_last_activity_at = device_now()


func _span_json(start_at: int, end_at_json: String, duration_json: String) -> String:
	return _JSON.object(PackedStringArray([
		_JSON.pair("start_at", _JSON.integer(start_at)),
		_JSON.pair("end_at", end_at_json),
		_JSON.pair("duration_ms", duration_json),
	]))


func _real_now() -> int:
	return TimeCore.get_real_time() if TimeCore.is_initialized() else 0


func _game_now() -> int:
	return TimeCore.get_game_time() if TimeCore.is_initialized() else 0
