class_name ShortcutCore
extends RefCounted
## Screen moves along the paths of the `shortcut` table: to a target scene, and then through a panel path whose last
## item is the target panel. Example: "get more" of a currency popup, "go" of a quest.

const _TAG: String = "ShortcutCore"
const _WAIT := preload("res://core/shortcut_core/shortcut_wait.gd")

static var _is_initialized: bool = false
## Session of this init. A navigation that resumes in another session ends with `false`.
static var _session: RefCounted = null
## Param builder by panel key.
static var _param_builders: Dictionary[String, Callable] = {}
## From stage 2 of a `navigate` until it ends or stops.
static var _navigating: bool = false
## Wait of the operation the running navigation waits for. `release` cancels it.
static var _wait: _WAIT = null


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init called while initialized")
		return false
	_session = RefCounted.new()
	_is_initialized = true
	return true


static func release() -> void:
	if not _is_initialized:
		return
	var wait: _WAIT = _wait
	_is_initialized = false
	_session = null
	_param_builders = {}
	_navigating = false
	_wait = null
	if wait != null:
		wait.cancel()


static func is_initialized() -> bool:
	return _is_initialized


## Registers the param builder of `panel_key`: a static func `(row: GameData.ShortcutRow, is_target: bool) -> UIParam`
## that returns the param of that panel, or `null` when it cannot make one.
static func register_param_builder(panel_key: String, builder: Callable) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "register_param_builder called before init")
		return false
	if not (builder.is_valid() and builder.is_standard() and builder.get_object() is Script):
		LogCore.log_error(_TAG, "param builder of %s is not a static func" % panel_key)
		return false
	if _param_builders.has(panel_key):
		LogCore.log_error(_TAG, "param builder of %s is already registered" % panel_key)
		return false
	_param_builders[panel_key] = builder
	return true


## Async. Moves to the screen of the `shortcut` row `shortcut_id`. `false` when the move was refused or stopped.
static func navigate(shortcut_id: int) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "navigate called before init")
		return false
	if _navigating or SceneCore.is_transitioning() or UICore.is_panel_transitioning():
		LogCore.log_warn(_TAG, "navigate %d: a navigation or a transition is in progress" % shortcut_id)
		return false
	var session: RefCounted = _session
	_navigating = true
	var row: GameData.ShortcutRow = null
	if GameData.ShortcutTable.has_row(shortcut_id):
		row = GameData.ShortcutTable.get_row(shortcut_id)
	var ok: bool = await _run(row, shortcut_id, session)
	if session != _session:
		return false
	_navigating = false
	if not ok:
		return false
	var event: ShortcutNavigatedEvent = EventCore.acquire(ShortcutNavigatedEvent) as ShortcutNavigatedEvent
	event.shortcut_id = shortcut_id
	event.scene_key = row.scene
	event.panel_keys = PackedStringArray(row.panels)
	EventCore.publish(event)
	return true


static func is_navigating() -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "is_navigating called before init")
		return false
	return _navigating


## Async. Stages 2 to 8 of `navigate`. `false` when a stage stops the move or the session changed.
static func _run(row: GameData.ShortcutRow, shortcut_id: int, session: RefCounted) -> bool:
	if row == null:
		LogCore.log_error(_TAG, "navigate: shortcut ID %d is not in the shortcut table" % shortcut_id)
		return false
	if row.requirement != 0:
		var result: RequirementResult = RequirementCore.evaluate(row.requirement)
		if not result.passed:
			_lock_notice(result)
			return false
	var requests: Array[UIPanelRequest] = []
	if not _build_requests(row, requests):
		return false
	UICore.close_all_popups()
	if session != _session:
		return false
	if SceneCore.is_transitioning() or UICore.is_panel_transitioning():
		LogCore.log_warn(_TAG, "navigate %d: a transition started while popups closed" % shortcut_id)
		return false
	var scene_changed: bool = false
	if row.scene != SceneCore.current_scene_key():
		var changed: bool = await _wait_for(SceneCore.change_scene.bind(row.scene, null))
		if session != _session or not changed:
			return false
		scene_changed = true
	var at_root: bool = scene_changed or row.stack != GameData.ShortcutStack.TOP
	var root_key: String = SceneCore.current_root_panel_key()
	if at_root and root_key != "":
		var closed: bool = await _wait_for(UICore.close_panels_to.bind(root_key, false))
		if session != _session or not closed:
			return false
	if requests.is_empty() or (at_root and requests.size() == 1 and requests[0].panel_key == root_key):
		return true
	var clear_stack: bool = at_root and root_key == ""
	var opened: bool = false
	if requests.size() == 1:
		opened = await _wait_for(UICore.open_panel.bind(requests[0].panel_key, requests[0].param, clear_stack))
	else:
		opened = await _wait_for(UICore.open_panels.bind(requests, clear_stack))
	return session == _session and opened


## Stage 4 of `navigate`: one `UIPanelRequest` for each panel of the panel path into `requests`, with the param its
## param builder made, or none without a builder. `false` with an error log when a param cannot be made.
static func _build_requests(row: GameData.ShortcutRow, requests: Array[UIPanelRequest]) -> bool:
	var count: int = row.panels.size()
	for i: int in count:
		var request: UIPanelRequest = UIPanelRequest.new()
		request.panel_key = row.panels[i]
		var is_target: bool = i == count - 1
		if _param_builders.has(request.panel_key):
			request.param = _call_param_builder(_param_builders[request.panel_key], row, is_target, request.panel_key)
			if request.param == null:
				return false
		elif is_target and not row.args.is_empty():
			LogCore.log_error(_TAG, "target panel %s has args and no param builder" % request.panel_key)
			return false
		requests.append(request)
	return true


## Calls a param builder. `null` with an error log when it threw (a GDScript runtime error during the call), returned
## none or returned a value that is not a `UIParam`.
# ogw:input_boundary
static func _call_param_builder(
		builder: Callable, row: GameData.ShortcutRow, is_target: bool, panel_key: String
) -> UIParam:
	var mark: int = CoreScriptErrors.begin()
	var value: Variant = builder.call(row, is_target)
	if CoreScriptErrors.end(mark):
		LogCore.log_error(_TAG, "param builder of %s threw" % panel_key)
		return null
	if value is UIParam:
		var param: UIParam = value
		return param
	if value == null:
		LogCore.log_error(_TAG, "param builder of %s returned none" % panel_key)
	else:
		LogCore.log_error(_TAG, "param builder of %s did not return a UIParam" % panel_key)
	return null


## The lock notice of a failed requirement: a toast of its guide text, when it has one.
static func _lock_notice(result: RequirementResult) -> void:
	if result.guide_key == "":
		return
	var args: FormatArgs = FormatArgs.new()
	RequirementCore.fill_guide_args(result, args)
	MessageCore.show_toast(result.guide_key, args)


## Async. Runs `operation`, an async operation with a success flag, and waits for it. `false` when `release` cancels
## the wait.
static func _wait_for(operation: Callable) -> bool:
	var wait: _WAIT = _WAIT.new()
	_wait = wait
	wait.start(operation)
	if not wait.finished and not wait.cancelled:
		await wait.done
	if _wait == wait:
		_wait = null
	return wait.finished and wait.ok
