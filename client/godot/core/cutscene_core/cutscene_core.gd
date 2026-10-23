class_name CutsceneCore
extends RefCounted
## Cutscene playback: runs the steps of a cutscene of the `cutscene_step` table in order and shows its lines and
## staging. Line progress, line voice, branches, choices, skip, cutscene pause and the line history.

enum CutsceneStatus { COMPLETED, SKIPPED, STOPPED, FAILED }

# What the playback waits for before it runs the next step: the value of `_hold`.
const _HOLD_NONE: int = 0
const _HOLD_LINE: int = 1
const _HOLD_CHOICE: int = 2
const _HOLD_WAIT: int = 3
const _HOLD_COMMAND: int = 4
const _HOLD_END: int = 5

const _TAG: String = "CutsceneCore"
const _VIEW_KEY: String = "cutsceneView"
const _TYPING_KEY: String = "CutsceneCore.typingIntervalMs"
const _AUTO_KEY: String = "CutsceneCore.autoAdvanceDelayMs"
const _FAST_FORWARD_KEY: String = "CutsceneCore.fastForwardDelayMs"
const _HISTORY_KEY: String = "CutsceneCore.lineHistoryMaxCount"
const _MAX_DURATION_KEY: String = "TweenCore.maxDurationMs"
const _REASON: String = "cutscene"
const _ADVANCE: StringName = &"cutscene_advance"
const _SKIP: StringName = &"cutscene_skip"
# `InputCore` binding names of gamepad buttons and gamepad axis directions, and the binding size settings.
const _PAD_BUTTON_NAMES: Array[String] = [
	"a", "b", "x", "y", "back", "guide", "start", "left_stick", "right_stick", "left_shoulder", "right_shoulder",
	"dpad_up", "dpad_down", "dpad_left", "dpad_right",
]
const _PAD_AXIS_NAMES: Array[String] = ["left_x", "left_y", "right_x", "right_y", "trigger_left", "trigger_right"]
const _MAX_KEYS_KEY: String = "InputCore.maxKeysPerAction"
const _MAX_PAD_BUTTONS_KEY: String = "InputCore.maxPadButtonsPerAction"
const _BACK: StringName = &"back"
const _FONT_SIZE: StringName = &"normal_font_size"
const _SCENE_KIND: int = ResourceCore.BaseKind.PACKED_SCENE
const _TEXTURE_KIND: int = ResourceCore.BaseKind.TEXTURE_2D
const _AUDIO_KIND: int = ResourceCore.BaseKind.AUDIO_STREAM
const _CORE_NODE := preload("res://core/cutscene_core/cutscene_core_node.gd")
const _COMMAND := preload("res://core/cutscene_core/cutscene_command.gd")
const _ENTRY := preload("res://core/cutscene_core/cutscene_history_entry.gd")
const _WAIT := preload("res://core/cutscene_core/cutscene_play_wait.gd")

static var _is_initialized: bool = false
static var _node: _CORE_NODE = null
## New at every `init`. A wait that resumes in another session does nothing.
static var _session: RefCounted = null
static var _safe_root: SafeAreaRoot = null
## The cutscene root.
static var _root: Control = null
static var _view_key: String = ""
static var _typing_interval_ms: int = 0
static var _auto_delay_ms: int = 0
static var _fast_forward_delay_ms: int = 0
static var _history_max: int = 0
static var _max_duration_ms: int = 0
## Instance ID of the registered actor of each actor key.
static var _actors: Dictionary[String, int] = {}
static var _block_pass_list: BlockPassList = null
static var _tween_options: TweenOptions = null
static var _scope_listener: Callable = Callable()
static var _back_callable: Callable = Callable()
static var _camera_runner: Callable = Callable()
static var _effect_runner: Callable = Callable()
static var _popup_runner: Callable = Callable()
static var _history_runner: Callable = Callable()
static var _history_bind: Callable = Callable()
# Deferred calls that frame code starts, so that step execution, skip, choice input and view focus run out of frame code.
static var _run_deferred: Callable = Callable()
static var _skip_deferred: Callable = Callable()
static var _choice_deferred: Callable = Callable()
static var _focus_deferred: Callable = Callable()
static var _command_serial: int = 0
## Number of the playback. A callback of an earlier playback does nothing.
static var _play_serial: int = 0
## Number of the cutscene pause. A pause popup button of an earlier pause does nothing.
static var _pause_serial: int = 0

# The playback.
static var _playing: bool = false
static var _wait: _WAIT = null
static var _cutscene_id: int = 0
static var _scope: Scope = null
static var _args: FormatArgs = null
static var _skippable: bool = true
static var _steps: Array[GameData.CutsceneStepRow] = []
## Index in `_steps` of each `step`.
static var _step_index: Dictionary[int, int] = {}
static var _textures: Dictionary[String, Texture2D] = {}
static var _scenes: Dictionary[String, PackedScene] = {}
static var _streams: Dictionary[String, Resource] = {}
static var _presets: Dictionary[String, TweenDefinition] = {}
static var _view_root: Control = null
static var _view: CutsceneView = null
static var _choice_buttons: Array[Button] = []
## Index in `_steps` of the next step.
static var _next: int = 0
static var _hold: int = _HOLD_NONE
static var _hold_command: _COMMAND = null
## `End` ran.
static var _ended: bool = false
## A deferred `_run` or view focus update is queued.
static var _run_pending: bool = false
static var _focus_pending: bool = false
static var _commands: Array[_COMMAND] = []
## Staging instances that playback end handling destroys.
static var _staged: Array[Node] = []
static var _loop_sounds: PackedInt64Array = PackedInt64Array()
static var _skipping: bool = false
static var _pending_bgm: bool = false
static var _pending_bgm_key: String = ""
static var _block_token: int = 0
static var _picked: Array[CutsceneChoiceRecord] = []
static var _auto_on: bool = false
static var _fast_forward_on: bool = false
static var _last_advance_frame: int = -1
static var _last_skip_frame: int = -1
## The last input event the core node got and its process frame. A click of the GUI stage comes from the event that
## the core node got last, before that stage: the device input of an advance button click.
static var _input_event: InputEvent = null
static var _input_event_frame: int = -1
## Direction (`true`: positive) of the last pressed (`InputEvent.is_pressed`) event of each gamepad axis that matched
## `ui_accept` exactly, by device and axis, that the core node got during the playback: the direction a not-pressed
## event of that axis releases.
static var _axis_press_positive: Dictionary[Vector2i, bool] = {}
# Cutscene pause.
static var _paused: bool = false
## `TimeCore.set_paused(true)` was called by the cutscene pause.
static var _paused_time: bool = false
static var _pause_started_ms: int = 0
## Real elapsed time of the ended cutscene pauses of the playback.
static var _paused_total_ms: int = 0
# Line history.
static var _history: Array[_ENTRY] = []
static var _history_open: bool = false
static var _replay_handle: int = SoundCore.INVALID_HANDLE
# The running `Line`; times are on the playback clock (`_clock`).
static var _line_start_ms: int = 0
static var _line_total: int = 0
static var _line_visible: int = 0
## When the whole text became visible. -1: not yet.
static var _full_at_ms: int = -1
static var _voice_handle: int = SoundCore.INVALID_HANDLE
## When the line reached voice end. -1: not yet.
static var _voice_end_ms: int = -1
## The auto advance wait starts no earlier than this: the last turn on or line history close.
static var _auto_from_ms: int = 0
## Start of the fast forward wait.
static var _fast_forward_from_ms: int = 0
# The running `Wait`.
static var _wait_ms: int = 0
static var _wait_counting: bool = false
static var _wait_start_ms: int = 0
# The running `Choice`.
static var _choice_rows: Array[GameData.CutsceneChoiceRow] = []
static var _choice_locked: Array[bool] = []
static var _choice_step: int = 0


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init: already initialized")
		return false
	for key: String in [_TYPING_KEY, _AUTO_KEY, _FAST_FORWARD_KEY, _HISTORY_KEY, _MAX_DURATION_KEY]:
		if not CoreSettings.has_int(key):
			LogCore.log_error(_TAG, "init: core settings key %s is missing or not an integer" % key)
			return false
	if not CoreSettings.has_string(_VIEW_KEY):
		LogCore.log_error(_TAG, "init: game settings item cutsceneView is missing or not a string")
		return false
	var layer: CanvasLayer = UICore.get_layer(UICore.UILayer.CUTSCENE)
	if layer == null:
		LogCore.log_error(_TAG, "init: UICore gave no Cutscene layer")
		return false
	_typing_interval_ms = CoreSettings.get_int(_TYPING_KEY)
	_auto_delay_ms = CoreSettings.get_int(_AUTO_KEY)
	_fast_forward_delay_ms = CoreSettings.get_int(_FAST_FORWARD_KEY)
	_history_max = CoreSettings.get_int(_HISTORY_KEY)
	_max_duration_ms = CoreSettings.get_int(_MAX_DURATION_KEY)
	_view_key = CoreSettings.get_string(_VIEW_KEY)
	_session = RefCounted.new()
	_safe_root = SafeAreaRoot.new()
	_safe_root.name = "CutsceneSafeArea"
	_root = Control.new()
	_root.name = "CutsceneRoot"
	_root.mouse_filter = Control.MOUSE_FILTER_STOP
	_root.visible = false
	_safe_root.add_child(_root)
	layer.add_child(_safe_root)
	_root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_block_pass_list = BlockPassList.new()
	_tween_options = TweenOptions.new()
	_tween_options.time_basis = TweenCore.TimeBasis.GAME_TIME
	_scope_listener = CutsceneCore._on_scope_released
	_back_callable = CutsceneCore._on_back
	_camera_runner = CutsceneCore._run_camera
	_effect_runner = CutsceneCore._run_effect
	_popup_runner = CutsceneCore._run_pause_popup
	_history_runner = CutsceneCore._run_history_fill
	_history_bind = CutsceneCore._bind_history_item
	_run_deferred = CutsceneCore._on_run_deferred
	_skip_deferred = CutsceneCore._on_skip_deferred
	_choice_deferred = CutsceneCore._on_choice_deferred
	_focus_deferred = CutsceneCore._on_focus_deferred
	ResourceCore.add_scope_release_listener(_scope_listener)
	_node = _CORE_NODE.new()
	_is_initialized = true
	(Engine.get_main_loop() as SceneTree).root.add_child(_node)
	return true


static func release() -> void:
	if not _is_initialized:
		return
	if _playing:
		_stop()
	var node: _CORE_NODE = _node
	if is_instance_valid(node):
		node.released = true
		var parent: Node = node.get_parent()
		if parent != null:
			parent.remove_child(node)
		node.queue_free()
	if ResourceCore.is_initialized():
		ResourceCore.remove_scope_release_listener(_scope_listener)
	if is_instance_valid(_safe_root):
		var parent: Node = _safe_root.get_parent()
		if parent != null:
			parent.remove_child(_safe_root)
		_safe_root.free()
	_reset_module()


static func is_initialized() -> bool:
	return _is_initialized


## Async. Plays the cutscene `cutscene_id` with the resources of `scope` and ends with its result. `args` converts the
## line and choice texts; `null` is empty. A playback that is not skippable has no skip.
static func play(cutscene_id: int, scope: Scope, args: FormatArgs = null, skippable: bool = true) -> CutsceneResult:
	if not _check_initialized("play"):
		return _failed_result()
	if _playing:
		LogCore.log_error(_TAG, "play of cutscene %d while cutscene %d plays" % [cutscene_id, _cutscene_id])
		return _failed_result()
	if scope == null or scope.released:
		LogCore.log_error(_TAG, "play of cutscene %d without a resource scope or with a released one" % cutscene_id)
		return _failed_result()
	if not GameData.CutsceneStepTable.has_rows(cutscene_id):
		LogCore.log_error(_TAG, "play: cutscene %d has no step" % cutscene_id)
		return _failed_result()
	var steps: Array[GameData.CutsceneStepRow] = GameData.CutsceneStepTable.get_rows(cutscene_id).duplicate()
	steps.sort_custom(CutsceneCore._is_step_before)
	var problem: String = _cutscene_check(cutscene_id, steps)
	if not problem.is_empty():
		LogCore.log_error(_TAG, "play: cutscene %d fails the cutscene check: %s" % [cutscene_id, problem])
		return _failed_result()
	# 2. The cutscene root and the block.
	_play_serial += 1
	var serial: int = _play_serial
	var session: RefCounted = _session
	var wait: _WAIT = _WAIT.new()
	_wait = wait
	_playing = true
	_cutscene_id = cutscene_id
	_scope = scope
	_args = args if args != null else FormatArgs.new()
	_skippable = skippable
	_steps = steps
	_step_index = {}
	for index: int in steps.size():
		_step_index[steps[index].step] = index
	_root.visible = true
	_block_pass_list.actions = [_ADVANCE, _SKIP, _BACK]
	var elements: Array[Control] = [_root]
	var system: BlockPassList = UICore.get_block_pass_list()
	if system != null:
		elements.append_array(system.elements)
	_block_pass_list.elements = elements
	_block_token = InputBlockCore.block(_REASON, _block_pass_list)
	UICore.set_back_override(_back_callable)
	# 3. Preload with the playback scope.
	var request: PreloadRequest = _preload_request(steps)
	await ResourceCore.preload_resources(request, scope)
	if session != _session or serial != _play_serial or not _playing:
		return wait.result if wait.finished else _failed_result()
	var textures: Dictionary[String, Texture2D] = {}
	var scenes: Dictionary[String, PackedScene] = {}
	var streams: Dictionary[String, Resource] = {}
	var presets: Dictionary[String, TweenDefinition] = {}
	var tween_kind: int = TweenCore.get_preset_kind()
	for item: PreloadRequest.Item in request.items:
		var resource: Resource = await ResourceCore.load(item.key, item.kind, scope)
		if session != _session or serial != _play_serial or not _playing:
			return wait.result if wait.finished else _failed_result()
		if item.kind == _TEXTURE_KIND:
			textures[item.key] = resource as Texture2D
		elif item.kind == _SCENE_KIND:
			scenes[item.key] = resource as PackedScene
		elif item.kind == _AUDIO_KIND:
			streams[item.key] = resource
		elif item.kind == tween_kind:
			presets[item.key] = resource as TweenDefinition
	_textures = textures
	_scenes = scenes
	_streams = streams
	_presets = presets
	# 4. The cutscene view.
	if not _attach_view():
		_fail_start()
		return _failed_result()
	# 5. The first step.
	_run()
	if not wait.finished:
		await wait.done
	return wait.result


static func is_playing() -> bool:
	if not _check_initialized("is_playing"):
		return false
	return _playing


## Registers `object` (`Node2D` or `Node3D`) as the actor of `actor_key`.
# ogw:input_boundary
static func register_actor(actor_key: String, object: Variant) -> bool:
	if not _check_initialized("register_actor"):
		return false
	if typeof(object) != TYPE_OBJECT or not is_instance_valid(object):
		LogCore.log_error(_TAG, "register_actor %s: the object is missing or destroyed" % actor_key)
		return false
	if not (object is Node2D or object is Node3D):
		LogCore.log_error(_TAG, "register_actor %s: the object is neither a Node2D nor a Node3D" % actor_key)
		return false
	if _actor(actor_key) != null:
		LogCore.log_error(_TAG, "register_actor: actor key %s is registered" % actor_key)
		return false
	var node: Node = object
	_actors[actor_key] = node.get_instance_id()
	return true


static func unregister_actor(actor_key: String) -> void:
	if not _check_initialized("unregister_actor"):
		return
	_actors.erase(actor_key)


# --- Internal: lifecycle ---


static func _check_initialized(operation: String) -> bool:
	if _is_initialized:
		return true
	LogCore.log_error(_TAG, operation + ": not initialized")
	return false


## The core node left the tree outside `release`: app exit or tree teardown. Cleans up as `release` does.
static func _on_node_exit() -> void:
	if not _is_initialized:
		return
	if _playing:
		_stop()
	if ResourceCore.is_initialized():
		ResourceCore.remove_scope_release_listener(_scope_listener)
	if is_instance_valid(_safe_root):
		_safe_root.queue_free()
	_reset_module()


static func _reset_module() -> void:
	_is_initialized = false
	_node = null
	_session = null
	_safe_root = null
	_root = null
	_view_key = ""
	_typing_interval_ms = 0
	_auto_delay_ms = 0
	_fast_forward_delay_ms = 0
	_history_max = 0
	_max_duration_ms = 0
	_actors = {}
	_block_pass_list = null
	_tween_options = null
	_scope_listener = Callable()
	_back_callable = Callable()
	_camera_runner = Callable()
	_effect_runner = Callable()
	_popup_runner = Callable()
	_history_runner = Callable()
	_history_bind = Callable()
	_run_deferred = Callable()
	_skip_deferred = Callable()
	_choice_deferred = Callable()
	_focus_deferred = Callable()
	_command_serial = 0
	_play_serial = 0
	_pause_serial = 0
	_reset_playback()


static func _reset_playback() -> void:
	_playing = false
	_wait = null
	_cutscene_id = 0
	_scope = null
	_args = null
	_skippable = true
	_steps = []
	_step_index = {}
	_textures = {}
	_scenes = {}
	_streams = {}
	_presets = {}
	_view_root = null
	_view = null
	_choice_buttons = []
	_next = 0
	_hold = _HOLD_NONE
	_hold_command = null
	_ended = false
	_run_pending = false
	_focus_pending = false
	_commands = []
	_staged = []
	_loop_sounds = PackedInt64Array()
	_skipping = false
	_pending_bgm = false
	_pending_bgm_key = ""
	_block_token = 0
	_picked = []
	_auto_on = false
	_fast_forward_on = false
	_last_advance_frame = -1
	_last_skip_frame = -1
	_input_event = null
	_input_event_frame = -1
	_axis_press_positive = {}
	_paused = false
	_paused_time = false
	_pause_started_ms = 0
	_paused_total_ms = 0
	_history = []
	_history_open = false
	_replay_handle = SoundCore.INVALID_HANDLE
	_reset_line()
	_wait_ms = 0
	_wait_counting = false
	_wait_start_ms = 0
	_choice_rows = []
	_choice_locked = []
	_choice_step = 0


static func _reset_line() -> void:
	_line_start_ms = 0
	_line_total = 0
	_line_visible = 0
	_full_at_ms = -1
	_voice_handle = SoundCore.INVALID_HANDLE
	_voice_end_ms = -1
	_auto_from_ms = 0
	_fast_forward_from_ms = 0


static func _failed_result() -> CutsceneResult:
	var result: CutsceneResult = CutsceneResult.new()
	result.status = CutsceneStatus.FAILED
	return result


# --- Internal: actors ---


## The registered actor node of `actor_key`, or `null`. A destroyed actor's registration is removed.
static func _actor(actor_key: String) -> Node:
	if not _actors.has(actor_key):
		return null
	var id: int = _actors[actor_key]
	if not is_instance_id_valid(id):
		_actors.erase(actor_key)
		return null
	return instance_from_id(id) as Node


## Whether `object` is the registered actor of `actor_key`. For `CutsceneActor`.
# ogw:input_boundary
static func _is_registered(actor_key: String, object: Variant) -> bool:
	if not _actors.has(actor_key) or typeof(object) != TYPE_OBJECT or not is_instance_valid(object):
		return false
	var node: Object = object
	return _actors[actor_key] == node.get_instance_id()


static func _actor_or_log(actor_key: String, step: int) -> Node:
	var actor: Node = _actor(actor_key)
	if actor == null:
		LogCore.log_error(_TAG, "cutscene %d step %d: actor %s is not registered" % [_cutscene_id, step, actor_key])
	return actor


## World position of an actor node: `global_position`, (x, y, 0) for a `Node2D`.
static func _world_position(node: Node) -> Vector3:
	if node is Node3D:
		return (node as Node3D).global_position
	if node is Node2D:
		var position: Vector2 = (node as Node2D).global_position
		return Vector3(position.x, position.y, 0.0)
	return Vector3.ZERO


## `world` in the coordinates of the parent of `actor`. A parent that does not transform the actor's dimension
## (a non-`CanvasItem` for a 2D actor, a non-`Node3D` for a 3D actor) leaves `world` as it is; z is 0 for a 2D actor.
static func _parent_position(actor: Node, world: Vector3) -> Vector3:
	var parent: Node = actor.get_parent()
	if actor is Node3D:
		return (parent as Node3D).to_local(world) if parent is Node3D else world
	if parent is CanvasItem:
		var local: Vector2 = (parent as CanvasItem).get_global_transform().affine_inverse() * Vector2(world.x, world.y)
		return Vector3(local.x, local.y, 0.0)
	return Vector3(world.x, world.y, 0.0)


static func _animation_player_of(actor: Node) -> AnimationPlayer:
	for child: Node in actor.get_children():
		if child is CutsceneActor:
			var player: AnimationPlayer = (child as CutsceneActor).animation_player
			return player if is_instance_valid(player) else null
	return null


# --- Internal: cutscene check ---


static func _is_step_before(a: GameData.CutsceneStepRow, b: GameData.CutsceneStepRow) -> bool:
	return a.step < b.step


static func _is_choice_before(a: GameData.CutsceneChoiceRow, b: GameData.CutsceneChoiceRow) -> bool:
	return a.choice < b.choice


static func _is_snake_case(text: String) -> bool:
	if text.is_empty() or text.begins_with("_") or text.ends_with("_") or text.contains("__"):
		return false
	for index: int in text.length():
		var code: int = text.unicode_at(index)
		var lower: bool = code >= 97 and code <= 122
		var digit: bool = code >= 48 and code <= 57
		if not lower and not digit and code != 95:
			return false
	var first: int = text.unicode_at(0)
	return first >= 97 and first <= 122


static func _is_wait_choice(command: GameData.CutsceneCommand) -> bool:
	return command in [
		GameData.CutsceneCommand.MOVE, GameData.CutsceneCommand.ANIMATE, GameData.CutsceneCommand.CAMERA,
		GameData.CutsceneCommand.SCREEN_EFFECT, GameData.CutsceneCommand.STAGING,
	]


## Whether `command` uses `column`: 0 it does not, 1 it does and the column may be empty, 2 it must not be empty.
static func _use_of(command: GameData.CutsceneCommand, column: String) -> int:
	var optional: Array[GameData.CutsceneCommand] = []
	var required: Array[GameData.CutsceneCommand] = []
	match column:
		"wait":
			return 1 if _is_wait_choice(command) else 0
		"actor":
			optional = [GameData.CutsceneCommand.STAGING]
			required = [GameData.CutsceneCommand.MOVE, GameData.CutsceneCommand.ANIMATE]
		"target":
			required = [GameData.CutsceneCommand.MOVE, GameData.CutsceneCommand.CAMERA]
		"speaker", "voice":
			optional = [GameData.CutsceneCommand.LINE]
		"text":
			required = [GameData.CutsceneCommand.LINE]
		"resource":
			optional = [GameData.CutsceneCommand.LINE, GameData.CutsceneCommand.BGM]
			required = [
				GameData.CutsceneCommand.MOVE, GameData.CutsceneCommand.CAMERA, GameData.CutsceneCommand.SOUND,
				GameData.CutsceneCommand.SCREEN_EFFECT, GameData.CutsceneCommand.STAGING,
			]
		"animation":
			required = [GameData.CutsceneCommand.ANIMATE]
		"duration":
			required = [GameData.CutsceneCommand.WAIT]
		"cue":
			required = [GameData.CutsceneCommand.CUE]
		"next_step":
			required = [GameData.CutsceneCommand.JUMP, GameData.CutsceneCommand.BRANCH]
		"requirement":
			required = [GameData.CutsceneCommand.BRANCH]
	if command in required:
		return 2
	return 1 if command in optional else 0


## Whether a column of `row` holds the empty value of its type. A null `duration` reads as 0 here, so a `duration` is
## empty only when it is 0 and the command does not use it.
static func _is_empty(row: GameData.CutsceneStepRow, column: String) -> bool:
	match column:
		"wait":
			return not row.wait
		"actor":
			return row.actor.is_empty()
		"target":
			return row.target.is_empty()
		"speaker":
			return row.speaker == 0
		"text":
			return row.text.is_empty()
		"resource":
			return row.resource.is_empty()
		"animation":
			return row.animation.is_empty()
		"duration":
			return row.duration == 0
		"cue":
			return row.cue == GameData.CutsceneCue.NONE
		"next_step":
			return row.next_step == 0
		"voice":
			return row.voice.is_empty()
		"requirement":
			return row.requirement == 0
	return true


## The `## data` data check rules on the rows of one cutscene: the first broken rule, or an empty string.
static func _cutscene_check(cutscene_id: int, steps: Array[GameData.CutsceneStepRow]) -> String:
	var numbers: Dictionary[int, GameData.CutsceneCommand] = {}
	var voices: Dictionary[String, bool] = {}
	for row: GameData.CutsceneStepRow in steps:
		if row.step < 1:
			return "step %d is less than 1" % row.step
		if numbers.has(row.step):
			return "step %d is in two rows" % row.step
		numbers[row.step] = row.command
		if not row.voice.is_empty():
			if voices.has(row.voice):
				return "voice %s is in two rows" % row.voice
			voices[row.voice] = true
	var columns: PackedStringArray = [
		"wait", "actor", "target", "speaker", "text", "resource", "animation", "duration", "cue", "next_step", "voice",
		"requirement",
	]
	for row: GameData.CutsceneStepRow in steps:
		if row.command == GameData.CutsceneCommand.NONE:
			return "step %d has no command" % row.step
		for column: String in columns:
			var use: int = _use_of(row.command, column)
			var empty: bool = _is_empty(row, column)
			if use == 0 and not empty:
				return "step %d: the command does not use %s, which is not empty" % [row.step, column]
			if use == 2 and empty and column != "duration":
				return "step %d: %s is empty" % [row.step, column]
		for name: String in [row.actor, row.target]:
			if not name.is_empty() and not _is_snake_case(name):
				return "step %d: %s is not snake_case" % [row.step, name]
		if row.next_step != 0:
			if not numbers.has(row.next_step):
				return "step %d: next_step %d is not a step" % [row.step, row.next_step]
			if row.next_step <= row.step:
				return "step %d: next_step %d is not after the step" % [row.step, row.next_step]
	var open: Dictionary[int, bool] = {}
	var picked: Dictionary[Vector2i, bool] = {}
	var choices: Array[GameData.CutsceneChoiceRow] = []
	if GameData.CutsceneChoiceTable.has_rows(cutscene_id):
		choices = GameData.CutsceneChoiceTable.get_rows(cutscene_id)
	for choice: GameData.CutsceneChoiceRow in choices:
		var key: Vector2i = Vector2i(choice.step, choice.choice)
		if picked.has(key):
			return "step %d choice %d is in two cutscene_choice rows" % [choice.step, choice.choice]
		picked[key] = true
		if not numbers.has(choice.step):
			return "cutscene_choice step %d is not a step" % choice.step
		if numbers[choice.step] != GameData.CutsceneCommand.CHOICE:
			return "cutscene_choice step %d is not a Choice" % choice.step
		if not numbers.has(choice.next_step):
			return "step %d choice %d: next_step %d is not a step" % [choice.step, choice.choice, choice.next_step]
		if choice.requirement == 0:
			open[choice.step] = true
	for row: GameData.CutsceneStepRow in steps:
		if row.command == GameData.CutsceneCommand.CHOICE and not open.has(row.step):
			return "Choice step %d has no choice without a requirement" % row.step
	return ""


# --- Internal: start ---


## The preload request of the view resource and the `resource` and `voice` of the steps, each key and kind once.
static func _preload_request(steps: Array[GameData.CutsceneStepRow]) -> PreloadRequest:
	var request: PreloadRequest = PreloadRequest.new()
	var added: Dictionary[String, bool] = {}
	_add_item(request, added, _view_key, _SCENE_KIND)
	var tween_kind: int = TweenCore.get_preset_kind()
	for row: GameData.CutsceneStepRow in steps:
		if not row.voice.is_empty():
			_add_item(request, added, row.voice, _AUDIO_KIND)
		if row.resource.is_empty():
			continue
		match row.command:
			GameData.CutsceneCommand.LINE:
				_add_item(request, added, row.resource, _TEXTURE_KIND)
			GameData.CutsceneCommand.SOUND, GameData.CutsceneCommand.BGM:
				_add_item(request, added, row.resource, _AUDIO_KIND)
			GameData.CutsceneCommand.STAGING:
				_add_item(request, added, row.resource, _SCENE_KIND)
			GameData.CutsceneCommand.MOVE, GameData.CutsceneCommand.CAMERA, GameData.CutsceneCommand.SCREEN_EFFECT:
				_add_item(request, added, row.resource, tween_kind)
	return request


static func _add_item(request: PreloadRequest, added: Dictionary[String, bool], key: String, kind: int) -> void:
	var name: String = "%d:%s" % [kind, key]
	if added.has(name):
		return
	added[name] = true
	request.add_item(key, kind)


## 4: makes the cutscene view, puts it on the cutscene root and does the view check. False when it fails.
static func _attach_view() -> bool:
	if not ResourceCore.is_loaded(_view_key, _SCENE_KIND) or not _scenes.has(_view_key) or _scenes[_view_key] == null:
		LogCore.log_error(_TAG, "play: the cutscene view resource %s could not be loaded" % _view_key)
		return false
	var instance: Node = _scenes[_view_key].instantiate()
	var problem: String = _view_check(instance)
	if not problem.is_empty():
		LogCore.log_error(_TAG, "play: the cutscene view %s fails the view check: %s" % [_view_key, problem])
		if instance != null:
			instance.free()
		return false
	_view_root = instance as Control
	_view = _view_component(instance)
	_root.add_child(_view_root)
	_view_root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_view.text_label.bbcode_enabled = true
	_view.dialogue_box.visible = false
	_choice_buttons = []
	for button: Button in _view.choice_buttons:
		if _has_ui_button(button):
			_choice_buttons.append(button)
	for index: int in _choice_buttons.size():
		var button: Button = _choice_buttons[index]
		button.visible = false
		button.disabled = false
		_ui_button_of(button).set_on_click(CutsceneCore._on_choice_click.bind(_play_serial, index))
	_ui_button_of(_view.advance_button).set_on_click(CutsceneCore._on_advance_click.bind(_play_serial))
	_ui_button_of(_view.skip_button).set_on_click(CutsceneCore._on_skip_click.bind(_play_serial))
	_view.skip_button.visible = _skippable
	if _has_ui_button(_view.auto_advance_button):
		_view.auto_advance_button.set_pressed_no_signal(false)
		_ui_button_of(_view.auto_advance_button).set_on_click(CutsceneCore._on_auto_click.bind(_play_serial))
	if _has_ui_button(_view.fast_forward_button):
		_view.fast_forward_button.set_pressed_no_signal(false)
		_ui_button_of(_view.fast_forward_button).set_on_click(CutsceneCore._on_fast_forward_click.bind(_play_serial))
	if _has_history():
		_view.line_history_window.visible = false
		_ui_button_of(_view.line_history_button).set_on_click(CutsceneCore._on_history_click.bind(_play_serial))
		_ui_button_of(_view.line_history_close_button).set_on_click(
				CutsceneCore._on_history_close_click.bind(_play_serial))
	return true


static func _view_component(instance: Node) -> CutsceneView:
	if instance == null:
		return null
	for child: Node in instance.get_children():
		if child is CutsceneView:
			return child as CutsceneView
	return null


## The view check: the first broken rule, or an empty string.
static func _view_check(instance: Node) -> String:
	if not instance is Control:
		return "the view root is not a UI element"
	var view: CutsceneView = _view_component(instance)
	if view == null:
		return "the view root has no CutsceneView"
	if view.staging_parent == null or view.dialogue_box == null or view.speaker_label == null \
			or view.portrait == null or view.text_label == null:
		return "a required part is missing"
	var choices: int = 0
	for button: Button in view.choice_buttons:
		if _has_ui_button(button):
			choices += 1
	if choices == 0:
		return "there is no choice button"
	if not _has_ui_button(view.advance_button) or not _has_ui_button(view.skip_button):
		return "the advance button or the skip button is missing"
	if not _ui_button_of(view.advance_button).get_action().is_empty() \
			or not _ui_button_of(view.skip_button).get_action().is_empty():
		return "the UIButton action of the advance button or the skip button is not empty"
	var history: int = 0
	if _has_ui_button(view.line_history_button):
		history += 1
	if view.line_history_window != null:
		history += 1
	if view.line_history_list != null:
		history += 1
	if _has_ui_button(view.line_history_close_button):
		history += 1
	if history != 0 and history != 4:
		return "some line history parts are missing"
	return ""


static func _has_history() -> bool:
	return _view != null and _has_ui_button(_view.line_history_button) and _view.line_history_window != null \
			and _view.line_history_list != null and _has_ui_button(_view.line_history_close_button)


static func _has_ui_button(control: Control) -> bool:
	return _ui_button_of(control) != null


static func _ui_button_of(control: Control) -> UIButton:
	if control == null or not is_instance_valid(control):
		return null
	for index: int in control.get_child_count():
		var child: Node = control.get_child(index)
		if child is UIButton:
			return child as UIButton
	return null


## 4 failed: the end of a cutscene pause for `TimeCore`, back override none, the root hidden, the block lifted, no
## playback.
static func _fail_start() -> void:
	if _paused and _paused_time and TimeCore.is_initialized():
		TimeCore.set_paused(false)
	UICore.set_back_override(Callable())
	_root.visible = false
	_unblock()
	var wait: _WAIT = _wait
	_reset_playback()
	if wait != null:
		wait.finish(_failed_result())


static func _unblock() -> void:
	if _block_token != 0 and InputBlockCore.is_initialized() and InputBlockCore.is_active(_block_token):
		InputBlockCore.unblock(_block_token)
	_block_token = 0


# --- Internal: steps ---


## Runs steps until the playback waits for something or reaches playback end. Not frame code: frame code calls
## `_request_run`. Before playback 4 attaches the view it does nothing, and 5 runs the first step.
static func _run() -> void:
	if _view == null:
		return
	while _playing and not _paused and _hold == _HOLD_NONE:
		if _ended or _next >= _steps.size():
			if not _skipping and _has_in_progress():
				_hold = _HOLD_END
				break
			if _skipping:
				_apply_pending_bgm()
				_finish_playback(CutsceneStatus.SKIPPED)
			else:
				_finish_playback(CutsceneStatus.COMPLETED)
			return
		var row: GameData.CutsceneStepRow = _steps[_next]
		_next += 1
		_execute(row)
	if _playing:
		_update_focus()


## Frame code. Runs the next steps in a deferred call.
static func _request_run() -> void:
	if _run_pending:
		return
	_run_pending = true
	_run_deferred.call_deferred(_session, _play_serial)


static func _on_run_deferred(session: RefCounted, serial: int) -> void:
	if session != _session or serial != _play_serial:
		return
	_run_pending = false
	_run()


static func _execute(row: GameData.CutsceneStepRow) -> void:
	if row.command != GameData.CutsceneCommand.LINE and row.command != GameData.CutsceneCommand.CHOICE:
		_view.dialogue_box.visible = false
	match row.command:
		GameData.CutsceneCommand.LINE:
			if not _skipping:
				_start_line(row)
		GameData.CutsceneCommand.CHOICE:
			if _skipping:
				_apply_pending_bgm()
				_skipping = false
			_start_choice(row)
		GameData.CutsceneCommand.WAIT:
			if not _skipping:
				_hold = _HOLD_WAIT
				_wait_ms = row.duration
				_wait_counting = false
				_check_wait()
		GameData.CutsceneCommand.MOVE, GameData.CutsceneCommand.ANIMATE, GameData.CutsceneCommand.CAMERA, \
				GameData.CutsceneCommand.SCREEN_EFFECT, GameData.CutsceneCommand.STAGING:
			if _skipping and row.command == GameData.CutsceneCommand.STAGING:
				return
			var command: _COMMAND = _start_command(row)
			if command == null:
				return
			if _skipping:
				_finalize(command)
			elif row.wait:
				_hold = _HOLD_COMMAND
				_hold_command = command
		GameData.CutsceneCommand.SOUND:
			if not _skipping:
				_play_sound(row.resource)
		GameData.CutsceneCommand.BGM:
			if _skipping:
				_pending_bgm = true
				_pending_bgm_key = row.resource
			else:
				_apply_bgm(row.resource)
		GameData.CutsceneCommand.CUE:
			_publish_cue(row)
		GameData.CutsceneCommand.JUMP:
			_go_to(row.next_step)
		GameData.CutsceneCommand.BRANCH:
			var result: RequirementResult = RequirementCore.evaluate(row.requirement)
			if result != null and result.passed:
				_go_to(row.next_step)
		GameData.CutsceneCommand.END:
			_ended = true


static func _go_to(step: int) -> void:
	if _step_index.has(step):
		_next = _step_index[step]
	else:
		_ended = true


static func _play_sound(key: String) -> void:
	var handle: int = SoundCore.play(key, SoundCore.SoundBus.SFX, _scope)
	if handle != SoundCore.INVALID_HANDLE and _is_loop_sound(_streams[key] if _streams.has(key) else null):
		_loop_sounds.append(handle)


## Whether the preloaded sound repeats. `SoundCore.play` picks one variant of a `ResourceVariants` and does not tell
## which, so a key with variants repeats when any variant repeats.
static func _is_loop_sound(resource: Resource) -> bool:
	var variants: ResourceVariants = resource as ResourceVariants
	if variants == null:
		return _is_loop_stream(resource as AudioStream)
	for item: Resource in variants.items:
		if _is_loop_stream(item as AudioStream):
			return true
	return false


static func _is_loop_stream(stream: AudioStream) -> bool:
	if stream is AudioStreamWAV:
		return (stream as AudioStreamWAV).loop_mode != AudioStreamWAV.LOOP_DISABLED
	if stream is AudioStreamOggVorbis:
		return (stream as AudioStreamOggVorbis).loop
	if stream is AudioStreamMP3:
		return (stream as AudioStreamMP3).loop
	return false


static func _apply_bgm(key: String) -> void:
	if key.is_empty():
		SoundCore.stop_bgm()
	else:
		SoundCore.play_bgm(key, _scope)


static func _apply_pending_bgm() -> void:
	if not _pending_bgm:
		return
	_pending_bgm = false
	_apply_bgm(_pending_bgm_key)
	_pending_bgm_key = ""


static func _publish_cue(row: GameData.CutsceneStepRow) -> void:
	if row.cue == GameData.CutsceneCue.NONE:
		return
	var event := EventCore.acquire(CutsceneCueEvent) as CutsceneCueEvent
	if event == null:
		return
	event.cutscene_id = _cutscene_id
	event.step = row.step
	event.cue = row.cue
	EventCore.publish(event)


# --- Internal: wait choice commands ---


## Starts a wait choice command. Returns it, or `null` when it ended at once.
static func _start_command(row: GameData.CutsceneStepRow) -> _COMMAND:
	_drop_done_commands()
	match row.command:
		GameData.CutsceneCommand.MOVE:
			return _start_move(row)
		GameData.CutsceneCommand.ANIMATE:
			return _start_animate(row)
		GameData.CutsceneCommand.CAMERA:
			return _start_camera(row)
		GameData.CutsceneCommand.SCREEN_EFFECT:
			return _start_effect(row)
		GameData.CutsceneCommand.STAGING:
			return _start_staging(row)
	return null


static func _preset(key: String) -> TweenDefinition:
	return _presets[key] if _presets.has(key) else null


## The first change of the first step of `definition`, or `null`. The fallback definition has none.
static func _first_change(definition: TweenDefinition) -> TweenChange:
	if definition == null or definition.steps.is_empty():
		return null
	var first: TweenStep = definition.steps[0]
	if first == null or first.changes.is_empty():
		return null
	return first.changes[0]


## Start check of the tween preset of `row`: logs an error and gives `null` when it has no first change.
static func _first_change_or_log(row: GameData.CutsceneStepRow) -> TweenChange:
	var change: TweenChange = _first_change(_preset(row.resource))
	if change == null:
		LogCore.log_error(_TAG, "cutscene %d step %d: tween preset %s did not load or has no first change" % [
				_cutscene_id, row.step, row.resource])
	return change


static func _new_command(command: GameData.CutsceneCommand) -> _COMMAND:
	_command_serial += 1
	var record: _COMMAND = _COMMAND.new()
	record.serial = _command_serial
	record.command = command
	return record


## Finalizes the in-progress command of the same command and target as a new one.
static func _finalize_same(command: GameData.CutsceneCommand, actor_id: int) -> void:
	for record: _COMMAND in _commands:
		if not record.done and record.command == command and (actor_id == 0 or record.actor_id == actor_id):
			_finalize(record)


static func _start_move(row: GameData.CutsceneStepRow) -> _COMMAND:
	var actor: Node = _actor_or_log(row.actor, row.step)
	if actor == null:
		return null
	var target: Node = _actor_or_log(row.target, row.step)
	if target == null:
		return null
	if (actor is Node3D) != (target is Node3D):
		LogCore.log_error(_TAG, "cutscene %d step %d: actor %s and target %s are not both 2D or both 3D" % [
				_cutscene_id, row.step, row.actor, row.target])
		return null
	if _first_change_or_log(row) == null:
		return null
	var definition: TweenDefinition = TweenDefinition.new()
	TweenCore.copy_definition(_preset(row.resource), definition)
	var position_change: TweenChange = null
	for step: TweenStep in definition.steps:
		if step == null:
			continue
		for change: TweenChange in step.changes:
			if change != null and change.property == TweenCore.TweenProperty.POSITION:
				position_change = change
	if position_change == null:
		LogCore.log_error(_TAG, "cutscene %d step %d: tween preset %s has no Position change" % [
				_cutscene_id, row.step, row.resource])
		return null
	_finalize_same(GameData.CutsceneCommand.MOVE, actor.get_instance_id())
	var local: Vector3 = _parent_position(actor, _world_position(target))
	position_change.target_value = Vector4(local.x, local.y, local.z, 0.0)
	var handle: int = TweenCore.play(definition, actor, _tween_options)
	if handle == 0:
		return null
	var record: _COMMAND = _new_command(GameData.CutsceneCommand.MOVE)
	record.actor_id = actor.get_instance_id()
	record.tween = handle
	_commands.append(record)
	return record


static func _start_animate(row: GameData.CutsceneStepRow) -> _COMMAND:
	var actor: Node = _actor_or_log(row.actor, row.step)
	if actor == null:
		return null
	var player: AnimationPlayer = _animation_player_of(actor)
	var animation: StringName = StringName(row.animation)
	if player == null or not player.has_animation(animation):
		LogCore.log_error(_TAG, "cutscene %d step %d: actor %s has no animation %s" % [
				_cutscene_id, row.step, row.actor, row.animation])
		return null
	_finalize_same(GameData.CutsceneCommand.ANIMATE, actor.get_instance_id())
	player.play(animation)
	if player.get_animation(animation).loop_mode != Animation.LOOP_NONE:
		return null
	var record: _COMMAND = _new_command(GameData.CutsceneCommand.ANIMATE)
	record.actor_id = actor.get_instance_id()
	record.player = player
	record.animation = animation
	_connect_finished(record)
	_commands.append(record)
	return record


static func _start_camera(row: GameData.CutsceneStepRow) -> _COMMAND:
	if not CameraCore.has_camera():
		LogCore.log_error(_TAG, "cutscene %d step %d: no camera is attached" % [_cutscene_id, row.step])
		return null
	var target: Node = _actor_or_log(row.target, row.step)
	if target == null:
		return null
	if CameraCore.is_3d_camera() != (target is Node3D):
		LogCore.log_error(_TAG, "cutscene %d step %d: the camera and target %s are not both 2D or both 3D" % [
				_cutscene_id, row.step, row.target])
		return null
	var change: TweenChange = _first_change_or_log(row)
	if change == null:
		return null
	if change.duration < 0 or change.duration > _max_duration_ms:
		LogCore.log_error(_TAG, "cutscene %d step %d: tween preset %s first change duration %d ms is out of range" % [
				_cutscene_id, row.step, row.resource, change.duration])
		return null
	_finalize_same(GameData.CutsceneCommand.CAMERA, 0)
	var record: _COMMAND = _new_command(GameData.CutsceneCommand.CAMERA)
	record.camera_position = _world_position(target)
	_commands.append(record)
	if _skipping:
		return record
	_camera_runner.call(_session, record, row.resource)
	return null if record.done else record


## Async. Moves the camera of `record` and ends `record` when the move ends.
static func _run_camera(session: RefCounted, record: _COMMAND, key: String) -> void:
	await CameraCore.move_by_preset(record.camera_position, key, _scope)
	if session == _session:
		record.done = true


static func _start_effect(row: GameData.CutsceneStepRow) -> _COMMAND:
	if _first_change_or_log(row) == null:
		return null
	_finalize_same(GameData.CutsceneCommand.SCREEN_EFFECT, 0)
	var handle: ScreenEffectHandle = ScreenEffectCore.play_preset(
			ScreenEffectCore.ScreenEffectChannel.CUTSCENE, _view_root, _preset(row.resource))
	var record: _COMMAND = _new_command(GameData.CutsceneCommand.SCREEN_EFFECT)
	record.effect = handle
	_commands.append(record)
	_effect_runner.call(_session, record)
	return null if record.done else record


## Async. Ends `record` when its screen effect ends.
static func _run_effect(session: RefCounted, record: _COMMAND) -> void:
	await ScreenEffectCore.wait_result(record.effect)
	if session == _session:
		record.done = true


static func _start_staging(row: GameData.CutsceneStepRow) -> _COMMAND:
	var parent: Node = _view.staging_parent
	if not row.actor.is_empty():
		parent = _actor_or_log(row.actor, row.step)
		if parent == null:
			return null
	var scene: PackedScene = _scenes[row.resource] if _scenes.has(row.resource) else null
	var instance: Node = scene.instantiate() if scene != null else null
	if instance == null:
		LogCore.log_error(_TAG, "cutscene %d step %d: staging %s made no instance" % [_cutscene_id, row.step, row.resource])
		return null
	parent.add_child(instance)
	var staging: CutsceneStaging = null
	for child: Node in instance.get_children():
		if child is CutsceneStaging:
			staging = child as CutsceneStaging
			break
	var player: AnimationPlayer = staging.animation_player if staging != null else null
	var animation: StringName = StringName(staging.animation) if staging != null else &""
	if not is_instance_valid(player) or not player.has_animation(animation) \
			or player.get_animation(animation).loop_mode != Animation.LOOP_NONE:
		if is_instance_valid(player) and player.has_animation(animation):
			player.play(animation)
		_staged.append(instance)
		return null
	var record: _COMMAND = _new_command(GameData.CutsceneCommand.STAGING)
	record.player = player
	record.animation = animation
	record.instance = instance
	record.instance_id = instance.get_instance_id()
	_connect_finished(record)
	_commands.append(record)
	player.play(animation)
	return record


static func _connect_finished(record: _COMMAND) -> void:
	record.finished = _node._on_animation_finished.bind(record.serial)
	if record.player.animation_finished.connect(record.finished) != OK:
		LogCore.log_error(_TAG, "could not connect animation_finished")
		record.finished = Callable()


static func _disconnect_finished(record: _COMMAND) -> void:
	if not record.finished.is_null() and is_instance_valid(record.player) \
			and record.player.animation_finished.is_connected(record.finished):
		record.player.animation_finished.disconnect(record.finished)
	record.finished = Callable()


## `animation_finished` of the player of the command `serial`.
static func _on_animation_finished(animation: StringName, serial: int) -> void:
	for record: _COMMAND in _commands:
		if record.serial != serial:
			continue
		if record.done or animation != record.animation:
			return
		_disconnect_finished(record)
		record.done = true
		if record.command == GameData.CutsceneCommand.STAGING:
			_destroy_instance(record)
		return


static func _destroy_instance(record: _COMMAND) -> void:
	if is_instance_id_valid(record.instance_id):
		record.instance.queue_free()
	record.instance = null
	record.instance_id = 0


## Puts an in-progress command in its end state and ends it.
static func _finalize(record: _COMMAND) -> void:
	if record.done:
		return
	record.done = true
	match record.command:
		GameData.CutsceneCommand.MOVE:
			TweenCore.skip_to_end(record.tween)
		GameData.CutsceneCommand.CAMERA:
			if CameraCore.has_camera():
				CameraCore.snap_to(record.camera_position)
		GameData.CutsceneCommand.SCREEN_EFFECT:
			ScreenEffectCore.skip_to_end(record.effect)
		GameData.CutsceneCommand.ANIMATE:
			_disconnect_finished(record)
			if is_instance_valid(record.player) and record.player.has_animation(record.animation):
				record.player.seek(record.player.get_animation(record.animation).length, true)
		GameData.CutsceneCommand.STAGING:
			_disconnect_finished(record)
			_destroy_instance(record)


## Stops an in-progress command without its end state.
static func _stop_command(record: _COMMAND) -> void:
	if record.done:
		return
	record.done = true
	match record.command:
		GameData.CutsceneCommand.MOVE:
			if TweenCore.is_initialized():
				TweenCore.stop(record.tween)
		GameData.CutsceneCommand.CAMERA:
			if CameraCore.is_initialized() and CameraCore.has_camera():
				CameraCore.stop_move()
		GameData.CutsceneCommand.ANIMATE:
			_disconnect_finished(record)
		GameData.CutsceneCommand.STAGING:
			_disconnect_finished(record)
			if is_instance_id_valid(record.instance_id):
				_staged.append(record.instance)
			record.instance = null
			record.instance_id = 0


static func _finalize_all() -> void:
	for record: _COMMAND in _commands:
		_finalize(record)


static func _drop_done_commands() -> void:
	var kept: Array[_COMMAND] = []
	for record: _COMMAND in _commands:
		if not record.done:
			kept.append(record)
	_commands = kept


static func _has_in_progress() -> bool:
	for record: _COMMAND in _commands:
		if not record.done:
			return true
	return false


## Frame code. Ends the commands whose tween ended or whose actor or instance was destroyed.
static func _update_commands() -> void:
	for record: _COMMAND in _commands:
		if record.done:
			continue
		if record.actor_id != 0 and not is_instance_id_valid(record.actor_id):
			_stop_command(record)
		elif record.command == GameData.CutsceneCommand.MOVE and not TweenCore.is_playing(record.tween):
			record.done = true
		elif record.command == GameData.CutsceneCommand.STAGING and not is_instance_id_valid(record.instance_id):
			_disconnect_finished(record)
			record.done = true


# --- Internal: Line ---


## The playback clock: real elapsed time without the cutscene pauses.
static func _clock() -> int:
	return TimeCore.get_real_time() - _paused_total_ms


static func _start_line(row: GameData.CutsceneStepRow) -> void:
	_hold = _HOLD_LINE
	_reset_line()
	var now: int = _clock()
	_line_start_ms = now
	_auto_from_ms = now
	_view.dialogue_box.visible = true
	var speaker: String = ""
	if row.speaker != 0 and GameData.CutsceneSpeakerTable.has_row(row.speaker):
		speaker = LocalizationCore.get_text(GameData.CutsceneSpeakerTable.get_row(row.speaker).name)
	_view.speaker_label.visible = not speaker.is_empty()
	_view.speaker_label.text = speaker
	if row.resource.is_empty():
		_view.portrait.visible = false
		_view.portrait.texture = null
	else:
		_view.portrait.visible = true
		_view.portrait.texture = _textures[row.resource] if _textures.has(row.resource) else null
	var label: RichTextLabel = _view.text_label
	var text: String = LocalizationCore.format(row.text, _args, label.get_theme_font_size(_FONT_SIZE))
	label.text = text
	_line_total = label.get_total_character_count()
	_line_visible = 0
	label.visible_characters = 0
	if _typing_interval_ms == 0 or _fast_forward_on:
		_show_full(now)
	if _fast_forward_on:
		_fast_forward_from_ms = now
	if not row.voice.is_empty() and not _fast_forward_on:
		_voice_handle = SoundCore.play(row.voice, SoundCore.SoundBus.VOICE, _scope)
	if _voice_handle == SoundCore.INVALID_HANDLE:
		_voice_end_ms = now
	_add_history(speaker, text, row.voice)


static func _show_full(now: int) -> void:
	_full_at_ms = now
	_line_visible = _line_total
	_view.text_label.visible_characters = -1


static func _add_history(speaker: String, text: String, voice: String) -> void:
	var entry: _ENTRY = _ENTRY.new()
	entry.speaker = speaker
	entry.text = text
	entry.voice = voice
	_history.append(entry)
	while _history.size() > _history_max:
		_history.remove_at(0)


## Frame code. Typing, voice end, auto advance and fast forward of the running `Line`.
static func _line_frame() -> void:
	var now: int = _clock()
	if _full_at_ms < 0:
		@warning_ignore("integer_division")
		var shown: int = (now - _line_start_ms) / _typing_interval_ms
		if shown >= _line_total:
			_show_full(now)
		elif shown != _line_visible:
			_line_visible = shown
			_view.text_label.visible_characters = shown
	if _voice_end_ms < 0 and not SoundCore.is_playing(_voice_handle):
		_voice_end_ms = now
	if _history_open:
		return
	if _fast_forward_on:
		if now - _fast_forward_from_ms >= _fast_forward_delay_ms:
			_end_line()
	elif _auto_on and _full_at_ms >= 0 and _voice_end_ms >= 0:
		var from: int = maxi(maxi(_full_at_ms, _voice_end_ms), _auto_from_ms)
		if now - from >= _auto_delay_ms:
			_end_line()


## Frame code. Ends the running `Line` and runs the next steps.
static func _end_line() -> void:
	_stop_line()
	_hold = _HOLD_NONE
	_request_run()


static func _stop_line() -> void:
	if _voice_handle != SoundCore.INVALID_HANDLE:
		SoundCore.stop(_voice_handle)
	_reset_line()


# --- Internal: Wait ---


## Ends the running `Wait` when the in-progress commands ended and `duration` of game time passed since.
static func _check_wait() -> void:
	if not _wait_counting:
		if _has_in_progress():
			return
		_wait_counting = true
		_wait_start_ms = TimeCore.get_game_time()
	if TimeCore.get_game_time() - _wait_start_ms >= _wait_ms:
		_wait_counting = false
		_hold = _HOLD_NONE


# --- Internal: Choice ---


static func _start_choice(row: GameData.CutsceneStepRow) -> void:
	_hold = _HOLD_CHOICE
	_choice_step = row.step
	var rows: Array[GameData.CutsceneChoiceRow] = []
	for choice: GameData.CutsceneChoiceRow in GameData.CutsceneChoiceTable.get_rows(_cutscene_id):
		if choice.step == row.step:
			rows.append(choice)
	rows.sort_custom(CutsceneCore._is_choice_before)
	_choice_rows = []
	_choice_locked = []
	for choice: GameData.CutsceneChoiceRow in rows:
		var locked: bool = false
		if choice.requirement != 0:
			var result: RequirementResult = RequirementCore.evaluate(choice.requirement)
			locked = result == null or not result.passed
		if locked and choice.hide_locked:
			continue
		_choice_rows.append(choice)
		_choice_locked.append(locked)
	if _choice_rows.size() > _choice_buttons.size():
		LogCore.log_error(_TAG, "cutscene %d step %d: %d choices to show and %d choice buttons" % [
				_cutscene_id, row.step, _choice_rows.size(), _choice_buttons.size()])
	for index: int in _choice_buttons.size():
		var button: Button = _choice_buttons[index]
		if index < _choice_rows.size():
			button.text = LocalizationCore.format(_choice_rows[index].text, _args, 0)
			button.disabled = _choice_locked[index]
			button.visible = true
		else:
			button.visible = false
			button.disabled = false


static func _pick_choice(index: int) -> void:
	if _hold != _HOLD_CHOICE or _paused or _history_open:
		return
	if index >= _choice_rows.size() or index >= _choice_buttons.size() or _choice_locked[index]:
		return
	var row: GameData.CutsceneChoiceRow = _choice_rows[index]
	var record: CutsceneChoiceRecord = CutsceneChoiceRecord.new()
	record.step = _choice_step
	record.choice = row.choice
	_picked.append(record)
	for button: Button in _choice_buttons:
		button.visible = false
		button.disabled = false
	_choice_rows = []
	_choice_locked = []
	_hold = _HOLD_NONE
	_go_to(row.next_step)
	_run()


# --- Internal: input ---


## Frame code of the core node.
static func _on_frame() -> void:
	if not _is_initialized or not _playing or _view == null:
		return
	if _paused:
		return
	var frame: int = Engine.get_process_frames()
	if InputCore.is_just_pressed(_ADVANCE) and not _other_button_focused():
		_advance_input(frame)
	if _playing and _skippable and InputCore.is_just_pressed(_SKIP):
		_skip_input(frame)
	if not _playing or _paused:
		return
	_update_commands()
	match _hold:
		_HOLD_LINE:
			_line_frame()
		_HOLD_WAIT:
			_check_wait()
			if _hold == _HOLD_NONE:
				_request_run()
		_HOLD_COMMAND:
			if _hold_command == null or _hold_command.done:
				_hold_command = null
				_hold = _HOLD_NONE
				_request_run()
		_HOLD_END:
			if not _has_in_progress():
				_hold = _HOLD_NONE
				_request_run()


## Frame code. One advance input of `frame`. A second one in the same frame is the same input.
static func _advance_input(frame: int) -> void:
	if frame == _last_advance_frame or _paused or _history_open or _hold != _HOLD_LINE:
		return
	_last_advance_frame = frame
	if _full_at_ms < 0:
		_show_full(_clock())
	else:
		_end_line()


## Whether a view button other than the advance button has the UICore focus. A `cutscene_advance` press is then not
## an advance input: its accept input is that button's click.
static func _other_button_focused() -> bool:
	if not _view_root.is_inside_tree():
		return false
	var owner: Control = _view_root.get_viewport().gui_get_focus_owner()
	return owner != null and owner != _view.advance_button and _view_root.is_ancestor_of(owner)


## Frame code. One skip input of `frame`. A second one in the same frame is the same input.
static func _skip_input(frame: int) -> void:
	if frame == _last_skip_frame or not _can_skip():
		return
	_last_skip_frame = frame
	_request_skip()


static func _can_skip() -> bool:
	return _skippable and not _paused and not _history_open and _hold != _HOLD_CHOICE


## Frame code. Does the skip in a deferred call.
static func _request_skip() -> void:
	_skip_deferred.call_deferred(_session, _play_serial)


static func _on_skip_deferred(session: RefCounted, serial: int) -> void:
	if session == _session and serial == _play_serial and _playing and _can_skip():
		_skip()


## The skip. Before playback 4 attaches the view, 5 runs the steps with skip application from the first step.
static func _skip() -> void:
	_finalize_all()
	if _hold == _HOLD_LINE:
		_stop_line()
	_hold = _HOLD_NONE
	_hold_command = null
	_wait_counting = false
	if _view != null:
		_view.dialogue_box.visible = false
	_skipping = true
	_run()


## Input of the core node, before the GUI stage. Frame code.
static func _on_input(event: InputEvent) -> void:
	if not _playing:
		return
	_input_event = event
	_input_event_frame = Engine.get_process_frames()
	# The direction of the pressed axis event that presses a button by an exact `ui_accept` match, as `BaseButton`
	# checks it, for the click of its release.
	var motion: InputEventJoypadMotion = event as InputEventJoypadMotion
	if motion != null and motion.is_pressed() and motion.is_action(&"ui_accept", true):
		_axis_press_positive[Vector2i(motion.device, motion.axis)] = motion.axis_value > 0.0


static func _on_advance_click(serial: int) -> void:
	if serial == _play_serial and _playing and not _advance_click_is_press():
		_advance_input(Engine.get_process_frames())


## Whether an advance button click is the same input as a `cutscene_advance` press: `InputCore` has `cutscene_advance`
## pressed at the click, or the click is the accept click of a key or gamepad button in the `cutscene_advance` binding,
## whose press `InputCore` gives as the advance input. `InputCore` may have that release already, and gives the press
## to a later frame than the click when both came in one input batch, so the click is decided by its device input,
## not by the pressed state. A pointer click is not in the binding.
static func _advance_click_is_press() -> bool:
	var event: InputEvent = _input_event if _input_event_frame == Engine.get_process_frames() else null
	_input_event = null
	if InputCore.is_pressed(_ADVANCE):
		return true
	return event != null and _is_advance_binding(event)


## Whether the key, gamepad button or gamepad axis direction of `event` is in the `InputCore` binding of
## `cutscene_advance`. The direction of a not-pressed axis event, which clicks a button on release, is the direction of
## the last pressed event of that axis that matched `ui_accept` exactly, the press that pressed the button: a release
## to 0.0 or to a small value of the other sign releases it. Without one, it is the sign of the value, 0.0 positive.
static func _is_advance_binding(event: InputEvent) -> bool:
	var input_name: String = ""
	var pad: bool = false
	if event is InputEventKey:
		var key: InputEventKey = event as InputEventKey
		input_name = OS.get_keycode_string(key.keycode if key.keycode != KEY_NONE else key.physical_keycode)
	elif event is InputEventJoypadButton:
		var index: int = (event as InputEventJoypadButton).button_index
		if index < 0 or index >= _PAD_BUTTON_NAMES.size():
			return false
		input_name = _PAD_BUTTON_NAMES[index]
		pad = true
	elif event is InputEventJoypadMotion:
		var motion: InputEventJoypadMotion = event as InputEventJoypadMotion
		if motion.axis < 0 or motion.axis >= _PAD_AXIS_NAMES.size():
			return false
		var positive: bool = motion.axis_value >= 0.0
		if not motion.is_pressed():
			positive = _axis_press_positive.get(Vector2i(motion.device, motion.axis), positive)
		input_name = _PAD_AXIS_NAMES[motion.axis] + ("+" if positive else "-")
		pad = true
	if input_name.is_empty():
		return false
	# A binding has at most the larger of the setting limit and the default binding from the input map.
	var limit: String = _MAX_PAD_BUTTONS_KEY if pad else _MAX_KEYS_KEY
	var buffer: PackedStringArray = PackedStringArray()
	buffer.resize(maxi(CoreSettings.get_int(limit), 0) + InputMap.action_get_events(_ADVANCE).size())
	var count: int = InputCore.get_pad_buttons(_ADVANCE, buffer) if pad else InputCore.get_keys(_ADVANCE, buffer)
	for i: int in count:
		if buffer[i] == input_name:
			return true
	return false


static func _on_skip_click(serial: int) -> void:
	if serial == _play_serial and _playing:
		_skip_input(Engine.get_process_frames())


static func _on_choice_click(serial: int, index: int) -> void:
	if serial == _play_serial and _playing:
		_choice_deferred.call_deferred(_session, serial, index)


static func _on_choice_deferred(session: RefCounted, serial: int, index: int) -> void:
	if session == _session and serial == _play_serial and _playing:
		_pick_choice(index)


static func _on_auto_click(serial: int) -> void:
	if serial != _play_serial or not _playing:
		return
	_auto_on = not _auto_on
	_view.auto_advance_button.set_pressed_no_signal(_auto_on)
	if _auto_on:
		_auto_from_ms = _clock()


static func _on_fast_forward_click(serial: int) -> void:
	if serial != _play_serial or not _playing:
		return
	_fast_forward_on = not _fast_forward_on
	_view.fast_forward_button.set_pressed_no_signal(_fast_forward_on)
	if _fast_forward_on and _hold == _HOLD_LINE:
		var now: int = _clock()
		if _full_at_ms < 0:
			_show_full(now)
		_fast_forward_from_ms = now


# --- Internal: back input and cutscene pause ---


## The back override: closes the line history window, or starts a cutscene pause. Frame code.
static func _on_back() -> void:
	if not _playing:
		return
	if _history_open:
		_close_history()
	elif not _paused:
		_start_pause()


## Frame code. Starts the cutscene pause and opens the pause popup in a deferred call.
static func _start_pause() -> void:
	_paused = true
	_pause_started_ms = TimeCore.get_real_time()
	if not TimeCore.is_paused():
		TimeCore.set_paused(true)
		_paused_time = true
	_pause_serial += 1
	_popup_runner.call_deferred(_session, _play_serial, _pause_serial)


## Async. Opens the pause popup; a popup that does not open ends the cutscene pause.
static func _run_pause_popup(session: RefCounted, serial: int, pause_serial: int) -> void:
	if session != _session or serial != _play_serial or pause_serial != _pause_serial or not _paused:
		return
	var param: SystemPopupParam = SystemPopupParam.new()
	param.body = ReservedString.cutscene_pause_body()
	var resume: SystemPopupButton = SystemPopupButton.new()
	resume.label = ReservedString.cutscene_pause_resume()
	resume.callback = CutsceneCore._on_pause_resume.bind(_pause_serial)
	param.buttons.append(resume)
	if _skippable and _hold != _HOLD_CHOICE:
		var skip: SystemPopupButton = SystemPopupButton.new()
		skip.label = ReservedString.cutscene_pause_skip()
		skip.callback = CutsceneCore._on_pause_skip.bind(_pause_serial)
		param.buttons.append(skip)
	param.back_button = 0
	var opened: bool = await UICore.open_system_popup(param, Callable())
	if session != _session or pause_serial != _pause_serial or not _paused:
		return
	if not opened:
		LogCore.log_error(_TAG, "the pause popup did not open; the cutscene pause ends")
		_end_pause()


static func _end_pause() -> void:
	if not _paused:
		return
	_paused = false
	_paused_total_ms += TimeCore.get_real_time() - _pause_started_ms
	if _paused_time:
		_paused_time = false
		TimeCore.set_paused(false)
	_request_run()


static func _on_pause_resume(pause_serial: int) -> void:
	if pause_serial == _pause_serial and _playing and _paused:
		_end_pause()


static func _on_pause_skip(pause_serial: int) -> void:
	if pause_serial != _pause_serial or not _playing or not _paused:
		return
	_end_pause()
	_request_skip()


# --- Internal: line history ---


static func _on_history_click(serial: int) -> void:
	if serial != _play_serial or not _playing or _paused:
		return
	if _history_open:
		_close_history()
	else:
		_open_history()


static func _on_history_close_click(serial: int) -> void:
	if serial == _play_serial and _playing and _history_open:
		_close_history()


## Frame code. Opens the line history window and fills its list in a deferred call.
static func _open_history() -> void:
	_history_open = true
	_view.line_history_window.visible = true
	_history_runner.call_deferred(_session, _play_serial)


## Async. Fills the line history list and puts the view focus on it.
static func _run_history_fill(session: RefCounted, serial: int) -> void:
	if session != _session or serial != _play_serial or not _history_open:
		return
	_update_focus()
	await _view.line_history_list.set_items(_history.size(), _history_bind, _scope)
	if session == _session and serial == _play_serial and _history_open:
		_update_focus()


## Bind callback of the line history list. Frame code when the list binds an item as it scrolls.
static func _bind_history_item(item: Control, index: int) -> void:
	if index < 0 or index >= _history.size():
		return
	var node: Node = item
	var history_item: CutsceneLineHistoryItem = node as CutsceneLineHistoryItem
	if history_item == null:
		return
	var entry: _ENTRY = _history[index]
	if history_item.speaker_label != null:
		history_item.speaker_label.visible = not entry.speaker.is_empty()
		history_item.speaker_label.text = entry.speaker
	if history_item.text_label != null:
		history_item.text_label.bbcode_enabled = true
		history_item.text_label.text = entry.text
	if history_item.voice_button != null:
		history_item.voice_button.visible = not entry.voice.is_empty()
		history_item._history_serial = _play_serial
		history_item._history_voice = entry.voice
		var ui_button: UIButton = _ui_button_of(history_item.voice_button)
		if ui_button != null:
			ui_button.set_on_click(history_item._voice_click)


static func _on_history_voice_click(serial: int, voice: String) -> void:
	if serial != _play_serial or not _playing or not _history_open or voice.is_empty():
		return
	_stop_voices()
	_replay_handle = SoundCore.play(voice, SoundCore.SoundBus.VOICE, _scope)


static func _stop_voices() -> void:
	if _voice_handle != SoundCore.INVALID_HANDLE:
		SoundCore.stop(_voice_handle)
	if _replay_handle != SoundCore.INVALID_HANDLE:
		SoundCore.stop(_replay_handle)
		_replay_handle = SoundCore.INVALID_HANDLE


## Frame code.
static func _close_history() -> void:
	_history_open = false
	_view.line_history_window.visible = false
	if _replay_handle != SoundCore.INVALID_HANDLE:
		SoundCore.stop(_replay_handle)
		_replay_handle = SoundCore.INVALID_HANDLE
	var now: int = _clock()
	_auto_from_ms = now
	_fast_forward_from_ms = now
	_request_focus()


# --- Internal: view focus ---


## Frame code. Updates the view focus in a deferred call.
static func _request_focus() -> void:
	if _focus_pending:
		return
	_focus_pending = true
	_focus_deferred.call_deferred(_session, _play_serial)


static func _on_focus_deferred(session: RefCounted, serial: int) -> void:
	if session != _session or serial != _play_serial:
		return
	_focus_pending = false
	if _playing:
		_update_focus()


static func _update_focus() -> void:
	if _view == null:
		return
	var elements: Array[Control] = []
	var initial: Control = null
	if _history_open:
		for child: Node in _view.line_history_list.get_children():
			var item: CutsceneLineHistoryItem = child as CutsceneLineHistoryItem
			if item != null and item.voice_button != null and item.voice_button.is_visible_in_tree():
				elements.append(item.voice_button)
		initial = _view.line_history_close_button
		elements.append(initial)
	elif _hold == _HOLD_CHOICE:
		for index: int in mini(_choice_rows.size(), _choice_buttons.size()):
			if not _choice_locked[index] and _choice_buttons[index].is_visible_in_tree():
				elements.append(_choice_buttons[index])
				if initial == null:
					initial = _choice_buttons[index]
		if _has_history() and _view.line_history_button.is_visible_in_tree():
			elements.append(_view.line_history_button)
	else:
		for button: Button in [
			_view.advance_button, _view.skip_button, _view.auto_advance_button, _view.fast_forward_button,
			_view.line_history_button,
		]:
			if _has_ui_button(button) and button.is_visible_in_tree():
				elements.append(button)
		initial = _view.advance_button
	UICore.set_view_focus(UICore.FocusView.CUTSCENE, elements, initial, Callable())


# --- Internal: stop and playback end ---


static func _on_scope_released(scope: Scope) -> void:
	if _playing and scope == _scope:
		_stop()


## Stop: stops the tweens and the camera move without the end state, then playback end handling with `Stopped`.
static func _stop() -> void:
	for record: _COMMAND in _commands:
		_stop_command(record)
	_finish_playback(CutsceneStatus.STOPPED)


## Playback end handling.
static func _finish_playback(status: CutsceneStatus) -> void:
	if not _playing:
		return
	var wait: _WAIT = _wait
	var picked: Array[CutsceneChoiceRecord] = _picked
	var ui: bool = UICore.is_initialized()
	if _paused:
		_paused = false
		if _paused_time and TimeCore.is_initialized():
			TimeCore.set_paused(false)
		_paused_time = false
	if ui:
		UICore.set_back_override(Callable())
	for record: _COMMAND in _commands:
		_stop_command(record)
	for instance: Node in _staged:
		if is_instance_valid(instance):
			instance.queue_free()
	if SoundCore.is_initialized():
		for handle: int in _loop_sounds:
			SoundCore.stop(handle)
		_stop_voices()
	if _view_root != null and is_instance_valid(_view_root):
		if ui:
			var none: Array[Control] = []
			UICore.set_view_focus(UICore.FocusView.CUTSCENE, none, null, Callable())
		if ScreenEffectCore.is_initialized():
			ScreenEffectCore.clear_owner(_view_root)
		if is_instance_valid(_root) and _view_root.get_parent() == _root:
			_root.remove_child(_view_root)
		_view_root.queue_free()
	_history = []
	if is_instance_valid(_root):
		_root.visible = false
	_unblock()
	_reset_playback()
	var result: CutsceneResult = CutsceneResult.new()
	result.status = status
	result.choices = picked
	if wait != null:
		wait.finish(result)
