class_name TutorialCore
extends RefCounted
## Runs the tutorial steps of the `tutorial` and `tutorial_step` tables in order with the speech bubble, the highlight,
## the hand pointer and the input restriction. Saves the progress to the server `tutorial` module so the next run goes
## on from it, and judges the start conditions with `RequirementCore`.

const _TAG: String = "TutorialCore"
const _VIEW_KEY: String = "tutorialView"
const _ANCHOR_WAIT_WARN_KEY: String = "TutorialCore.anchorWaitWarnMs"
const _GAMEPAD_KEY: String = "gamepadSupported"
const _TIME_RECHECK_KEY: String = "RequirementCore.timeRecheckMs"
const _REASON: String = "tutorial"
const _HOLE_PARAM: StringName = &"hole"
const _SIZE_PARAM: StringName = &"size"
## Highlight shader of the dim: the anchor rectangle `hole` (dim local position and size) is transparent.
const _HIGHLIGHT_SHADER: String = """shader_type canvas_item;

uniform vec2 size = vec2(0.0);
uniform vec4 hole = vec4(0.0);

void fragment() {
	vec2 p = UV * size;
	if (p.x >= hole.x && p.y >= hole.y && p.x < hole.x + hole.z && p.y < hole.y + hole.w) {
		COLOR.a = 0.0;
	}
}
"""
const _CORE_NODE := preload("res://core/tutorial_core/tutorial_core_node.gd")
const _DEF := preload("res://core/tutorial_core/tutorial_def.gd")
const _STEP := preload("res://core/tutorial_core/tutorial_step_def.gd")
const _RUN := preload("res://core/tutorial_core/tutorial_run.gd")
const _WAIT := preload("res://core/tutorial_core/tutorial_block_wait.gd")

# States of the tutorial view.
const _VIEW_NONE: int = 0
const _VIEW_LOADING: int = 1
const _VIEW_READY: int = 2
const _VIEW_FAILED: int = 3

static var _is_initialized: bool = false
## Replaced by every `init`; an async step that sees another session does nothing.
static var _session: RefCounted = null
static var _node: _CORE_NODE = null
static var _view_key: String = ""
static var _anchor_wait_warn_ms: int = 0
static var _gamepad_supported: bool = false
static var _can_start_hook: Callable = Callable()

# Tutorial definitions, made from the data at the first use after the data is loaded.
static var _defs_made: bool = false
## In `order` order.
static var _defs: Array[_DEF] = []
static var _defs_by_id: Dictionary[int, _DEF] = {}

## Largest `step` finished in this run, for each tutorial ID value.
static var _done_steps: Dictionary[int, int] = {}
## Largest `step` a save of this run was for, for each tutorial ID value. The resend sends it again.
static var _save_steps: Dictionary[int, int] = {}
## Tutorial ID values that failed the step check in this run.
static var _check_failed: Dictionary[int, bool] = {}
## Number of `SaveTutorialProgress` requests waiting for a response, for each tutorial ID value.
static var _pending_saves: Dictionary[int, int] = {}

## Active tutorials in `order` order.
static var _runs: Array[_RUN] = []
## The `Shown` tutorial, or `null`.
static var _shown: _RUN = null
## Tutorial ID value of the tutorial that was `Shown` last. 0: none.
static var _last_shown_id: int = 0
## Between `SceneEndedEvent` and `SceneStartedEvent`: the step progress of every active tutorial is stopped.
static var _scene_stopped: bool = false

# Start check.
static var _start_watched: bool = false
## Requirement ID values with a start watch.
static var _start_watches: Dictionary[int, bool] = {}
static var _checking: bool = false
static var _check_again: bool = false
static var _start_check_deferred: bool = false
## Requirement ID values with a `complete_requirement` watch, and the number of active tutorials that use it.
static var _step_watches: Dictionary[int, int] = {}

# `AnchorTap` step end deferred until the GUI handled the release.
static var _tap_run: _RUN = null
static var _tap_serial: int = 0

# Tutorial view.
static var _view_state: int = _VIEW_NONE
static var _layer: CanvasLayer = null
static var _safe_root: SafeAreaRoot = null
static var _view_root: Control = null
static var _view: TutorialView = null
static var _material: ShaderMaterial = null
## Position of the speech bubble in the tutorial view resource, for the steps without `anchor`.
static var _bubble_home: Vector2 = Vector2.ZERO


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init: already initialized")
		return false
	if not CoreSettings.has_string(_VIEW_KEY):
		LogCore.log_error(_TAG, "init: game settings item tutorialView is missing or not a string")
		return false
	if not CoreSettings.has_int(_ANCHOR_WAIT_WARN_KEY):
		LogCore.log_error(_TAG, "init: core settings key TutorialCore.anchorWaitWarnMs is missing or not an integer")
		return false
	if not CoreSettings.has_bool(_GAMEPAD_KEY):
		LogCore.log_error(_TAG, "init: game settings item gamepadSupported is missing or not a boolean")
		return false
	if not CoreSettings.has_int(_TIME_RECHECK_KEY):
		LogCore.log_error(_TAG, "init: core settings key RequirementCore.timeRecheckMs is missing or not an integer")
		return false
	var node: _CORE_NODE = _CORE_NODE.new()
	node.name = _TAG
	node.process_mode = Node.PROCESS_MODE_ALWAYS
	var subscribed: bool = (
		EventCore.subscribe(SceneStartedEvent, node._on_scene_started)
		and EventCore.subscribe(SceneEndedEvent, node._on_scene_ended)
		and EventCore.subscribe(UserStateChangedEvent, node._on_user_state_changed)
	)
	if not subscribed:
		LogCore.log_error(_TAG, "init: could not subscribe to the scene and UserState events")
		EventCore.unsubscribe_all(node)
		node.free()
		return false
	_view_key = CoreSettings.get_string(_VIEW_KEY)
	_anchor_wait_warn_ms = CoreSettings.get_int(_ANCHOR_WAIT_WARN_KEY)
	_gamepad_supported = CoreSettings.get_bool(_GAMEPAD_KEY)
	_session = RefCounted.new()
	_node = node
	_is_initialized = true
	(Engine.get_main_loop() as SceneTree).root.add_child(node)
	InputCore.set_ui_pointer_observer(node.pointer_call)
	return true


static func release() -> void:
	if not _is_initialized:
		return
	var node: _CORE_NODE = _node
	_end_state(node)
	if is_instance_valid(node):
		var parent: Node = node.get_parent()
		if parent != null:
			parent.remove_child(node)
		node.queue_free()


static func is_initialized() -> bool:
	return _is_initialized


## Runs the start check. True when it started one tutorial or more.
static func check_start() -> bool:
	if not _check("check_start"):
		return false
	return _start_check()


## Ends the current step of every active tutorial at step progress 2 to 5 whose step is a `Cue` step of `cue`. True
## when it ended one or more.
static func notify_cue(cue: GameData.TutorialCue) -> bool:
	if not _check("notify_cue"):
		return false
	if not GameData.TutorialCue.values().has(cue):
		LogCore.log_error(_TAG, "notify_cue: %d is not a TutorialCue" % cue)
		return false
	if cue == GameData.TutorialCue.NONE:
		return false
	var ended: bool = false
	for run: _RUN in _runs.duplicate():
		if not _runs.has(run) or run.stage == _RUN.Stage.STOPPED:
			continue
		var step: _STEP = run.current()
		if step.complete == GameData.TutorialComplete.CUE and step.cue == cue:
			_end_step(run)
			ended = true
	return ended


## Skips the `Shown` tutorial when it is skippable. True when it skipped.
static func skip() -> bool:
	if not _check("skip"):
		return false
	return _skip()


static func is_running() -> bool:
	if not _check("is_running"):
		return false
	return not _runs.is_empty()


## The current tutorial and its step: the `Shown` tutorial, or else the `Paused` tutorial with the smallest `order`.
static func current() -> CurrentResult:
	var result: CurrentResult = CurrentResult.new()
	if not _check("current"):
		return result
	var run: _RUN = _shown
	if run == null and not _runs.is_empty():
		run = _runs[0]
	if run != null:
		result.tutorial_id = run.def.id
		result.step = run.current().step
	return result


static func is_completed(tutorial_id: int) -> bool:
	if not _check("is_completed"):
		return false
	_make_defs()
	if not _defs_by_id.has(tutorial_id):
		LogCore.log_error(_TAG, "is_completed: tutorial %d is not in the tutorial table" % tutorial_id)
		return false
	return _is_complete(_defs_by_id[tutorial_id])


## Registers the `can_start_tutorial` owner hook: a static func, or a method of the `Node` that owns it.
static func register_can_start_tutorial(hook: Callable) -> bool:
	if not _check("register_can_start_tutorial"):
		return false
	var target: Object = hook.get_object() if hook.is_valid() else null
	if not hook.is_standard() or hook.get_bound_arguments_count() != 0 or not (target is Script or target is Node):
		LogCore.log_error(_TAG, "register_can_start_tutorial: the hook is not a static func or a Node method")
		return false
	if _has_hook():
		LogCore.log_error(_TAG, "register_can_start_tutorial: a hook is already registered")
		return false
	_can_start_hook = hook
	return true


# --- Internal: lifecycle ---


static func _check(operation: String) -> bool:
	if _is_initialized:
		return true
	LogCore.log_error(_TAG, "%s: not initialized" % operation)
	return false


static func _on_node_exit(node: _CORE_NODE) -> void:
	if node != _node or not _is_initialized:
		return
	_end_state(node)


## Stops every active tutorial without saving and puts the module back to the state before `init`.
static func _end_state(node: _CORE_NODE) -> void:
	for run: _RUN in _runs:
		_lift_block(run)
		if run.has_focus and UICore.is_initialized():
			_clear_focus()
		run.has_focus = false
	if RequirementCore.is_initialized() and is_instance_valid(node):
		for requirement_id: int in _step_watches:
			RequirementCore.unwatch(requirement_id, node.step_requirement_call)
		for requirement_id: int in _start_watches:
			RequirementCore.unwatch(requirement_id, node.start_requirement_call)
	if _view_state == _VIEW_READY and LocalizationCore.is_initialized() and is_instance_valid(_view):
		if is_instance_valid(_view.text_label):
			LocalizationCore.unbind_text(_view.text_label)
		if is_instance_valid(_view.skip_button):
			LocalizationCore.unbind_text(_view.skip_button)
	if is_instance_valid(_safe_root):
		_safe_root.queue_free()
	if InputCore.is_initialized():
		InputCore.set_ui_pointer_observer(Callable())
	if is_instance_valid(node) and EventCore.is_initialized():
		EventCore.unsubscribe_all(node)
	_is_initialized = false
	_session = null
	_node = null
	_view_key = ""
	_anchor_wait_warn_ms = 0
	_gamepad_supported = false
	_can_start_hook = Callable()
	_defs_made = false
	_defs = []
	_defs_by_id = {}
	_done_steps = {}
	_save_steps = {}
	_check_failed = {}
	_pending_saves = {}
	_runs = []
	_shown = null
	_last_shown_id = 0
	_scene_stopped = false
	_start_watched = false
	_start_watches = {}
	_checking = false
	_check_again = false
	_start_check_deferred = false
	_step_watches = {}
	_tap_run = null
	_tap_serial = 0
	_view_state = _VIEW_NONE
	_layer = null
	_safe_root = null
	_view_root = null
	_view = null
	_material = null
	_bubble_home = Vector2.ZERO


# --- Internal: definitions and progress ---


## Makes the tutorial definitions from the data once it is loaded. False while it is not loaded.
static func _make_defs() -> bool:
	if _defs_made:
		return true
	if not DataCore.is_loaded():
		return false
	for row: GameData.TutorialRow in GameData.TutorialTable.all_rows():
		var def: _DEF = _DEF.new()
		def.id = row.id
		def.order = row.order
		def.start_requirement = row.start_requirement
		def.skippable = row.skippable
		for step_row: GameData.TutorialStepRow in GameData.TutorialStepTable.get_rows(row.id):
			var step: _STEP = _STEP.new()
			step.step = step_row.step
			step.text = step_row.text
			step.anchor = step_row.anchor
			step.anchor_key = step_row.anchor_key
			step.panel = step_row.panel
			step.popup = step_row.popup
			step.pointer = step_row.pointer
			step.restrict_input = step_row.restrict_input
			step.complete = step_row.complete
			step.complete_requirement = step_row.complete_requirement
			step.cue = step_row.cue
			step.save = step_row.save
			def.steps.append(step)
		def.steps.sort_custom(_step_before)
		_defs.append(def)
		_defs_by_id[def.id] = def
	_defs.sort_custom(_order_before)
	_defs_made = true
	return true


static func _step_before(a: _STEP, b: _STEP) -> bool:
	return a.step < b.step


static func _order_before(a: _DEF, b: _DEF) -> bool:
	return a.order < b.order


## The progress step stored on the server: `TutorialProgressUserState`, or 0 without a row.
static func _server_step(tutorial_id: int) -> int:
	var state: CoreContract.TutorialProgressUserState = (
		UserStateCore.get_by_id(CoreContract.TutorialProgressUserState, tutorial_id) as CoreContract.TutorialProgressUserState
	)
	return state.step if state != null else 0


static func _done_step(tutorial_id: int) -> int:
	return _done_steps[tutorial_id] if _done_steps.has(tutorial_id) else 0


## The larger of the stored progress step and the step finished in this run.
static func _progress(tutorial_id: int) -> int:
	return maxi(_server_step(tutorial_id), _done_step(tutorial_id))


static func _is_complete(def: _DEF) -> bool:
	return _progress(def.id) >= def.last_step()


static func _is_active(tutorial_id: int) -> bool:
	for run: _RUN in _runs:
		if run.def.id == tutorial_id:
			return true
	return false


## The `tutorial_step` data check rules on the steps of `def`. Logs the first step that breaks one.
static func _step_check(def: _DEF) -> bool:
	var resume_start: bool = true
	for step: _STEP in def.steps:
		var reason: String = _step_fault(step, resume_start)
		if not reason.is_empty():
			LogCore.log_error(_TAG, "tutorial %d step %d: %s" % [def.id, step.step, reason])
			return false
		resume_start = step.save
	return true


## Why `step` breaks a `tutorial_step` data check rule, or an empty string.
static func _step_fault(step: _STEP, resume_start: bool) -> String:
	var no_anchor: bool = step.anchor.is_empty()
	if no_anchor and (step.pointer or step.restrict_input or step.complete == GameData.TutorialComplete.ANCHOR_TAP):
		return "pointer, restrict_input or AnchorTap without anchor"
	if step.complete == GameData.TutorialComplete.REQUIREMENT and step.complete_requirement == 0:
		return "Requirement without complete_requirement"
	if step.anchor_key < 0:
		return "anchor_key below 1"
	if step.anchor_key != 0 and no_anchor:
		return "anchor_key without anchor"
	if step.complete == GameData.TutorialComplete.CUE and step.cue == GameData.TutorialCue.NONE:
		return "Cue without cue"
	if not step.panel.is_empty() and not step.popup.is_empty():
		return "both panel and popup"
	if not step.popup.is_empty() and not step.restrict_input:
		return "popup without restrict_input"
	if resume_start and not step.popup.is_empty():
		return "popup on a resume start step"
	return ""


# --- Internal: start check ---


static func _start_check() -> bool:
	if _checking:
		_check_again = true
		return false
	_checking = true
	var started: bool = false
	var session: RefCounted = _session
	while true:
		_check_again = false
		if _start_check_once():
			started = true
		if not _check_again or session != _session:
			break
	if session == _session:
		_checking = false
	return started


static func _start_check_once() -> bool:
	if not AuthCore.is_logged_in() or _shown != null or SceneCore.is_transitioning():
		return false
	if not _make_defs():
		return false
	var session: RefCounted = _session
	_resend()
	if not _start_watched:
		_start_watched = true
		_watch_starts()
	var candidates: Array[_DEF] = []
	for def: _DEF in _defs:
		if _check_failed.has(def.id) or _is_active(def.id) or _is_complete(def):
			continue
		if def.start_requirement != 0 and not RequirementCore.evaluate(def.start_requirement).passed:
			continue
		if not _can_start(def.id) or session != _session:
			continue
		candidates.append(def)
	var started: bool = false
	for def: _DEF in candidates:
		if session != _session or _shown != null:
			break
		if _is_active(def.id) or _is_complete(def):
			continue
		if not _step_check(def):
			_check_failed[def.id] = true
			continue
		var run: _RUN = _start_tutorial(def)
		if run == null:
			continue
		started = true
		if _runs.has(run) and run.stage == _RUN.Stage.WAITING and _show_condition(run.current()):
			break
	return started


## Runs a start check after the current call: for the starts that come from frame code.
static func _request_start_check() -> void:
	if _start_check_deferred or _node == null:
		return
	_start_check_deferred = true
	_node.start_check_call.call_deferred(_session)


static func _on_deferred_start_check(session: RefCounted) -> void:
	if session != _session or not _is_initialized:
		return
	_start_check_deferred = false
	_start_check()


# ogw:input_boundary
static func _can_start(tutorial_id: int) -> bool:
	if not _has_hook():
		return true
	var mark: int = CoreScriptErrors.begin()
	var value: Variant = _can_start_hook.call(tutorial_id)
	if CoreScriptErrors.end(mark):
		LogCore.log_error(_TAG, "can_start_tutorial hook threw for tutorial %d" % tutorial_id)
		return false
	if not value is bool:
		LogCore.log_error(_TAG, "can_start_tutorial hook did not return a bool for tutorial %d" % tutorial_id)
		return false
	var allowed: bool = value
	return allowed


## True when a hook is registered and its owner is alive. Drops the registration of a destroyed owner.
static func _has_hook() -> bool:
	if _can_start_hook.is_null():
		return false
	if not is_instance_id_valid(_can_start_hook.get_object_id()):
		_can_start_hook = Callable()
		return false
	return true


## Puts a start watch on every `start_requirement` of the tutorials not finished.
static func _watch_starts() -> void:
	for def: _DEF in _defs:
		var requirement_id: int = def.start_requirement
		if requirement_id == 0 or _start_watches.has(requirement_id) or _is_complete(def):
			continue
		if RequirementCore.watch(requirement_id, _user_state_triggers(), _node.start_requirement_call):
			_start_watches[requirement_id] = true


## Takes the start watch of `requirement_id` off when every tutorial with it as `start_requirement` is finished.
static func _update_start_watch(requirement_id: int) -> void:
	if requirement_id == 0 or not _start_watches.has(requirement_id):
		return
	for def: _DEF in _defs:
		if def.start_requirement == requirement_id and not _is_complete(def):
			return
	_start_watches.erase(requirement_id)
	RequirementCore.unwatch(requirement_id, _node.start_requirement_call)


static func _user_state_triggers() -> Array[RequirementTrigger]:
	var trigger: RequirementTrigger = RequirementTrigger.new()
	trigger.kind = RequirementCore.TriggerKind.USER_STATE_CHANGED
	var triggers: Array[RequirementTrigger] = [trigger]
	return triggers


static func _on_start_requirement(_requirement_id: int, _result: RequirementResult) -> void:
	if _is_initialized:
		_start_check()


# --- Internal: step progress ---


static func _start_tutorial(def: _DEF) -> _RUN:
	var progress: int = _progress(def.id)
	var index: int = -1
	for i: int in def.steps.size():
		if def.steps[i].step > progress:
			index = i
			break
	if index < 0:
		return null
	var run: _RUN = _RUN.new()
	run.def = def
	run.index = index
	var at: int = _runs.size()
	for i: int in _runs.size():
		if def.order < _runs[i].def.order:
			at = i
			break
	_runs.insert(at, run)
	_begin_step(run)
	return run


## Step progress 1 of the current step, then 2.
static func _begin_step(run: _RUN) -> void:
	run.serial += 1
	run.stage = _RUN.Stage.WAITING
	run.element = null
	run.anchor_wait_from = -1
	run.anchor_warned = false
	run.tap_met = false
	run.press_pointers.clear()
	_ensure_view()
	var serial: int = run.serial
	var event: TutorialStepStartedEvent = EventCore.acquire(TutorialStepStartedEvent) as TutorialStepStartedEvent
	event.tutorial_id = run.def.id
	event.step = run.current().step
	EventCore.publish(event)
	if not _runs.has(run) or run.serial != serial:
		return
	if _scene_stopped:
		run.stage = _RUN.Stage.STOPPED
		return
	_enter_waiting(run)


## Step progress 2 from the start or from a stopped step progress: puts the requirement watch of a `Requirement` step
## and ends the step at once when its condition holds.
static func _enter_waiting(run: _RUN) -> void:
	run.stage = _RUN.Stage.WAITING
	var step: _STEP = run.current()
	if step.complete != GameData.TutorialComplete.REQUIREMENT or run.watching:
		return
	if not _watch_step(run):
		return
	if RequirementCore.evaluate(step.complete_requirement).passed and _runs.has(run):
		_end_step(run)


static func _watch_step(run: _RUN) -> bool:
	var requirement_id: int = run.current().complete_requirement
	if _step_watches.has(requirement_id):
		_step_watches[requirement_id] += 1
	elif RequirementCore.watch(requirement_id, _user_state_triggers(), _node.step_requirement_call):
		_step_watches[requirement_id] = 1
	else:
		return false
	run.watching = true
	return true


static func _unwatch_step(run: _RUN) -> void:
	if not run.watching:
		return
	run.watching = false
	var requirement_id: int = run.current().complete_requirement
	if not _step_watches.has(requirement_id):
		return
	var left: int = _step_watches[requirement_id] - 1
	if left > 0:
		_step_watches[requirement_id] = left
		return
	_step_watches.erase(requirement_id)
	RequirementCore.unwatch(requirement_id, _node.step_requirement_call)


static func _on_step_requirement(requirement_id: int, result: RequirementResult) -> void:
	if not _is_initialized or result == null or not result.passed:
		return
	for run: _RUN in _runs.duplicate():
		if not _runs.has(run) or not run.watching or run.stage == _RUN.Stage.STOPPED:
			continue
		var step: _STEP = run.current()
		if step.complete == GameData.TutorialComplete.REQUIREMENT and step.complete_requirement == requirement_id:
			_end_step(run)


## Step progress 5 and the end of the step: saves, then the next step or the end of the tutorial.
static func _end_step(run: _RUN) -> void:
	if not _runs.has(run):
		return
	var shown: bool = run == _shown
	if shown:
		_hide(run)
		_shown = null
	_unwatch_step(run)
	run.stage = _RUN.Stage.WAITING
	run.tap_met = false
	var step: _STEP = run.current()
	var tutorial_id: int = run.def.id
	if step.step > _done_step(tutorial_id):
		_done_steps[tutorial_id] = step.step
	var last: bool = run.index == run.def.steps.size() - 1
	if step.save or last:
		_save(tutorial_id, step.step)
	if not last:
		run.index += 1
		_begin_step(run)
		# The `Shown` tutorial is `Paused` at step progress 1 and 2 of its next step.
		if shown:
			_request_start_check()
		return
	_complete(run, false)


static func _complete(run: _RUN, skipped: bool) -> void:
	_runs.erase(run)
	if _shown == run:
		_shown = null
	var session: RefCounted = _session
	_update_start_watch(run.def.start_requirement)
	var event: TutorialCompletedEvent = EventCore.acquire(TutorialCompletedEvent) as TutorialCompletedEvent
	event.tutorial_id = run.def.id
	event.skipped = skipped
	EventCore.publish(event)
	if session == _session:
		_start_check()


static func _skip() -> bool:
	var run: _RUN = _shown
	if run == null or not run.def.skippable:
		return false
	_hide(run)
	_shown = null
	_unwatch_step(run)
	run.tap_met = false
	var tutorial_id: int = run.def.id
	var last: int = run.def.last_step()
	if last > _done_step(tutorial_id):
		_done_steps[tutorial_id] = last
	_save(tutorial_id, last)
	_complete(run, true)
	return true


static func _on_advance_click() -> void:
	var run: _RUN = _shown
	if _is_initialized and run != null and run.current().complete == GameData.TutorialComplete.ADVANCE:
		_end_step(run)


static func _on_skip_click() -> void:
	if _is_initialized:
		_skip()


## The view focus accept callback of an `AnchorTap` step: the accept input on the anchor element ends the step.
static func _on_accept(element: Control) -> void:
	var run: _RUN = _shown
	if not _is_initialized or run == null or element == null or element != run.element:
		return
	if run.current().complete == GameData.TutorialComplete.ANCHOR_TAP and not run.tap_met:
		_end_step(run)


## The UI pointer observer: a press and a release of one pointer inside the anchor rectangle meet the `AnchorTap`
## condition. Each pointer keeps its own press, so a press of another pointer does not drop it. The step ends in a
## deferred call, after the GUI handled the release.
static func _on_pointer(pointer_id: int, pressed: bool, position: Vector2) -> void:
	var run: _RUN = _shown
	if not _is_initialized or run == null or run.tap_met:
		return
	var step: _STEP = run.current()
	if step.complete != GameData.TutorialComplete.ANCHOR_TAP:
		return
	var anchor: AnchorResult = UICore.get_anchor_rect(step.anchor, step.anchor_key)
	var inside: bool = anchor.visible and anchor.rect.has_point(position)
	if pressed:
		if inside:
			run.press_pointers[pointer_id] = true
		else:
			run.press_pointers.erase(pointer_id)
		return
	if not run.press_pointers.erase(pointer_id) or not inside:
		return
	run.tap_met = true
	_tap_run = run
	_tap_serial = run.serial
	_node.tap_end_call.call_deferred()


static func _on_tap_end() -> void:
	var run: _RUN = _tap_run
	_tap_run = null
	if not _is_initialized or run == null or not _runs.has(run) or run.serial != _tap_serial or not run.tap_met:
		return
	_end_step(run)


# --- Internal: scene and UserState events ---


static func _on_scene_ended() -> void:
	if not _is_initialized:
		return
	_scene_stopped = true
	if _shown != null:
		_hide(_shown)
		_shown = null
	for run: _RUN in _runs:
		_unwatch_step(run)
		run.stage = _RUN.Stage.STOPPED
		run.element = null
		run.tap_met = false
		run.press_pointers.clear()
		run.anchor_wait_from = -1
	_tap_run = null


static func _on_scene_started() -> void:
	if not _is_initialized:
		return
	_scene_stopped = false
	for run: _RUN in _runs.duplicate():
		if _runs.has(run) and run.stage == _RUN.Stage.STOPPED:
			_enter_waiting(run)
	if _is_initialized:
		_start_check()


static func _on_user_state_changed() -> void:
	if _is_initialized:
		_start_check()


# --- Internal: saving ---


static func _save(tutorial_id: int, step: int) -> void:
	if not _save_steps.has(tutorial_id) or step > _save_steps[tutorial_id]:
		_save_steps[tutorial_id] = step
	if step <= _server_step(tutorial_id):
		return
	_send(tutorial_id, step)


## Sends the largest step a save of this run was for again for each tutorial whose stored progress step is smaller and
## that has no `SaveTutorialProgress` waiting for a response. A step whose `save` is false and that is not the last is
## not sent.
static func _resend() -> void:
	for tutorial_id: int in _save_steps:
		var done: int = _save_steps[tutorial_id]
		if done > _server_step(tutorial_id) and not _pending_saves.has(tutorial_id):
			_send(tutorial_id, done)


## Counts a `SaveTutorialProgress` as waiting for a response and sends it in a deferred call: the step progress, frame
## code included, does not wait for it.
static func _send(tutorial_id: int, step: int) -> void:
	_pending_saves[tutorial_id] = (_pending_saves[tutorial_id] if _pending_saves.has(tutorial_id) else 0) + 1
	_node.send_call.call_deferred(_session, tutorial_id, step)


## Async. Sends `SaveTutorialProgress` and waits for its end.
static func _send_now(session: RefCounted, tutorial_id: int, step: int) -> void:
	if session != _session:
		return
	var request: CoreContract.SaveTutorialProgressRequest = CoreContract.SaveTutorialProgressRequest.new()
	request.tutorial_id = tutorial_id
	request.step = step
	await NetworkCore.send(request, Callable(), _node.save_failure_call)
	if session != _session or not _pending_saves.has(tutorial_id):
		return
	var left: int = _pending_saves[tutorial_id] - 1
	if left > 0:
		_pending_saves[tutorial_id] = left
	else:
		_pending_saves.erase(tutorial_id)


# --- Internal: show condition and frame check ---


## Step screen condition and step anchor condition of `step`, with a new anchor lookup.
static func _show_condition(step: _STEP) -> bool:
	if not _screen_condition(step):
		return false
	if step.anchor.is_empty():
		return true
	return _anchor_condition(step, UICore.get_anchor_rect(step.anchor, step.anchor_key))


static func _screen_condition(step: _STEP) -> bool:
	if not step.panel.is_empty():
		if UICore.get_current_panel_key() != step.panel or not UICore.get_open_popups().is_empty():
			return false
	if not step.popup.is_empty():
		var popups: PackedStringArray = UICore.get_open_popups()
		if popups.is_empty() or popups[popups.size() - 1] != step.popup:
			return false
	return true


static func _anchor_condition(step: _STEP, anchor: AnchorResult) -> bool:
	if step.anchor.is_empty():
		return true
	if anchor == null or not anchor.visible:
		return false
	if not step.panel.is_empty():
		return anchor.owner == step.panel
	if not step.popup.is_empty():
		return anchor.owner == step.popup
	return true


static func _on_frame() -> void:
	if not _is_initialized or _scene_stopped or _runs.is_empty():
		return
	var system_popup: bool = UICore.is_system_popup_visible()
	if _shown != null:
		_frame_shown(_shown, system_popup)
	_frame_waiting(system_popup)


## Step progress 3 to 5 of the `Shown` tutorial: the system popup hide, the pause and following the anchor.
static func _frame_shown(run: _RUN, system_popup: bool) -> void:
	if _view_state == _VIEW_READY:
		_view_root.visible = not system_popup
	var step: _STEP = run.current()
	var anchor: AnchorResult = null
	if not step.anchor.is_empty():
		anchor = UICore.get_anchor_rect(step.anchor, step.anchor_key)
	if not system_popup and not run.tap_met:
		var holds: bool = _screen_condition(step) and _anchor_condition(step, anchor)
		if not holds or (anchor != null and anchor.element != run.element):
			_pause(run)
			return
	if _view_state == _VIEW_READY:
		_follow(step, anchor)


## Step progress 2 of every `Paused` tutorial: the anchor wait warn log, and the move to `Shown` of one of them when
## there is no `Shown` tutorial.
static func _frame_waiting(system_popup: bool) -> void:
	var now: int = TimeCore.get_real_time()
	var chosen: _RUN = null
	var chosen_anchor: AnchorResult = null
	var view_settled: bool = _view_state == _VIEW_READY or _view_state == _VIEW_FAILED
	for run: _RUN in _runs:
		if run.stage != _RUN.Stage.WAITING:
			continue
		var step: _STEP = run.current()
		var screen: bool = _screen_condition(step)
		var anchor: AnchorResult = null
		var anchored: bool = true
		if screen and not step.anchor.is_empty():
			anchor = UICore.get_anchor_rect(step.anchor, step.anchor_key)
			anchored = _anchor_condition(step, anchor)
		if screen and not anchored:
			if run.anchor_wait_from < 0:
				run.anchor_wait_from = now
			elif not run.anchor_warned and now - run.anchor_wait_from >= _anchor_wait_warn_ms:
				run.anchor_warned = true
				LogCore.log_warn(_TAG, "tutorial %d step %d: anchor %s key %d is not visible" % [
					run.def.id, step.step, step.anchor, step.anchor_key
				])
		else:
			run.anchor_wait_from = -1
		if not screen or not anchored or system_popup or not view_settled or _shown != null:
			continue
		if chosen == null or run.def.id == _last_shown_id:
			chosen = run
			chosen_anchor = anchor
	if chosen != null and _shown == null:
		_show(chosen, chosen_anchor)


## Step progress 3 and 4.
static func _show(run: _RUN, anchor: AnchorResult) -> void:
	run.stage = _RUN.Stage.SHOWN
	run.anchor_wait_from = -1
	run.element = anchor.element if anchor != null else null
	_shown = run
	_last_shown_id = run.def.id
	var step: _STEP = run.current()
	if _view_state == _VIEW_READY:
		_present(run, anchor)
	elif step.complete == GameData.TutorialComplete.ADVANCE:
		_end_step(run)
		return
	if step.complete == GameData.TutorialComplete.ANCHOR_TAP and _gamepad_supported:
		if run.element == null or not _has_ui_button(run.element):
			LogCore.log_error(_TAG, "tutorial %d step %d: AnchorTap anchor %s key %d has no UIButton" % [
				run.def.id, step.step, step.anchor, step.anchor_key
			])
	if step.restrict_input:
		_put_block(run)


## Pause: back to step progress 2 of the same step.
static func _pause(run: _RUN) -> void:
	_hide(run)
	_shown = null
	run.stage = _RUN.Stage.WAITING
	run.element = null
	_request_start_check()


## Hides the tutorial view, clears the view focus and lifts the block of the `Shown` step.
static func _hide(run: _RUN) -> void:
	if _view_state == _VIEW_READY:
		_view_root.visible = false
		LocalizationCore.unbind_text(_view.text_label)
	if run.has_focus:
		_clear_focus()
		run.has_focus = false
	run.press_pointers.clear()
	_lift_block(run)


static func _clear_focus() -> void:
	var none: Array[Control] = []
	UICore.set_view_focus(UICore.FocusView.TUTORIAL, none, null, Callable())


## Starts the reason tag `tutorial` block of the `Shown` step in a deferred call: `_show` is frame code, which does not
## call the async operation `InputBlockCore.run_blocked`.
static func _put_block(run: _RUN) -> void:
	var wait: _WAIT = _WAIT.new()
	run.block = wait
	_node.block_call.call_deferred(_session, wait)


## Async. Puts the reason tag `tutorial` block of the `Shown` step and waits until `_lift_block` lifts it. Does nothing
## when the block was lifted before this deferred call.
static func _run_block(session: RefCounted, wait: _WAIT) -> void:
	var run: _RUN = _shown
	if session != _session or wait.finished or run == null or run.block != wait:
		return
	var pass_list: BlockPassList = BlockPassList.new()
	if is_instance_valid(run.element):
		pass_list.elements.append(run.element)
	if _view_state == _VIEW_READY:
		if _view.advance_button.visible:
			pass_list.elements.append(_view.advance_button)
		if _view.skip_button.visible:
			pass_list.elements.append(_view.skip_button)
	var system: BlockPassList = UICore.get_block_pass_list()
	if system != null:
		pass_list.elements.append_array(system.elements)
	await InputBlockCore.run_blocked(_REASON, wait.run, pass_list, _node)


static func _lift_block(run: _RUN) -> void:
	var wait: _WAIT = run.block
	run.block = null
	if wait != null:
		wait.finish()


static func _has_ui_button(element: Control) -> bool:
	for child: Node in element.get_children():
		if child is UIButton:
			return true
	return false


# --- Internal: tutorial view ---


## Starts loading the tutorial view in a deferred call the first time a step starts.
static func _ensure_view() -> void:
	if _view_state != _VIEW_NONE:
		return
	_view_state = _VIEW_LOADING
	_node.load_view_call.call_deferred(_session)


## Async. Loads the tutorial view resource in the global scope and makes the one tutorial view.
static func _load_view(session: RefCounted) -> void:
	if session != _session:
		return
	var resource: Resource = null
	if not _view_key.is_empty():
		resource = await ResourceCore.load(_view_key, ResourceCore.BaseKind.PACKED_SCENE, ResourceCore.get_global_scope())
	if session != _session:
		return
	var scene: PackedScene = resource as PackedScene
	if scene == null:
		_fail_view("tutorial view resource %s could not be loaded" % _view_key)
		return
	var instance: Node = scene.instantiate()
	var view: TutorialView = _view_component(instance)
	_layer = UICore.get_layer(UICore.UILayer.TUTORIAL)
	if view == null or _layer == null:
		if instance != null:
			instance.free()
		_layer = null
		_fail_view("tutorial view resource %s failed the view check" % _view_key)
		return
	_set_up_view(instance as Control, view)


static func _fail_view(message: String) -> void:
	LogCore.log_error(_TAG, message)
	_view_state = _VIEW_FAILED


## The tutorial view component of a view root that passes the view check, or `null`.
static func _view_component(instance: Node) -> TutorialView:
	if not instance is Control:
		return null
	for child: Node in instance.get_children():
		var view: TutorialView = child as TutorialView
		if view == null:
			continue
		var complete: bool = (
			view.dim != null and view.speech_bubble != null and view.text_label != null and view.hand_pointer != null
			and view.advance_button != null and view.skip_button != null
			and _has_ui_button(view.advance_button) and _has_ui_button(view.skip_button)
		)
		return view if complete else null
	return null


static func _set_up_view(root: Control, view: TutorialView) -> void:
	var safe_root: SafeAreaRoot = SafeAreaRoot.new()
	safe_root.name = "TutorialSafeAreaRoot"
	_layer.add_child(safe_root)
	safe_root.add_child(root)
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.visible = false
	_ignore_pointer(root, view)
	var has_ignore: bool = false
	for child: Node in view.dim.get_children():
		if child is SafeAreaIgnore:
			has_ignore = true
	if not has_ignore:
		view.dim.add_child(SafeAreaIgnore.new())
	var shader: Shader = Shader.new()
	shader.code = _HIGHLIGHT_SHADER
	var material: ShaderMaterial = ShaderMaterial.new()
	material.shader = shader
	view.dim.material = material
	_set_click(view.advance_button, _node.advance_call)
	_set_click(view.skip_button, _node.skip_call)
	_safe_root = safe_root
	_view_root = root
	_view = view
	_material = material
	_bubble_home = view.speech_bubble.position
	_view_state = _VIEW_READY
	LocalizationCore.bind_text(view.skip_button, ReservedString.tutorial_skip())


static func _set_click(button: Button, callback: Callable) -> void:
	for child: Node in button.get_children():
		var ui_button: UIButton = child as UIButton
		if ui_button != null:
			ui_button.set_on_click(callback)


## Every `Control` of the tutorial view takes no pointer input, the advance button, the skip button and their
## descendants aside.
static func _ignore_pointer(node: Node, view: TutorialView) -> void:
	if node == view.advance_button or node == view.skip_button:
		return
	var control: Control = node as Control
	if control != null:
		control.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for child: Node in node.get_children():
		_ignore_pointer(child, view)


## Step progress 3: shows the tutorial view of the step.
static func _present(run: _RUN, anchor: AnchorResult) -> void:
	var step: _STEP = run.current()
	var anchored: bool = not step.anchor.is_empty()
	_view.dim.visible = anchored
	_view.speech_bubble.visible = not step.text.is_empty()
	_view.hand_pointer.visible = step.pointer and anchored
	_view.advance_button.visible = step.complete == GameData.TutorialComplete.ADVANCE
	_view.skip_button.visible = run.def.skippable
	if not step.text.is_empty():
		LocalizationCore.bind_text(_view.text_label, step.text)
	if not anchored:
		_view.speech_bubble.position = _bubble_home
	_view_root.visible = not UICore.is_system_popup_visible()
	_follow(step, anchor)
	_set_focus(run)


static func _set_focus(run: _RUN) -> void:
	var step: _STEP = run.current()
	var elements: Array[Control] = []
	var initial: Control = null
	if step.complete == GameData.TutorialComplete.ADVANCE:
		initial = _view.advance_button
		elements.append(initial)
	elif step.complete == GameData.TutorialComplete.ANCHOR_TAP:
		if run.element != null and _has_ui_button(run.element):
			initial = run.element
			elements.append(initial)
	else:
		return
	if _view.skip_button.visible:
		elements.append(_view.skip_button)
	if elements.is_empty():
		return
	UICore.set_view_focus(UICore.FocusView.TUTORIAL, elements, initial, _node.accept_call)
	run.has_focus = true


## Puts the highlight, the hand pointer and the speech bubble on the anchor rectangle.
static func _follow(step: _STEP, anchor: AnchorResult) -> void:
	if step.anchor.is_empty() or anchor == null or not anchor.visible:
		return
	# The anchor rectangle is in game coordinates; the canvas of the `Tutorial` layer is moved by its offset.
	var rect: Rect2 = anchor.rect
	rect.position -= _layer.offset
	var dim: ColorRect = _view.dim
	var dim_origin: Vector2 = dim.global_position
	_material.set_shader_parameter(_SIZE_PARAM, dim.size)
	_material.set_shader_parameter(_HOLE_PARAM, Vector4(
		rect.position.x - dim_origin.x, rect.position.y - dim_origin.y, rect.size.x, rect.size.y
	))
	var pointer: Control = _view.hand_pointer
	pointer.global_position = rect.get_center() - pointer.size * 0.5
	var bubble: Control = _view.speech_bubble
	var area: Rect2 = _view_root.get_global_rect()
	var size: Vector2 = bubble.size
	var above: float = rect.position.y - area.position.y
	var below: float = area.end.y - rect.end.y
	var place: Vector2 = Vector2(rect.get_center().x - size.x * 0.5, rect.end.y if below >= above else rect.position.y - size.y)
	place.x = maxf(area.position.x, minf(place.x, area.end.x - size.x))
	place.y = maxf(area.position.y, minf(place.y, area.end.y - size.y))
	bubble.global_position = place
