class_name UICore
extends RefCounted
## UI layers, panels and the panel stack, popups and the popup queue, popup suppression, system popups, back input,
## focus, the keyboard shift of text input elements, the loading icon, UI buttons, scroll lists and the license screen.

enum UILayer {
	WORLD_EFFECT, SCENE_UI, VIRTUAL_PAD, PANEL, CUTSCENE_EFFECT, CUTSCENE, LOADING, TRANSITION_EFFECT, POPUP, TUTORIAL,
	MESSAGE, LOADING_ICON, FATAL, DEBUG,
}
enum PopupSuppressMode { FOREVER, TODAY }
enum PopupOpenResult { OPENED, SUPPRESSED, FAILED }
enum FocusView { CUTSCENE, TUTORIAL }
enum BackPolicy { CLOSE, IGNORE, CUSTOM }
enum PanelOpenReason { NEW, RETURNED }
enum PanelCloseReason { COVERED, CLOSED }
enum UIScrollSizeMode { FIXED, MEASURED }

const _TAG: String = "UICore"
const _REASON: String = "ui"
const _SUPPRESS_KEY: String = "UICore.popup_suppress"
const _LICENSES_PATH: String = "res://generated/licenses.json"
## Largest license manifest `open_licenses` reads.
const _LICENSES_MAX_BYTES: int = 16 * 1024 * 1024
const _BACK_ACTION: StringName = &"back"
## `CanvasLayer.layer` of `WORLD_EFFECT`; each next UI layer is one higher. The world canvas is layer 0.
const _LAYER_BASE: int = 1
const _LAYER_NAMES: PackedStringArray = [
	"WorldEffect", "SceneUI", "VirtualPad", "Panel", "CutsceneEffect", "Cutscene", "Loading", "TransitionEffect",
	"Popup", "Tutorial", "Message", "LoadingIcon", "Fatal", "Debug",
]
const _EXIT_PLATFORMS: PackedStringArray = ["android", "windows", "macos", "linux"]
const _LICENSE_PLATFORMS: PackedStringArray = ["android", "ios", "web", "windows", "macos", "linux"]
const _SYSTEM_POPUP_SCOPE: String = "system_popup"
## Size of the code made loading icon and its turn speed.
const _ICON_SIZE: float = 48.0
const _ICON_TURN_PER_SECOND: float = TAU
## Area of the code made system popup inside the safe area, as anchors.
const _SYSTEM_POPUP_ANCHORS: Vector4 = Vector4(0.1, 0.25, 0.9, 0.75)

const _CORE_NODE := preload("res://core/ui_core/ui_core_node.gd")
const _ENTRY := preload("res://core/ui_core/panel_entry.gd")
const _VIEW := preload("res://core/ui_core/panel_view.gd")
const _POPUP := preload("res://core/ui_core/popup_record.gd")
const _FLOW := preload("res://core/ui_core/ui_flow.gd")
const _WAITER := preload("res://core/ui_core/call_waiter.gd")
const _HOLDER := preload("res://core/ui_core/focus_holder.gd")
const _VIEW_FOCUS := preload("res://core/ui_core/view_focus.gd")
const _ACCEPT_STATE := preload("res://core/ui_core/accept_state.gd")
const _SYSTEM_VIEW := preload("res://core/ui_core/system_popup_view.gd")
## Viewport direction of each `Side`, by its value.
const _SIDE_DIRECTIONS: Array[Vector2] = [Vector2(-1.0, 0.0), Vector2(0.0, -1.0), Vector2(1.0, 0.0), Vector2(0.0, 1.0)]
## Tolerance of the "wholly past the far edge" check of the view focus neighbor search, as in the engine.
const _NEIGHBOR_EPSILON: float = 0.00001
## Gamepad button and gamepad axis names of `InputCore` bindings (engine implementation rules); the index is the
## `JoyButton` or `JoyAxis` value.
const _PAD_BUTTON_NAMES: Array[String] = [
	"a", "b", "x", "y", "back", "guide", "start", "left_stick", "right_stick", "left_shoulder", "right_shoulder",
	"dpad_up", "dpad_down", "dpad_left", "dpad_right",
]
const _PAD_AXIS_NAMES: Array[String] = ["left_x", "left_y", "right_x", "right_y", "trigger_left", "trigger_right"]
const _SETTING_MAX_KEYS_PER_ACTION: String = "InputCore.maxKeysPerAction"
const _SETTING_MAX_PAD_BUTTONS_PER_ACTION: String = "InputCore.maxPadButtonsPerAction"

## State of a panel or popup instance in `_instance_state`.
const _PREPARING: int = 0
const _SHOWN: int = 1
const _DESTROYING: int = 2

static var _is_initialized: bool = false
## Replaced by every `init`; an async operation that sees another session after `await` ends with its failure value.
static var _session: RefCounted = null
static var _node: Node = null
static var _prepared: bool = false
static var _preparing: bool = false

# Core settings.
static var _click_interval_ms: int = 0
static var _dim_resource: String = ""
static var _dim_opacity: float = 0.0
static var _loading_icon_resource: String = ""
static var _system_popup_resource: String = ""
static var _scroll_load_threshold: int = 0
static var _keyboard_gap: float = 0.0
static var _system_popup_scroll_step: float = 0.0

# UI layers and the elements UICore keeps on them.
static var _layers: Array[CanvasLayer] = []
static var _panel_root: Control = null
static var _popup_root: Control = null
static var _icon_root: Control = null
static var _system_root: Control = null
static var _pass_list: BlockPassList = null
static var _panel_dim: Control = null
static var _panel_blocker: Control = null
static var _popup_dim: Control = null
static var _popup_blocker: Control = null
static var _loading_icon: Control = null
static var _loading_icon_code_made: bool = false
static var _system_popup_scene: PackedScene = null
static var _tween_options: TweenOptions = null
## State by instance ID of every panel and popup instance UICore made: `_PREPARING`, `_SHOWN` or `_DESTROYING`.
static var _instance_state: Dictionary[int, int] = {}

# Panels.
static var _stack: Array[_ENTRY] = []
static var _current: _VIEW = null
static var _flow: _FLOW = null
## The ended flow whose `PanelFlowFinishedEvent` is not published yet, and its success flag.
static var _finished_flow: _FLOW = null
static var _finished_ok: bool = false
static var _panel_lock: bool = false
## Set by `_make_view` when it failed because the prefab root is not a `UIPanel`.
static var _make_failed_not_panel: bool = false

# Popups.
static var _queue: Array[_POPUP] = []
## The normal popup in its open flow, from the block to the end of the open tween.
static var _open_record: _POPUP = null
## Shown popups, bottom first. Normal popups are under the system popup root, system popups in it.
static var _shown_normal: Array[_POPUP] = []
static var _shown_system: Array[_POPUP] = []
static var _closing_all: bool = false

# Loading icon.
static var _icon_tokens: Dictionary[int, bool] = {}
static var _icon_serial: int = 0

# Back input.
static var _back_override: Callable = Callable()
static var _licenses_open: bool = false
## Wait of `open_licenses` for the license screen to close.
static var _licenses_waiter: _WAITER = null
## Wait of `prepare` for a resource load.
static var _prepare_waiter: _WAITER = null
## Path of the license manifest. The core tests point it at their own file.
static var _licenses_path: String = _LICENSES_PATH

# Focus.
static var _tutorial_view: _VIEW_FOCUS = null
static var _cutscene_view: _VIEW_FOCUS = null
## A key direction input started the focus mode and no mouse input ended it.
static var _key_focus_mode: bool = false
## The focus is not put before this process frame: the frame after the input device became `Gamepad`.
static var _focus_delay_frame: int = 0
## Process frame of the last accept input.
static var _accept_frame: int = -1
## The last accept event: at a click by an accept input, the event of the accept input that clicks.
static var _accept_last: InputEvent = null
## The state before the first accept event of `_accept_frame`.
static var _accept_first: _ACCEPT_STATE = null
## The state before the last press of each accept input, by `_accept_input_id`.
static var _accept_presses: Dictionary[String, _ACCEPT_STATE] = {}
## The gamepad axis accept inputs pressed and not released yet, by `_accept_input_id`, with `InputCore.get_cancel_count`
## at the press. An axis held past the press sends more press events at each axis value change; they are not presses of
## their own. A key or gamepad button sends one press event per press, so it is not kept here. `InputCore` releases the
## sources with no release event at an input cancel, where the cancel count goes up and the next axis value event
## presses the source again, and at the gamepad disconnection, where the axes of that gamepad are erased. In the blocked
## state an axis press event is a press only when the block stage of `InputCore` passes it to an action whose source it
## presses (`_axis_press_passes`); otherwise it is not kept: the next value event after the block is the first press.
static var _accept_held: Dictionary[String, int] = {}
static var _update_focus_callable: Callable = Callable()
## A direction input that the engine moves out of the view focus or not at all: the event, the focus owner it starts
## from and the nearest visible view focus element in that direction. Kept until the next input or frame.
static var _view_move_event: InputEvent = null
static var _view_move_from: Control = null
static var _view_move_to: Control = null

# Text input and keyboard shift.
static var _text_input: Control = null
## The shift target: a panel or popup instance root, or a UI layer. `null`: none.
static var _shift_target: Object = null
static var _shift_distance: float = 0.0

# UI buttons and anchors.
static var _has_click: bool = false
static var _last_click_ms: int = 0
static var _action_buttons: Array[UIButton] = []
## Buttons whose `_accept_pending` is set.
static var _pending_clicks: Array[UIButton] = []
static var _anchors: Array[UIAnchor] = []


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init: already initialized")
		return false
	if not _read_settings():
		return false
	_session = RefCounted.new()
	_tween_options = TweenOptions.new()
	_update_focus_callable = UICore._update_focus
	var node: Node = _CORE_NODE.new()
	node.name = "UICore"
	_node = node
	_build_layers(node)
	_is_initialized = true
	var root: Window = (Engine.get_main_loop() as SceneTree).root
	root.add_child(node)
	var core_node: _CORE_NODE = node as _CORE_NODE
	if root.gui_focus_changed.connect(core_node._on_focus_changed) != OK:
		LogCore.log_error(_TAG, "init: gui_focus_changed connect failed")
	EventCore.subscribe(InputDeviceChangedEvent, core_node._on_device_changed)
	EventCore.subscribe(GamepadConnectionChangedEvent, core_node._on_gamepad_connection_changed)
	EventCore.subscribe(SafeAreaChangedEvent, core_node._on_safe_area_changed)
	EventCore.subscribe(KeyboardAreaChangedEvent, core_node._on_keyboard_area_changed)
	InputCore.set_back_handler(UICore._handle_back)
	return true


static func release() -> void:
	if not _is_initialized:
		return
	var node: Node = _node
	# Out of the tree first: the scroll lists give their item UIs back before the scopes are released.
	if is_instance_valid(node):
		(node as _CORE_NODE).released = true
		var parent: Node = node.get_parent()
		if parent != null:
			parent.remove_child(node)
	_end_state()
	if is_instance_valid(node):
		node.queue_free()


static func is_initialized() -> bool:
	return _is_initialized


## Async. Loads the dim, loading icon and system popup resources of the core settings and `[ui_button_click]` into the
## global scope. `false` when one failed; the failed ones are code made.
static func prepare() -> bool:
	if not _check_initialized("prepare"):
		return false
	if _prepared or _preparing:
		LogCore.log_error(_TAG, "prepare: already called")
		return false
	_preparing = true
	var session: RefCounted = _session
	var global: Scope = ResourceCore.get_global_scope()
	var all_loaded: bool = true
	if not _dim_resource.is_empty():
		var dim_scene: PackedScene = await _load_ui_prefab(_dim_resource, global)
		if session != _session:
			return false
		if dim_scene == null:
			all_loaded = false
		else:
			_panel_dim = _replace_element(_panel_dim, _make_dim_from(dim_scene))
			_popup_dim = _replace_element(_popup_dim, _make_dim_from(dim_scene))
	if not _loading_icon_resource.is_empty():
		var icon_scene: PackedScene = await _load_ui_prefab(_loading_icon_resource, global)
		if session != _session:
			return false
		if icon_scene == null:
			all_loaded = false
		else:
			var icon: Control = icon_scene.instantiate() as Control
			_ignore_pointer(icon)
			icon.set_anchors_and_offsets_preset(Control.PRESET_CENTER, Control.PRESET_MODE_KEEP_SIZE)
			_loading_icon = _replace_element(_loading_icon, icon)
			_loading_icon_code_made = false
	if not _system_popup_resource.is_empty():
		var popup_scene: PackedScene = await _load_ui_prefab(_system_popup_resource, global)
		if session != _session:
			return false
		if popup_scene == null:
			all_loaded = false
		else:
			_system_popup_scene = popup_scene
	var click: String = ReservedSound.ui_button_click()
	if not click.is_empty():
		var waiter: _WAITER = _WAITER.new()
		_prepare_waiter = waiter
		waiter.start_load(click, ResourceCore.BaseKind.AUDIO_STREAM, global)
		if not waiter.finished and not waiter.cancelled:
			await waiter.done
		if session != _session:
			return false
		_prepare_waiter = null
		if not ResourceCore.is_loaded(click, ResourceCore.BaseKind.AUDIO_STREAM):
			LogCore.log_error(_TAG, "prepare: %s is the fallback resource" % click)
			all_loaded = false
	_preparing = false
	_prepared = true
	_update_loading_icon()
	return all_loaded


static func get_layer(layer: UILayer) -> CanvasLayer:
	if not _check_initialized("get_layer"):
		return null
	if layer < 0 or layer >= _layers.size():
		LogCore.log_error(_TAG, "get_layer: %d is not a UI layer" % layer)
		return null
	return _layers[layer]


# --- Panels ---


## Async. Opens `panel_key` as the root item of an empty stack.
static func open_root_panel(panel_key: String) -> bool:
	if not _check_ready("open_root_panel") or not _check_transition("open_root_panel"):
		return false
	if not _stack.is_empty():
		LogCore.log_error(_TAG, "open_root_panel: the panel stack is not empty")
		return false
	var flow: _FLOW = _FLOW.new()
	flow.kind = _FLOW.Kind.OPEN
	flow.panel_key = panel_key
	flow.root = true
	return await _transition(flow)


## Async. Opens `panel_key` with `param` on top of the stack. With `clear_stack`, the items above the root item go.
static func open_panel(panel_key: String, param: UIParam, clear_stack: bool) -> bool:
	if not _check_ready("open_panel") or not _check_transition("open_panel"):
		return false
	var flow: _FLOW = _FLOW.new()
	flow.kind = _FLOW.Kind.OPEN
	flow.panel_key = panel_key
	flow.param = param
	flow.clear_stack = clear_stack
	return await _transition(flow)


## Async. Opens the last item of `requests` like `open_panel` and puts the items before it, never shown, below it.
static func open_panels(requests: Array[UIPanelRequest], clear_stack: bool = false) -> bool:
	if not _check_ready("open_panels") or not _check_transition("open_panels"):
		return false
	if requests.is_empty():
		LogCore.log_error(_TAG, "open_panels: the list is empty")
		return false
	for request: UIPanelRequest in requests:
		if request == null:
			LogCore.log_error(_TAG, "open_panels: an item is null")
			return false
	var last: UIPanelRequest = requests[requests.size() - 1]
	var flow: _FLOW = _FLOW.new()
	flow.kind = _FLOW.Kind.OPEN
	flow.panel_key = last.panel_key
	flow.param = last.param
	flow.clear_stack = clear_stack
	flow.before.assign(requests.slice(0, requests.size() - 1))
	return await _transition(flow)


## Async. Closes the current panel and returns to the item below it.
static func close_panel(force: bool = false) -> bool:
	if not _check_initialized("close_panel") or not _check_transition("close_panel"):
		return false
	if _current == null or _stack.is_empty() or _stack[_stack.size() - 1].root:
		LogCore.log_warn(_TAG, "close_panel: no current panel, or the current panel is the root item")
		return false
	var flow: _FLOW = _FLOW.new()
	flow.kind = _FLOW.Kind.CLOSE
	flow.force = force
	flow.destination = _stack.size() - 2
	flow.panel_key = _stack[flow.destination].key if flow.destination >= 0 else ""
	return await _transition(flow)


## Async. Closes panels down to the top item of `panel_key`.
static func close_panels_to(panel_key: String, force: bool = false) -> bool:
	if not _check_initialized("close_panels_to") or not _check_transition("close_panels_to"):
		return false
	var index: int = -1
	for i: int in range(_stack.size() - 1, -1, -1):
		if _stack[i].key == panel_key:
			index = i
			break
	if index < 0:
		LogCore.log_warn(_TAG, "close_panels_to: %s is not in the panel stack" % panel_key)
		return false
	if index == _stack.size() - 1:
		return true
	var flow: _FLOW = _FLOW.new()
	flow.kind = _FLOW.Kind.CLOSE
	flow.force = force
	flow.destination = index
	flow.panel_key = panel_key
	return await _transition(flow)


## Cancels the running panel transition, closes the current panel at once and empties the stack. Does not wait.
static func reset_panel_stack() -> void:
	if not _check_initialized("reset_panel_stack"):
		return
	var session: RefCounted = _session
	if _flow != null:
		_flow.cancel()
		if session != _session:
			return
	if _current != null:
		var view: _VIEW = _current
		_current = null
		_close_view_now(view, PanelCloseReason.CLOSED)
	_stack.clear()
	_refresh_panel_layer()


static func set_panel_lock(lock: bool) -> void:
	if not _check_initialized("set_panel_lock"):
		return
	_panel_lock = lock


static func get_current_panel_key() -> String:
	if not _check_initialized("get_current_panel_key"):
		return ""
	return _current.panel.panel_key if _current != null else ""


static func get_panel_stack() -> PackedStringArray:
	var keys: PackedStringArray = PackedStringArray()
	if not _check_initialized("get_panel_stack"):
		return keys
	for entry: _ENTRY in _stack:
		keys.append(entry.key)
	return keys


static func is_panel_transitioning() -> bool:
	if not _check_initialized("is_panel_transitioning"):
		return false
	return _flow != null


# --- Popups ---


## Async. Queues the open flow of `popup_key`. With `suppress` set and suppressed, ends with `SUPPRESSED` at once.
static func open_popup(
		popup_key: String, param: UIParam, hidden_callback: Callable, suppress: PopupSuppress = null
) -> PopupOpenResult:
	if not _check_ready("open_popup"):
		return PopupOpenResult.FAILED
	if _closing_all:
		LogCore.log_warn(_TAG, "open_popup: %s during close_all_popups" % popup_key)
		return PopupOpenResult.FAILED
	if suppress != null:
		if not _is_suppress_key(suppress.key):
			LogCore.log_error(_TAG, "open_popup: suppress key %s is not <owner>.<name>" % suppress.key)
			return PopupOpenResult.FAILED
		if suppress.mode != PopupSuppressMode.FOREVER and suppress.mode != PopupSuppressMode.TODAY:
			LogCore.log_error(_TAG, "open_popup: %d is not a PopupSuppressMode" % suppress.mode)
			return PopupOpenResult.FAILED
		if _is_suppressed(suppress.key):
			return PopupOpenResult.SUPPRESSED
	if _has_popup_key(popup_key):
		LogCore.log_warn(_TAG, "open_popup: %s is open, in its open flow or queued" % popup_key)
		return PopupOpenResult.FAILED
	var record: _POPUP = _POPUP.new()
	record.key = popup_key
	record.param = param
	record.suppress = suppress
	record.hidden_callback = hidden_callback
	_queue.append(record)
	_pump_popups()
	if not record.is_resolved:
		await record.resolved
	return record.result


static func suppress_popup(suppress_key: String, mode: PopupSuppressMode) -> void:
	if not _check_initialized("suppress_popup"):
		return
	if not _is_suppress_key(suppress_key):
		LogCore.log_error(_TAG, "suppress_popup: suppress key %s is not <owner>.<name>" % suppress_key)
		return
	if mode != PopupSuppressMode.FOREVER and mode != PopupSuppressMode.TODAY:
		LogCore.log_error(_TAG, "suppress_popup: %d is not a PopupSuppressMode" % mode)
		return
	if not LocalDataCore.is_loaded(LocalDataCore.FileKind.USER):
		return
	var until: int = -1
	if mode == PopupSuppressMode.TODAY:
		if not TimeCore.is_synced():
			LogCore.log_warn(_TAG, "suppress_popup: %s TODAY before the first time sync is not saved" % suppress_key)
			return
		until = TimeCore.get_next_day_boundary(TimeCore.get_current_day())
	var kept: PackedStringArray = PackedStringArray()
	for element: String in LocalDataCore.get_array_string(LocalDataCore.FileKind.USER, _SUPPRESS_KEY):
		var parsed: PackedStringArray = _parse_suppress(element)
		if parsed.is_empty() or parsed[0] == suppress_key:
			continue
		if _is_expired(parsed[1].to_int()):
			continue
		kept.append(element)
	kept.append("%s=%d" % [suppress_key, until])
	LocalDataCore.set_array_string(LocalDataCore.FileKind.USER, _SUPPRESS_KEY, kept)


static func is_popup_suppressed(suppress_key: String) -> bool:
	if not _check_initialized("is_popup_suppressed"):
		return false
	if not _is_suppress_key(suppress_key):
		LogCore.log_error(_TAG, "is_popup_suppressed: suppress key %s is not <owner>.<name>" % suppress_key)
		return false
	return _is_suppressed(suppress_key)


## Async. Opens a system popup at once, above every popup, and ends when its open flow ends. Its close is told only by
## `hidden_callback` and the button callbacks.
static func open_system_popup(param: SystemPopupParam, hidden_callback: Callable) -> bool:
	if not _check_ready("open_system_popup"):
		return false
	if _closing_all:
		LogCore.log_warn(_TAG, "open_system_popup: called during close_all_popups")
		return false
	if not _check_system_param(param):
		return false
	var session: RefCounted = _session
	var record: _POPUP = _POPUP.new()
	record.is_system = true
	record.system_param = param
	record.hidden_callback = hidden_callback
	record.key = ""
	record.open_block = InputBlockCore.block(_REASON)
	record.scope = ResourceCore.create_scope(
			ResourceCore.ScopeKind.POPUP, _system_popup_resource if not _system_popup_resource.is_empty()
			else _SYSTEM_POPUP_SCOPE)
	var instance: Control = _build_system_popup(record)
	record.instance = instance
	_instance_state[instance.get_instance_id()] = _SHOWN
	_system_root.add_child(instance)
	record.state = _POPUP.State.OPENING
	_shown_system.append(record)
	_refresh_popup_layer()
	if not record.open_tween.is_empty():
		record.tween_handle = TweenCore.play_preset(record.open_tween, record.scope, instance, _tween_options)
		var waiter: _WAITER = _WAITER.new()
		record.waiter = waiter
		waiter.start_tween(record.tween_handle)
		if not waiter.finished and not waiter.cancelled:
			await waiter.done
		if session != _session:
			return false
	if not record.open_finished:
		_finish_open(record)
	return record.open_finished


## Async. Closes an open popup: `on_closed`, close tween, destruction, hidden callback, `after_close`.
static func close_popup(popup: Control, after_close: Callable = Callable()) -> void:
	if not _check_initialized("close_popup"):
		return
	var record: _POPUP = _shown_record_of(popup)
	if record == null or (record.state != _POPUP.State.OPENING and record.state != _POPUP.State.OPEN):
		LogCore.log_warn(_TAG, "close_popup: not an open popup")
		return
	var session: RefCounted = _session
	if record.state == _POPUP.State.OPENING:
		TweenCore.stop(record.tween_handle)
		if session != _session:
			return
		if not record.open_finished:
			_finish_open(record)
	if record.state != _POPUP.State.OPEN:
		return
	record.state = _POPUP.State.CLOSING
	record.close_block = InputBlockCore.block(_REASON, null if record.is_system else _pass_list)
	if not record.is_system and not record.closed_called:
		record.closed_called = true
		(record.instance as UIPopup).on_closed()
		if session != _session or record.state != _POPUP.State.CLOSING:
			return
	if not record.close_tween.is_empty():
		record.tween_handle = TweenCore.play_preset(record.close_tween, record.scope, record.instance, _tween_options)
		var waiter: _WAITER = _WAITER.new()
		record.waiter = waiter
		waiter.start_tween(record.tween_handle)
		if not waiter.finished and not waiter.cancelled:
			await waiter.done
		if session != _session or record.state != _POPUP.State.CLOSING:
			return
	record.state = _POPUP.State.DONE
	_destroy_record(record)
	_lift_block(record.close_block)
	record.close_block = 0
	_call_callback(record.hidden_callback)
	if session != _session:
		return
	if not record.is_system and record.opened_event:
		_publish_closed(record.key, false, PanelCloseReason.CLOSED)
	_call_callback(after_close)


## Empties the queue, cancels open flows before they show and closes every popup at once. Does not wait.
static func close_all_popups() -> void:
	if not _check_initialized("close_all_popups"):
		return
	if _closing_all:
		return
	var session: RefCounted = _session
	_closing_all = true
	var queued: Array[_POPUP] = _queue.duplicate()
	_queue.clear()
	for record: _POPUP in queued:
		record.state = _POPUP.State.DONE
		record.resolve(PopupOpenResult.FAILED)
	if _open_record != null and _open_record.state == _POPUP.State.PREPARING:
		var preparing: _POPUP = _open_record
		_open_record = null
		_fail_open(preparing, false)
		if session != _session:
			return
	var opening: Array[_POPUP] = []
	for record: _POPUP in _shown_normal:
		if record.state == _POPUP.State.OPENING:
			opening.append(record)
	for record: _POPUP in _shown_system:
		if record.state == _POPUP.State.OPENING:
			opening.append(record)
	for record: _POPUP in opening:
		TweenCore.stop(record.tween_handle)
		if session != _session:
			return
		if not record.open_finished:
			_finish_open(record)
	while not _shown_system.is_empty() or not _shown_normal.is_empty():
		var top: _POPUP = _shown_system[_shown_system.size() - 1] if not _shown_system.is_empty() \
				else _shown_normal[_shown_normal.size() - 1]
		_close_record_now(top)
		if session != _session:
			return
	_closing_all = false
	_pump_popups()


static func get_open_popups() -> PackedStringArray:
	var keys: PackedStringArray = PackedStringArray()
	if not _check_initialized("get_open_popups"):
		return keys
	for record: _POPUP in _shown_normal:
		if record.state == _POPUP.State.OPENING or record.state == _POPUP.State.OPEN:
			keys.append(record.key)
	return keys


static func get_open_popup_count() -> int:
	if not _check_initialized("get_open_popup_count"):
		return 0
	return _shown_normal.size() + _shown_system.size()


static func is_system_popup_visible() -> bool:
	if not _check_initialized("is_system_popup_visible"):
		return false
	return not _shown_system.is_empty()


## A panel transition, a queued popup, a popup open flow or close, or a system popup open flow or close runs.
static func is_flow_in_progress() -> bool:
	if not _check_initialized("is_flow_in_progress"):
		return false
	if _flow != null or _open_record != null or not _queue.is_empty():
		return true
	for record: _POPUP in _shown_normal:
		if record.state == _POPUP.State.OPENING or record.state == _POPUP.State.CLOSING:
			return true
	for record: _POPUP in _shown_system:
		if record.state == _POPUP.State.OPENING or record.state == _POPUP.State.CLOSING:
			return true
	return false


## The pass list of the blocks UICore puts: the system popup root and the `back` action. Do not change it.
static func get_block_pass_list() -> BlockPassList:
	if not _check_initialized("get_block_pass_list"):
		return null
	return _pass_list


# --- Loading icon ---


static func show_loading_icon() -> int:
	if not _check_ready("show_loading_icon"):
		return 0
	_icon_serial += 1
	_icon_tokens[_icon_serial] = true
	_update_loading_icon()
	return _icon_serial


static func hide_loading_icon(token: int) -> void:
	if not _check_initialized("hide_loading_icon"):
		return
	if not _icon_tokens.has(token):
		LogCore.log_error(_TAG, "hide_loading_icon: token %d has no request" % token)
		return
	_icon_tokens.erase(token)
	_update_loading_icon()


# --- Anchors, modal cover, focus ---


static func get_anchor_rect(anchor_name: String, anchor_key: int = 0) -> AnchorResult:
	var result: AnchorResult = AnchorResult.new()
	if not _check_initialized("get_anchor_rect"):
		return result
	if anchor_key < 0:
		LogCore.log_error(_TAG, "get_anchor_rect: anchor key %d is below 1" % anchor_key)
		return result
	var best: Control = null
	var best_layer: int = -2
	for anchor: UIAnchor in _anchors:
		if not is_instance_valid(anchor) or not anchor.is_inside_tree():
			continue
		if anchor_key != 0 and anchor.anchor_key != anchor_key:
			continue
		if _anchor_name_of(anchor) != anchor_name:
			continue
		var element: Control = anchor.get_parent() as Control
		if element == null:
			continue
		result.found = true
		if not _is_element_visible(element):
			continue
		var layer: int = _layer_index_of(element)
		if best == null or layer > best_layer or (layer == best_layer and element.is_greater_than(best)):
			best = element
			best_layer = layer
	if best != null:
		result.visible = true
		result.element = best
		var rect: Rect2 = best.get_global_rect()
		var canvas: CanvasLayer = _canvas_layer_of(best)
		if canvas != null:
			rect.position += canvas.offset
		result.rect = rect
		var owner_instance: Control = _containing_instance(best)
		if owner_instance is UIPanel:
			result.owner = (owner_instance as UIPanel).panel_key
		elif owner_instance is UIPopup:
			result.owner = (owner_instance as UIPopup).popup_key
	return result


static func is_modal_covered(element: Control) -> bool:
	if not _check_initialized("is_modal_covered"):
		return false
	if element == null or not is_instance_valid(element) or not element.is_inside_tree():
		return false
	return _is_covered(element)


## Sets the focus elements of `view`: UI elements with a `UIButton`. An empty list clears the view focus.
static func set_view_focus(
		view: FocusView, elements: Array[Control], initial_focus: Control, accept_callback: Callable
) -> void:
	if not _check_initialized("set_view_focus"):
		return
	if view != FocusView.CUTSCENE and view != FocusView.TUTORIAL:
		LogCore.log_error(_TAG, "set_view_focus: %d is not a FocusView" % view)
		return
	var holder: _VIEW_FOCUS = _VIEW_FOCUS.new()
	for element: Control in elements:
		if element == null or not is_instance_valid(element) or not _has_ui_button(element):
			LogCore.log_error(_TAG, "set_view_focus: an element has no UIButton")
			continue
		holder.elements.append(element)
	if holder.elements.is_empty():
		holder = null
	else:
		holder.initial = initial_focus
		holder.accept = accept_callback
	if view == FocusView.TUTORIAL:
		_tutorial_view = holder
	else:
		_cutscene_view = holder
	_update_focus()


static func set_back_override(callback: Callable) -> void:
	if not _check_initialized("set_back_override"):
		return
	_back_override = callback


## Async. Opens the license screen from the game's license manifest and waits until it closes.
static func open_licenses() -> bool:
	if not _check_initialized("open_licenses"):
		return false
	if _licenses_open:
		LogCore.log_warn(_TAG, "open_licenses: the license screen is open")
		return false
	var text: String = _license_text()
	if text.is_empty():
		return false
	var session: RefCounted = _session
	var waiter: _WAITER = _WAITER.new()
	var param: SystemPopupParam = SystemPopupParam.new()
	param.body = ReservedString.ui_licenses_title()
	param.extra_text = text
	var close: SystemPopupButton = SystemPopupButton.new()
	close.label = ReservedString.ui_licenses_close()
	param.buttons.append(close)
	param.back_button = 0
	_licenses_open = true
	_licenses_waiter = waiter
	var opened: bool = await open_system_popup(param, waiter.fire)
	if session != _session:
		return false
	if not opened:
		_licenses_open = false
		_licenses_waiter = null
		return false
	if not waiter.finished and not waiter.cancelled:
		await waiter.done
	if session != _session:
		return false
	_licenses_open = false
	_licenses_waiter = null
	return true


# --- Internal: lifecycle ---


static func _check_initialized(operation: String) -> bool:
	if _is_initialized:
		return true
	LogCore.log_error(_TAG, operation + ": not initialized")
	return false


## Initialized, and `prepare` ended.
static func _check_ready(operation: String) -> bool:
	if not _check_initialized(operation):
		return false
	if not _prepared:
		LogCore.log_error(_TAG, operation + ": prepare has not ended")
		return false
	return true


static func _check_transition(operation: String) -> bool:
	# A new transition starts only after the ended one's finished event, so that event never sees a transition.
	var session: RefCounted = _session
	_publish_finished(_finished_flow)
	if session != _session:
		return false
	if _flow != null or _panel_lock:
		LogCore.log_warn(_TAG, operation + ": during a panel transition or the panel lock")
		return false
	return true


static func _read_settings() -> bool:
	var ints: PackedStringArray = ["UICore.buttonClickIntervalMs", "UICore.scrollLoadThresholdItems"]
	var floats: PackedStringArray = ["UICore.dimOpacity", "UICore.keyboardGap", "UICore.systemPopupScrollStep"]
	var strings: PackedStringArray = [
		"UICore.dimResource", "UICore.loadingIconResource", "UICore.systemPopupResource",
	]
	for key: String in ints:
		if not CoreSettings.has_int(key):
			LogCore.log_error(_TAG, "init: core settings key %s is missing or not an integer" % key)
			return false
	for key: String in floats:
		if not CoreSettings.has_float(key):
			LogCore.log_error(_TAG, "init: core settings key %s is missing or not a number" % key)
			return false
	for key: String in strings:
		if not CoreSettings.has_string(key):
			LogCore.log_error(_TAG, "init: core settings key %s is missing or not a string" % key)
			return false
	_click_interval_ms = CoreSettings.get_int("UICore.buttonClickIntervalMs")
	_scroll_load_threshold = CoreSettings.get_int("UICore.scrollLoadThresholdItems")
	_dim_opacity = CoreSettings.get_float("UICore.dimOpacity")
	_keyboard_gap = CoreSettings.get_float("UICore.keyboardGap")
	_system_popup_scroll_step = CoreSettings.get_float("UICore.systemPopupScrollStep")
	_dim_resource = CoreSettings.get_string("UICore.dimResource")
	_loading_icon_resource = CoreSettings.get_string("UICore.loadingIconResource")
	_system_popup_resource = CoreSettings.get_string("UICore.systemPopupResource")
	return true


static func _build_layers(node: Node) -> void:
	_layers.clear()
	for i: int in _LAYER_NAMES.size():
		var layer: CanvasLayer = CanvasLayer.new()
		layer.name = _LAYER_NAMES[i]
		layer.layer = _LAYER_BASE + i
		layer.process_mode = Node.PROCESS_MODE_ALWAYS
		node.add_child(layer)
		_layers.append(layer)
	_panel_root = _add_safe_area_root(_layers[UILayer.PANEL])
	_popup_root = _add_safe_area_root(_layers[UILayer.POPUP])
	_icon_root = _add_safe_area_root(_layers[UILayer.LOADING_ICON])
	_panel_blocker = _make_blocker()
	_panel_root.add_child(_panel_blocker)
	_panel_dim = _make_code_dim()
	_panel_root.add_child(_panel_dim)
	_popup_blocker = _make_blocker()
	_popup_root.add_child(_popup_blocker)
	_popup_dim = _make_code_dim()
	_popup_root.add_child(_popup_dim)
	_system_root = Control.new()
	_system_root.name = "SystemPopupRoot"
	_system_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_system_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_system_root.visible = false
	_popup_root.add_child(_system_root)
	_pass_list = BlockPassList.new()
	_pass_list.elements.append(_system_root)
	_pass_list.actions.append(_BACK_ACTION)
	_loading_icon = _make_code_icon()
	_loading_icon_code_made = true
	_icon_root.add_child(_loading_icon)


static func _add_safe_area_root(layer: CanvasLayer) -> Control:
	var safe_root: SafeAreaRoot = SafeAreaRoot.new()
	safe_root.name = "SafeAreaRoot"
	layer.add_child(safe_root)
	return safe_root


## A UI element that fills the visible game area, takes pointer input and shows nothing.
static func _make_blocker() -> Control:
	var blocker: Control = Control.new()
	blocker.name = "ModalBlocker"
	blocker.mouse_filter = Control.MOUSE_FILTER_STOP
	blocker.set_anchors_preset(Control.PRESET_FULL_RECT)
	blocker.add_child(SafeAreaIgnore.new())
	blocker.visible = false
	return blocker


## The code made black dim of `UICore.dimOpacity` over the visible game area. Takes no pointer input.
static func _make_code_dim() -> Control:
	var dim: ColorRect = ColorRect.new()
	dim.name = "Dim"
	dim.color = Color(0.0, 0.0, 0.0, _dim_opacity)
	dim.mouse_filter = Control.MOUSE_FILTER_IGNORE
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	dim.add_child(SafeAreaIgnore.new())
	dim.visible = false
	return dim


static func _make_dim_from(scene: PackedScene) -> Control:
	var dim: Control = scene.instantiate() as Control
	dim.name = "Dim"
	_ignore_pointer(dim)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	dim.add_child(SafeAreaIgnore.new())
	dim.visible = false
	return dim


## The code made loading icon: a square that turns in the middle of the safe area.
static func _make_code_icon() -> Control:
	var icon: ColorRect = ColorRect.new()
	icon.name = "LoadingIcon"
	icon.color = Color(1.0, 1.0, 1.0, 0.85)
	icon.mouse_filter = Control.MOUSE_FILTER_IGNORE
	icon.set_anchors_preset(Control.PRESET_CENTER)
	icon.offset_left = -_ICON_SIZE / 2.0
	icon.offset_top = -_ICON_SIZE / 2.0
	icon.offset_right = _ICON_SIZE / 2.0
	icon.offset_bottom = _ICON_SIZE / 2.0
	icon.pivot_offset = Vector2(_ICON_SIZE / 2.0, _ICON_SIZE / 2.0)
	icon.visible = false
	return icon


## Puts `replacement` where `old` is and frees `old`.
static func _replace_element(old: Control, replacement: Control) -> Control:
	var parent: Node = old.get_parent()
	if parent != null:
		var index: int = old.get_index()
		parent.remove_child(old)
		parent.add_child(replacement)
		parent.move_child(replacement, index)
	replacement.visible = old.visible
	old.queue_free()
	return replacement


static func _ignore_pointer(node: Node) -> void:
	var control: Control = node as Control
	if control != null:
		control.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for i: int in node.get_child_count():
		_ignore_pointer(node.get_child(i))


## Async. Loads a dim, loading icon or system popup prefab. `null` with an error log when it is the fallback resource
## or its root is not a UI element.
static func _load_ui_prefab(key: String, scope: Scope) -> PackedScene:
	var session: RefCounted = _session
	var waiter: _WAITER = _WAITER.new()
	_prepare_waiter = waiter
	waiter.start_load(key, ResourceCore.BaseKind.PACKED_SCENE, scope)
	if not waiter.finished and not waiter.cancelled:
		await waiter.done
	if session != _session:
		return null
	_prepare_waiter = null
	var scene: PackedScene = waiter.resource as PackedScene
	waiter.resource = null
	if scene == null or not ResourceCore.is_loaded(key, ResourceCore.BaseKind.PACKED_SCENE):
		LogCore.log_error(_TAG, "prepare: %s is the fallback resource" % key)
		return null
	var probe: Node = scene.instantiate()
	var is_ui: bool = probe is Control
	probe.free()
	if not is_ui:
		LogCore.log_error(_TAG, "prepare: the root of %s is not a UI element" % key)
		return null
	return scene


static func _on_node_exit() -> void:
	if _is_initialized:
		_end_state()


## Cancels every flow, empties the queue and frees what UICore made, without `on_closed`, hidden callbacks, button
## callbacks and events. The stopped operations end with their failure value.
static func _end_state() -> void:
	var node: Node = _node
	var flow: _FLOW = _flow
	var records: Array[_POPUP] = []
	records.append_array(_queue)
	if _open_record != null and _open_record.state == _POPUP.State.PREPARING:
		records.append(_open_record)
	records.append_array(_shown_normal)
	records.append_array(_shown_system)
	var waiters: Array[_WAITER] = []
	if _licenses_waiter != null:
		waiters.append(_licenses_waiter)
	if _prepare_waiter != null:
		waiters.append(_prepare_waiter)
	var views: Array[_VIEW] = []
	if _current != null:
		views.append(_current)
	if flow != null and flow.preparing != null:
		views.append(flow.preparing)
	if is_instance_valid(node):
		if EventCore.is_initialized():
			EventCore.unsubscribe_all(node)
		var root: Window = (Engine.get_main_loop() as SceneTree).root
		var core_node: _CORE_NODE = node as _CORE_NODE
		if root.gui_focus_changed.is_connected(core_node._on_focus_changed):
			root.gui_focus_changed.disconnect(core_node._on_focus_changed)
	if InputBlockCore.is_initialized():
		for record: _POPUP in records:
			if not record.open_finished:
				_lift_block(record.open_block)
			_lift_block(record.close_block)
		InputBlockCore.set_timer_hold(_REASON, false)
	if ResourceCore.is_initialized():
		for record: _POPUP in records:
			if record.scope != null and not record.scope.released:
				ResourceCore.release_scope(record.scope)
		for view: _VIEW in views:
			if view.scope != null and not view.scope.released:
				ResourceCore.release_scope(view.scope)
	_reset_statics()
	for waiter: _WAITER in waiters:
		waiter.cancel()
	if flow != null:
		flow.cancel()
	for record: _POPUP in records:
		record.state = _POPUP.State.DONE
		if record.waiter != null:
			record.waiter.cancel()
		record.resolve(PopupOpenResult.FAILED)


static func _reset_statics() -> void:
	_is_initialized = false
	_session = null
	_node = null
	_prepared = false
	_preparing = false
	_click_interval_ms = 0
	_dim_resource = ""
	_dim_opacity = 0.0
	_loading_icon_resource = ""
	_system_popup_resource = ""
	_scroll_load_threshold = 0
	_keyboard_gap = 0.0
	_system_popup_scroll_step = 0.0
	_layers = []
	_panel_root = null
	_popup_root = null
	_icon_root = null
	_system_root = null
	_pass_list = null
	_panel_dim = null
	_panel_blocker = null
	_popup_dim = null
	_popup_blocker = null
	_loading_icon = null
	_loading_icon_code_made = false
	_system_popup_scene = null
	_tween_options = null
	_instance_state = {}
	_stack = []
	_current = null
	_flow = null
	_finished_flow = null
	_finished_ok = false
	_panel_lock = false
	_make_failed_not_panel = false
	_queue = []
	_open_record = null
	_shown_normal = []
	_shown_system = []
	_closing_all = false
	_icon_tokens = {}
	_icon_serial = 0
	_back_override = Callable()
	_licenses_open = false
	_licenses_waiter = null
	_prepare_waiter = null
	_licenses_path = _LICENSES_PATH
	_tutorial_view = null
	_cutscene_view = null
	_key_focus_mode = false
	_focus_delay_frame = 0
	_accept_frame = -1
	_accept_last = null
	_accept_first = null
	_accept_presses.clear()
	_accept_held.clear()
	_update_focus_callable = Callable()
	_clear_view_move()
	_text_input = null
	_shift_target = null
	_shift_distance = 0.0
	_has_click = false
	_last_click_ms = 0
	_action_buttons = []
	_pending_clicks = []
	_anchors = []


# --- Internal: panel transitions ---


## Async. Runs `flow` under the `ui` block, then publishes its events.
static func _transition(flow: _FLOW) -> bool:
	var session: RefCounted = _session
	_flow = flow
	# The core node owns the block: an owner from a `RefCounted` operation has a negative instance ID.
	var ok: bool = await InputBlockCore.run_blocked(_REASON, flow.run, _pass_list, _node)
	if session != _session:
		return false
	if _flow == flow:
		_flow = null
	_finished_flow = flow
	_finished_ok = ok
	var shown: _VIEW = flow.shown
	if shown != null and not shown.opened_event and shown == _current:
		shown.opened_event = true
		_publish_opened(shown.panel.panel_key, true, flow.shown_reason)
		if session != _session:
			return false
	_publish_finished(flow)
	return ok


## Publishes the `PanelFlowFinishedEvent` of `flow` if it is the pending one. A transition that a `UIOpenedEvent`
## subscriber starts publishes it first, from `_check_transition`.
static func _publish_finished(flow: _FLOW) -> void:
	if flow == null or flow != _finished_flow:
		return
	_finished_flow = null
	var finished: PanelFlowFinishedEvent = EventCore.acquire(PanelFlowFinishedEvent) as PanelFlowFinishedEvent
	finished.panel_key = flow.panel_key
	finished.is_open = flow.kind == _FLOW.Kind.OPEN
	finished.success = _finished_ok
	EventCore.publish(finished)


## Async. The body of a panel transition, called by `_FLOW.run` under the block.
static func _run_flow(flow: _FLOW) -> bool:
	if flow.kind == _FLOW.Kind.OPEN:
		return await _open_flow(flow)
	return await _close_flow(flow)


## Whether `flow` stopped: cancelled or UICore released. A cancelled flow destroys the instance it prepares.
static func _flow_stopped(flow: _FLOW, session: RefCounted) -> bool:
	if session != _session:
		return true
	if not flow.cancelled:
		return false
	if flow.preparing != null:
		_destroy_view(flow.preparing)
		flow.preparing = null
	return true


static func _open_flow(flow: _FLOW) -> bool:
	var session: RefCounted = _session
	var view: _VIEW = await _make_view(flow, flow.panel_key, flow.param, null, false)
	if _flow_stopped(flow, session) or view == null:
		return false
	if not view.panel.accepts_param(flow.param):
		LogCore.log_error(_TAG, "open panel: %s does not take its param" % flow.panel_key)
		_drop_preparing(flow)
		return false
	if _flow_stopped(flow, session):
		return false
	var prepared: bool = await _prepare_view(flow, view, PanelOpenReason.NEW, null)
	if _flow_stopped(flow, session):
		return false
	if not prepared:
		_drop_preparing(flow)
		return false
	var replaced_root: int = -1
	if _current != null:
		var current: _VIEW = _current
		var top: _ENTRY = _stack[_stack.size() - 1]
		if current.panel.panel_key == flow.panel_key:
			replaced_root = 1 if top.root else 0
			_current = null
			_close_view_now(current, PanelCloseReason.CLOSED)
			_stack.remove_at(_stack.size() - 1)
		elif not flow.clear_stack or top.root:
			_current = null
			if not current.closed_called:
				current.closed_called = true
				current.panel.on_closed(PanelCloseReason.COVERED)
			if session != _session:
				return false
			top.cache = current.panel.cache
			_destroy_view(current)
			if current.opened_event:
				_publish_closed(top.key, true, PanelCloseReason.COVERED)
		else:
			_current = null
			_close_view_now(current, PanelCloseReason.CLOSED)
			var keep: int = 1 if not _stack.is_empty() and _stack[0].root else 0
			_stack.resize(keep)
		if session != _session:
			return false
	elif flow.clear_stack:
		var kept: int = 1 if not _stack.is_empty() and _stack[0].root else 0
		_stack.resize(kept)
	if not (replaced_root == 1 and not flow.before.is_empty()):
		for request: UIPanelRequest in flow.before:
			var hidden_entry: _ENTRY = _ENTRY.new()
			hidden_entry.key = request.panel_key
			hidden_entry.param = request.param
			_stack.append(hidden_entry)
	var entry: _ENTRY = _ENTRY.new()
	entry.key = flow.panel_key
	entry.param = flow.param
	entry.cache = view.panel.cache
	entry.shown = true
	entry.root = flow.root or replaced_root == 1
	_stack.append(entry)
	_show_view(flow, view, entry, PanelOpenReason.NEW)
	if _flow_stopped(flow, session):
		return false
	if not view.panel.open_tween.is_empty():
		var handle: int = TweenCore.play_preset(view.panel.open_tween, view.scope, view.panel, _tween_options)
		var waiter: _WAITER = _WAITER.new()
		flow.waiter = waiter
		waiter.start_tween(handle)
		if not waiter.finished and not waiter.cancelled:
			await waiter.done
		flow.waiter = null
		if _flow_stopped(flow, session):
			return false
	return true


static func _close_flow(flow: _FLOW) -> bool:
	var session: RefCounted = _session
	var current: _VIEW = _current
	if current == null:
		return false
	var destination: int = flow.destination
	var shown: _VIEW = null
	while destination >= 0:
		var entry: _ENTRY = _stack[destination]
		var cache: UIPanelCache = entry.cache if entry.shown else null
		var view: _VIEW = await _make_view(flow, entry.key, entry.param, cache, true)
		if _flow_stopped(flow, session):
			return false
		if view == null and flow.preparing == null and _make_failed_not_panel:
			_make_failed_not_panel = false
			destination -= 1
			continue
		var ok: bool = false
		if view != null:
			if not view.panel.accepts_param(entry.param):
				LogCore.log_error(_TAG, "close flow: %s does not take its param" % entry.key)
			else:
				ok = await _prepare_view(flow, view, PanelOpenReason.RETURNED, cache)
				if _flow_stopped(flow, session):
					return false
		if ok:
			shown = view
			break
		if not flow.force:
			_drop_preparing(flow)
			return false
		if entry.root and view != null:
			LogCore.log_error(_TAG, "close flow: the root item %s did not prepare; shown anyway" % entry.key)
			shown = view
			break
		_drop_preparing(flow)
		destination -= 1
	current.closed_called = true
	current.panel.on_closed(PanelCloseReason.CLOSED)
	if _flow_stopped(flow, session):
		return false
	if not current.panel.close_tween.is_empty():
		var handle: int = TweenCore.play_preset(current.panel.close_tween, current.scope, current.panel, _tween_options)
		var waiter: _WAITER = _WAITER.new()
		flow.waiter = waiter
		waiter.start_tween(handle)
		if not waiter.finished and not waiter.cancelled:
			await waiter.done
		flow.waiter = null
		if _flow_stopped(flow, session):
			return false
	_current = null
	var closed_key: String = current.panel.panel_key
	_destroy_view(current)
	_stack.resize(maxi(destination + 1, 0))
	if current.opened_event:
		_publish_closed(closed_key, true, PanelCloseReason.CLOSED)
		if _flow_stopped(flow, session):
			return false
	if shown != null:
		var shown_entry: _ENTRY = _stack[destination]
		shown_entry.shown = true
		_show_view(flow, shown, shown_entry, PanelOpenReason.RETURNED)
		if _flow_stopped(flow, session):
			return false
	else:
		_refresh_panel_layer()
	return true


## Async. Makes an invisible panel instance of `key` with `param` and `cache` in a new panel scope. `below` puts it
## under the current panel. `null` when it failed or `flow` stopped.
static func _make_view(flow: _FLOW, key: String, param: UIParam, cache: UIPanelCache, below: bool) -> _VIEW:
	var session: RefCounted = _session
	_make_failed_not_panel = false
	var scope: Scope = ResourceCore.create_scope(ResourceCore.ScopeKind.PANEL, key)
	var waiter: _WAITER = _WAITER.new()
	flow.waiter = waiter
	waiter.start_load(key, ResourceCore.BaseKind.PACKED_SCENE, scope)
	if not waiter.finished and not waiter.cancelled:
		await waiter.done
	flow.waiter = null
	if session != _session:
		return null
	var scene: PackedScene = waiter.resource as PackedScene
	waiter.resource = null
	if flow.cancelled or scene == null or not ResourceCore.is_loaded(key, ResourceCore.BaseKind.PACKED_SCENE):
		if not scope.released:
			ResourceCore.release_scope(scope)
		return null
	var node: Node = scene.instantiate()
	scene = null
	var panel: UIPanel = node as UIPanel
	if panel == null:
		LogCore.log_error(_TAG, "panel: the prefab root of %s is not a UIPanel" % key)
		node.free()
		ResourceCore.release_scope(scope)
		_make_failed_not_panel = true
		return null
	panel.panel_key = key
	panel.panel_param = param
	panel.scope = scope
	panel.cache = cache
	panel.visible = false
	var view: _VIEW = _VIEW.new()
	view.instance = panel
	view.panel = panel
	view.scope = scope
	flow.preparing = view
	_instance_state[panel.get_instance_id()] = _PREPARING
	_panel_root.add_child(panel)
	if below and _current != null and is_instance_valid(_current.panel):
		_panel_root.move_child(panel, _current.panel.get_index())
	return view


## Async. Calls `prepare` of the panel instance and waits for it, unless `flow` is cancelled first.
static func _prepare_view(flow: _FLOW, view: _VIEW, reason: PanelOpenReason, cache: UIPanelCache) -> bool:
	var waiter: _WAITER = _WAITER.new()
	flow.waiter = waiter
	waiter.start_bool(view.panel.prepare.bind(reason, cache))
	if not waiter.finished and not waiter.cancelled:
		await waiter.done
	flow.waiter = null
	return waiter.ok and not waiter.cancelled


## Destroys the instance `flow` prepares.
static func _drop_preparing(flow: _FLOW) -> void:
	if flow.preparing != null:
		_destroy_view(flow.preparing)
		flow.preparing = null


static func _show_view(flow: _FLOW, view: _VIEW, entry: _ENTRY, reason: PanelOpenReason) -> void:
	flow.preparing = null
	view.entry = entry
	_current = view
	_instance_state[view.panel.get_instance_id()] = _SHOWN
	view.panel.visible = true
	_refresh_panel_layer()
	flow.shown = view
	flow.shown_reason = reason
	view.panel.on_opened(reason)


## `on_closed(reason)` unless it was called, then destroys the instance and publishes `UIClosedEvent`.
static func _close_view_now(view: _VIEW, reason: PanelCloseReason) -> void:
	var session: RefCounted = _session
	if not view.closed_called:
		view.closed_called = true
		view.panel.on_closed(reason)
		if session != _session:
			return
	var key: String = view.panel.panel_key
	_destroy_view(view)
	if view.opened_event:
		_publish_closed(key, true, reason)


## Destroys a panel instance and then releases its scope.
static func _destroy_view(view: _VIEW) -> void:
	var panel: UIPanel = view.panel
	if is_instance_valid(panel):
		_instance_state.erase(panel.get_instance_id())
		_destroy_node(panel)
	if view.scope != null and not view.scope.released:
		ResourceCore.release_scope(view.scope)
	if view == _current:
		_current = null
	_refresh_panel_layer()


## Takes a panel or popup instance out of the tree and frees it at the frame end. It is not visible and takes no
## input from now on.
static func _destroy_node(node: Control) -> void:
	node.visible = false
	var parent: Node = node.get_parent()
	if parent != null:
		parent.remove_child(node)
	node.queue_free()
	if _shift_target == node:
		_shift_target = null
		_shift_distance = 0.0
		_update_keyboard_shift()


## Puts the panel blocker and dim right below the current panel when it is shown and modal or dim.
static func _refresh_panel_layer() -> void:
	if _panel_blocker == null:
		return
	_panel_blocker.visible = false
	_panel_dim.visible = false
	if _current == null or not is_instance_valid(_current.panel) or not _current.panel.visible:
		return
	var panel: UIPanel = _current.panel
	if panel.modal:
		_place_below(_panel_blocker, panel)
		_panel_blocker.visible = true
	if panel.dim:
		_place_below(_panel_dim, panel)
		_panel_dim.visible = true


## Moves `node` right below `target` among the children of the parent of `target`.
static func _place_below(node: Control, target: Control) -> void:
	var parent: Node = target.get_parent()
	if parent == null:
		return
	if node.get_parent() != parent:
		if node.get_parent() != null:
			node.get_parent().remove_child(node)
		parent.add_child(node)
	var target_index: int = target.get_index()
	if node.get_index() < target_index:
		parent.move_child(node, target_index - 1)
	else:
		parent.move_child(node, target_index)


static func _publish_opened(key: String, is_panel: bool, reason: PanelOpenReason) -> void:
	var event: UIOpenedEvent = EventCore.acquire(UIOpenedEvent) as UIOpenedEvent
	event.key = key
	event.is_panel = is_panel
	event.reason = reason
	EventCore.publish(event)


static func _publish_closed(key: String, is_panel: bool, reason: PanelCloseReason) -> void:
	var event: UIClosedEvent = EventCore.acquire(UIClosedEvent) as UIClosedEvent
	event.key = key
	event.is_panel = is_panel
	event.reason = reason
	EventCore.publish(event)


# --- Internal: popups ---


static func _has_popup_key(key: String) -> bool:
	if _open_record != null and _open_record.key == key:
		return true
	for record: _POPUP in _queue:
		if record.key == key:
			return true
	for record: _POPUP in _shown_normal:
		if record.key == key and (record.state == _POPUP.State.OPENING or record.state == _POPUP.State.OPEN):
			return true
	return false


## Starts the open flow of the next queued popup when no open flow runs.
static func _pump_popups() -> void:
	if not _is_initialized or _open_record != null or _closing_all or _queue.is_empty():
		return
	var record: _POPUP = _queue[0]
	_queue.remove_at(0)
	_open_record = record
	_popup_open_flow(record)


## Async. The open flow of a normal popup: block, scope and instance, `accepts_param`, `prepare`, show on top and
## `on_opened`, open tween, block lift.
static func _popup_open_flow(record: _POPUP) -> void:
	var session: RefCounted = _session
	record.state = _POPUP.State.PREPARING
	record.open_block = InputBlockCore.block(_REASON, _pass_list)
	record.scope = ResourceCore.create_scope(ResourceCore.ScopeKind.POPUP, record.key)
	var waiter: _WAITER = _WAITER.new()
	record.waiter = waiter
	waiter.start_load(record.key, ResourceCore.BaseKind.PACKED_SCENE, record.scope)
	if not waiter.finished and not waiter.cancelled:
		await waiter.done
	record.waiter = null
	if session != _session or record.state != _POPUP.State.PREPARING:
		return
	var scene: PackedScene = waiter.resource as PackedScene
	waiter.resource = null
	if scene == null or not ResourceCore.is_loaded(record.key, ResourceCore.BaseKind.PACKED_SCENE):
		_fail_open(record, true)
		return
	var node: Node = scene.instantiate()
	scene = null
	var popup: UIPopup = node as UIPopup
	if popup == null:
		LogCore.log_error(_TAG, "open_popup: the prefab root of %s is not a UIPopup" % record.key)
		node.free()
		_fail_open(record, true)
		return
	popup.popup_key = record.key
	popup.popup_param = record.param
	popup.scope = record.scope
	popup.popup_suppress = record.suppress
	popup.visible = false
	record.instance = popup
	record.modal = popup.modal
	record.dim = popup.dim
	record.back_policy = popup.back_policy
	record.open_tween = popup.open_tween
	record.close_tween = popup.close_tween
	record.initial_focus = popup.initial_focus
	_instance_state[popup.get_instance_id()] = _PREPARING
	_place_below(popup, _system_root)
	if not popup.accepts_param(record.param):
		LogCore.log_error(_TAG, "open_popup: %s does not take its param" % record.key)
		_fail_open(record, true)
		return
	if session != _session or record.state != _POPUP.State.PREPARING:
		return
	var prepare_waiter: _WAITER = _WAITER.new()
	record.waiter = prepare_waiter
	prepare_waiter.start_bool(popup.prepare)
	if not prepare_waiter.finished and not prepare_waiter.cancelled:
		await prepare_waiter.done
	record.waiter = null
	if session != _session or record.state != _POPUP.State.PREPARING:
		return
	if not prepare_waiter.ok:
		_fail_open(record, true)
		return
	_place_below(popup, _system_root)
	_instance_state[popup.get_instance_id()] = _SHOWN
	popup.visible = true
	record.state = _POPUP.State.OPENING
	_shown_normal.append(record)
	_refresh_popup_layer()
	popup.on_opened()
	if session != _session or record.state != _POPUP.State.OPENING:
		return
	if not record.open_tween.is_empty():
		record.tween_handle = TweenCore.play_preset(record.open_tween, record.scope, popup, _tween_options)
		var tween_waiter: _WAITER = _WAITER.new()
		record.waiter = tween_waiter
		tween_waiter.start_tween(record.tween_handle)
		if not tween_waiter.finished and not tween_waiter.cancelled:
			await tween_waiter.done
		record.waiter = null
		if session != _session:
			return
	if not record.open_finished:
		_finish_open(record)


## Ends the open flow of a shown popup: block lift, `UIOpenedEvent` and the result. Then the next queued popup.
static func _finish_open(record: _POPUP) -> void:
	var session: RefCounted = _session
	record.open_finished = true
	if record.state == _POPUP.State.OPENING:
		record.state = _POPUP.State.OPEN
	_lift_block(record.open_block)
	record.open_block = 0
	if not record.is_system:
		record.opened_event = true
		_publish_opened(record.key, false, PanelOpenReason.NEW)
		if session != _session:
			return
	if _open_record == record:
		_open_record = null
	record.resolve(PopupOpenResult.OPENED)
	if session != _session:
		return
	_pump_popups()


## Ends an open flow that failed or was cancelled before the popup showed: no hidden callback.
static func _fail_open(record: _POPUP, pump: bool) -> void:
	record.state = _POPUP.State.DONE
	if record.waiter != null:
		var waiter: _WAITER = record.waiter
		record.waiter = null
		waiter.cancel()
	if record.instance != null and is_instance_valid(record.instance):
		_instance_state.erase(record.instance.get_instance_id())
		_destroy_node(record.instance)
	if record.scope != null and not record.scope.released:
		ResourceCore.release_scope(record.scope)
	_lift_block(record.open_block)
	record.open_block = 0
	if _open_record == record:
		_open_record = null
	record.resolve(PopupOpenResult.FAILED)
	if pump:
		_pump_popups()


## Closes a shown popup at once for `close_all_popups`: tween stop, `on_closed` if it had none, destruction, hidden
## callback, `UIClosedEvent`. A running `close_popup` of it ends without its after-close callback.
static func _close_record_now(record: _POPUP) -> void:
	var session: RefCounted = _session
	var was_closing: bool = record.state == _POPUP.State.CLOSING
	record.state = _POPUP.State.DONE
	if record.waiter != null:
		var waiter: _WAITER = record.waiter
		record.waiter = null
		waiter.cancel()
	if was_closing:
		TweenCore.stop(record.tween_handle)
	if not record.is_system and not record.closed_called:
		record.closed_called = true
		(record.instance as UIPopup).on_closed()
		if session != _session:
			return
	_destroy_record(record)
	_lift_block(record.close_block)
	record.close_block = 0
	_call_callback(record.hidden_callback)
	if session != _session:
		return
	if not record.is_system and record.opened_event:
		_publish_closed(record.key, false, PanelCloseReason.CLOSED)


## Lifts a popup block UICore put. A block that `release_all`, forced release or owner destruction lifted first is not
## active and is left alone.
static func _lift_block(token: int) -> void:
	if token != 0 and InputBlockCore.is_active(token):
		InputBlockCore.unblock(token)


## Takes a shown popup off the screen: destroys its instance and then releases its scope.
static func _destroy_record(record: _POPUP) -> void:
	_shown_normal.erase(record)
	_shown_system.erase(record)
	if record.instance != null and is_instance_valid(record.instance):
		_instance_state.erase(record.instance.get_instance_id())
		_destroy_node(record.instance)
	if record.scope != null and not record.scope.released:
		ResourceCore.release_scope(record.scope)
	_refresh_popup_layer()


static func _shown_record_of(popup: Control) -> _POPUP:
	if popup == null:
		return null
	for record: _POPUP in _shown_normal:
		if record.instance == popup:
			return record
	for record: _POPUP in _shown_system:
		if record.instance == popup:
			return record
	return null


## Puts the popup blocker below the top modal popup and the popup dim below the top dim popup, shows the system popup
## root while a system popup shows and holds the `ui` block timer meanwhile.
static func _refresh_popup_layer() -> void:
	if _popup_blocker == null:
		return
	var modal_top: _POPUP = null
	var dim_top: _POPUP = null
	for i: int in range(_shown_system.size() - 1, -1, -1):
		var record: _POPUP = _shown_system[i]
		if modal_top == null and record.modal:
			modal_top = record
		if dim_top == null and record.dim:
			dim_top = record
	for i: int in range(_shown_normal.size() - 1, -1, -1):
		var record: _POPUP = _shown_normal[i]
		if modal_top == null and record.modal:
			modal_top = record
		if dim_top == null and record.dim:
			dim_top = record
	_popup_blocker.visible = false
	_popup_dim.visible = false
	if modal_top != null and is_instance_valid(modal_top.instance):
		_place_below(_popup_blocker, modal_top.instance)
		_popup_blocker.visible = true
	if dim_top != null and is_instance_valid(dim_top.instance):
		_place_below(_popup_dim, dim_top.instance)
		_popup_dim.visible = true
	var system_visible: bool = not _shown_system.is_empty()
	if _system_root.visible != system_visible:
		_system_root.visible = system_visible
		InputBlockCore.set_timer_hold(_REASON, system_visible)


static func _check_system_param(param: SystemPopupParam) -> bool:
	var problem: String = ""
	if param == null:
		problem = "the param is null"
	elif param.buttons.is_empty() or param.buttons.size() > 3:
		problem = "%d buttons" % param.buttons.size()
	elif param.back_button < -1 or param.back_button >= param.buttons.size():
		problem = "back button index %d is outside the buttons" % param.back_button
	elif param.body.is_empty():
		problem = "no body translation key"
	else:
		for button: SystemPopupButton in param.buttons:
			if button == null or button.label.is_empty():
				problem = "a button has no label translation key"
				break
	if problem.is_empty():
		return true
	LogCore.log_error(_TAG, "open_system_popup: " + problem)
	return false


## Makes the system popup instance: the system popup prefab or a code made frame, with the code made content in it.
static func _build_system_popup(record: _POPUP) -> Control:
	var param: SystemPopupParam = record.system_param
	var frame: Control = null
	if _system_popup_scene != null:
		frame = _system_popup_scene.instantiate() as Control
	if frame == null:
		var panel: Panel = Panel.new()
		panel.anchor_left = _SYSTEM_POPUP_ANCHORS.x
		panel.anchor_top = _SYSTEM_POPUP_ANCHORS.y
		panel.anchor_right = _SYSTEM_POPUP_ANCHORS.z
		panel.anchor_bottom = _SYSTEM_POPUP_ANCHORS.w
		panel.mouse_filter = Control.MOUSE_FILTER_STOP
		frame = panel
		record.dim = true
	else:
		var prefab_popup: UIPopup = frame as UIPopup
		if prefab_popup != null:
			record.dim = prefab_popup.dim
			record.open_tween = prefab_popup.open_tween
			record.close_tween = prefab_popup.close_tween
	frame.name = "SystemPopup"
	record.modal = true
	var body: String = ""
	if param.format_args != null:
		body = LocalizationCore.format(param.body, param.format_args)
	else:
		body = LocalizationCore.get_text(param.body)
	var labels: PackedStringArray = PackedStringArray()
	for button: SystemPopupButton in param.buttons:
		labels.append(LocalizationCore.get_text(button.label))
	var content: Control = _SYSTEM_VIEW.new()
	(content as _SYSTEM_VIEW).build(frame, body, param.extra_text, labels)
	frame.add_child(content)
	record.system_view = content
	return frame


## A system popup button was clicked: closes the popup with that button's callback as the after-close callback.
static func _on_system_button(popup: Control, index: int) -> void:
	var record: _POPUP = _shown_record_of(popup)
	if record == null or not record.is_system:
		return
	var buttons: Array[SystemPopupButton] = record.system_param.buttons
	if index < 0 or index >= buttons.size():
		return
	close_popup(popup, buttons[index].callback)


## Back input on a system popup presses its back button; without one it does nothing.
static func _system_back(record: _POPUP) -> void:
	var index: int = record.system_param.back_button
	var view: _SYSTEM_VIEW = record.system_view as _SYSTEM_VIEW
	if index < 0 or view == null or index >= view.buttons.size():
		return
	var button: Button = view.buttons[index]
	for i: int in button.get_child_count():
		var ui_button: UIButton = button.get_child(i) as UIButton
		if ui_button != null:
			_on_button_pressed(ui_button)
			return


static func _call_callback(callback: Callable) -> void:
	if callback.is_null():
		return
	if not callback.is_valid():
		LogCore.log_error(_TAG, "a callback cannot be called")
		return
	callback.call()


# --- Internal: popup suppression ---


static func _is_suppress_key(key: String) -> bool:
	var parts: PackedStringArray = key.split(".")
	return parts.size() == 2 and not parts[0].is_empty() and _is_snake_case(parts[1])


## snake_case: lowercase letters, digits and single underscores between them, starting with a letter.
static func _is_snake_case(text: String) -> bool:
	if text.is_empty() or text[0] < "a" or text[0] > "z" or text.ends_with("_") or text.contains("__"):
		return false
	for i: int in text.length():
		var c: String = text[i]
		if not ((c >= "a" and c <= "z") or (c >= "0" and c <= "9") or c == "_"):
			return false
	return true


## `[suppress key, until]` of a well formed element, or an empty array.
static func _parse_suppress(element: String) -> PackedStringArray:
	var parts: PackedStringArray = element.split("=")
	if parts.size() != 2 or not _is_suppress_key(parts[0]) or not parts[1].is_valid_int():
		return PackedStringArray()
	return parts


static func _is_suppressed(key: String) -> bool:
	if not LocalDataCore.is_loaded(LocalDataCore.FileKind.USER):
		return false
	for element: String in LocalDataCore.get_array_string(LocalDataCore.FileKind.USER, _SUPPRESS_KEY):
		var parsed: PackedStringArray = _parse_suppress(element)
		if parsed.is_empty() or parsed[0] != key:
			continue
		if not _is_expired(parsed[1].to_int()):
			return true
	return false


## Whether the until of a suppression element was reached. Before the first time sync nothing is reached.
static func _is_expired(until: int) -> bool:
	return until != -1 and TimeCore.is_synced() and TimeCore.is_reached(until)


# --- Internal: license screen ---


## The extra text of the license screen, or an empty string with an error log when the manifest cannot be read.
# ogw:input_boundary
static func _license_text() -> String:
	if not FileAccess.file_exists(_licenses_path):
		LogCore.log_error(_TAG, "open_licenses: no license manifest")
		return ""
	var bytes: PackedByteArray = FileAccess.get_file_as_bytes(_licenses_path)
	if bytes.is_empty() or bytes.size() > _LICENSES_MAX_BYTES:
		LogCore.log_error(_TAG, "open_licenses: the license manifest cannot be read")
		return ""
	var parsed: Variant = JSON.parse_string(bytes.get_string_from_utf8())
	if not (parsed is Dictionary):
		LogCore.log_error(_TAG, "open_licenses: the license manifest is not a JSON object")
		return ""
	var manifest: Dictionary = parsed
	var components: Variant = manifest.get("components")
	var texts: Variant = manifest.get("texts")
	if not (components is Array) or not (texts is Dictionary):
		LogCore.log_error(_TAG, "open_licenses: the license manifest has no components or texts")
		return ""
	var text_map: Dictionary = texts
	for id: Variant in text_map:
		if not (id is String) or not (text_map[id] is String):
			LogCore.log_error(_TAG, "open_licenses: a license text is not a string")
			return ""
	var lines: PackedStringArray = PackedStringArray()
	var ids: PackedStringArray = PackedStringArray()
	var platform: String = CoreBuildInfo.platform
	for item: Variant in components:
		if not (item is Dictionary):
			LogCore.log_error(_TAG, "open_licenses: a component is not an object")
			return ""
		var component: Dictionary = item
		for field: String in ["name", "version", "license", "url", "notice"]:
			if not (component.get(field) is String):
				LogCore.log_error(_TAG, "open_licenses: component field %s is not a string" % field)
				return ""
		var platforms: Variant = component.get("platforms")
		if not (platforms is Array) or not (component.get("modules") is Array):
			LogCore.log_error(_TAG, "open_licenses: component platforms or modules is not an array")
			return ""
		var platform_list: Array = platforms
		var included: bool = false
		for value: Variant in platform_list:
			var platform_name: String = value if value is String else ""
			if not _LICENSE_PLATFORMS.has(platform_name):
				LogCore.log_error(_TAG, "open_licenses: a component platform is not a platform")
				return ""
			if platform_name == platform:
				included = true
		if not included:
			continue
		var component_name: String = component["name"]
		var version: String = component["version"]
		var license: String = component["license"]
		var url: String = component["url"]
		var notice: String = component["notice"]
		var head: String = component_name if version.is_empty() else component_name + " " + version
		for line: String in [head, license, url, notice]:
			if not line.is_empty():
				lines.append(line)
		lines.append("")
		for id: String in _license_ids(license):
			if text_map.has(id) and not ids.has(id):
				ids.append(id)
	for id: String in ids:
		var full_text: String = text_map[id]
		lines.append(id)
		lines.append(full_text)
		lines.append("")
	return "\n".join(lines)


## The license and exception IDs in an SPDX license expression, in order.
static func _license_ids(expression: String) -> PackedStringArray:
	var ids: PackedStringArray = PackedStringArray()
	for token: String in expression.replace("(", " ").replace(")", " ").split(" ", false):
		if token == "AND" or token == "OR" or token == "WITH":
			continue
		ids.append(token)
	return ids


# --- Internal: back input ---


## The back handler `InputCore` calls for every back input. Returns whether the input was consumed.
static func _handle_back() -> bool:
	if not _is_initialized or not _prepared:
		return false
	for record: _POPUP in _shown_system:
		if record.state == _POPUP.State.OPENING or record.state == _POPUP.State.CLOSING:
			return true
	if not _shown_system.is_empty():
		_system_back(_shown_system[_shown_system.size() - 1])
		return true
	if not _back_override.is_null():
		_call_callback(_back_override)
		return true
	if _flow != null or _open_record != null:
		return true
	for record: _POPUP in _shown_normal:
		if record.state == _POPUP.State.OPENING or record.state == _POPUP.State.CLOSING:
			return true
	if not _shown_normal.is_empty():
		var top: _POPUP = _shown_normal[_shown_normal.size() - 1]
		match top.back_policy:
			BackPolicy.CLOSE:
				close_popup(top.instance)
			BackPolicy.CUSTOM:
				(top.instance as UIPopup).on_back()
		return true
	if _current != null:
		var panel: UIPanel = _current.panel
		var is_root: bool = _current.entry != null and _current.entry.root
		if not (is_root and panel.back_policy == BackPolicy.CLOSE):
			match panel.back_policy:
				BackPolicy.CLOSE:
					close_panel()
				BackPolicy.CUSTOM:
					panel.on_back()
			return false
	if not _EXIT_PLATFORMS.has(CoreBuildInfo.platform):
		return false
	_open_exit_confirm()
	return true


static func _open_exit_confirm() -> void:
	var param: SystemPopupParam = SystemPopupParam.new()
	param.body = ReservedString.ui_exit_confirm()
	var quit: SystemPopupButton = SystemPopupButton.new()
	quit.label = ReservedString.ui_exit_quit()
	quit.callback = UICore._on_exit_quit
	var cancel: SystemPopupButton = SystemPopupButton.new()
	cancel.label = ReservedString.ui_exit_cancel()
	param.buttons.append(quit)
	param.buttons.append(cancel)
	param.back_button = 1
	open_system_popup(param, Callable())


static func _on_exit_quit() -> void:
	if not _is_initialized:
		return
	EventCore.publish(EventCore.acquire(ExitConfirmedEvent))


# --- Internal: UI buttons ---


static func _register_button(button: UIButton) -> void:
	if not _is_initialized:
		return
	if button.action.is_empty():
		return
	if button.action == String(_BACK_ACTION) or not InputCore.has_action(StringName(button.action)):
		LogCore.log_error(_TAG, "UIButton: action %s is back or not an action" % button.action)
		button.action = ""
		return
	button._action_name = StringName(button.action)
	if not _action_buttons.has(button):
		_action_buttons.append(button)


static func _unregister_button(button: UIButton) -> void:
	if _is_initialized:
		_action_buttons.erase(button)
	button._action_name = &""


## The parent `BaseButton` of `button` emitted `pressed`: a pointer click or an accept input on the focus.
static func _on_button_pressed(button: UIButton) -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "UIButton click before init")
		return
	var control: BaseButton = button._button
	var by_accept: bool = _accept_frame == Engine.get_process_frames() and control != null and control.has_focus()
	if by_accept and not button._accept_pending:
		# The engine button clicks at the accept event of the input it clicks by: the state is the one before the press
		# of that input in this frame, or before the first accept event of the frame when that press is in an earlier
		# frame.
		var press: _ACCEPT_STATE = _accept_presses.get(_accept_input_id(_accept_last))
		var state: _ACCEPT_STATE = press if press != null and press.frame == _accept_frame else _accept_first
		if state == null or state.button != button:
			state = _take_accept_state(button, null)
		var event: InputEvent = press.event if press != null else _accept_last
		button._accept_bound = event != null and button._action_name != &"" \
				and _is_binding_of(event, button._action_name)
		button._accept_was_pressed = state.was_pressed
		button._accept_was_released = state.was_released
	_click(button, by_accept)


## `by_accept`: the click of a device accept input. Its frame is the frame `InputCore` gives that input, the first
## process frame after it, so it stays pending until the next frame starts, and the action click of the same frame is
## dropped. An action click while the accept click is pending is dropped when `InputCore` gives that accept input this
## frame (`_accept_takes_frame`); otherwise it is a click of its own and the accept click stays pending.
static func _click(button: UIButton, by_accept: bool) -> void:
	var frame: int = Engine.get_process_frames()
	if by_accept:
		if button._accept_pending:
			return
	elif button._accept_pending and _accept_takes_frame(button):
		button._accept_pending = false
		button._click_frame = frame
		return
	elif button._click_frame == frame:
		return
	var now: int = TimeCore.get_real_time()
	if _has_click and now - _last_click_ms < _click_interval_ms:
		return
	_has_click = true
	_last_click_ms = now
	if by_accept:
		button._accept_pending = true
		_pending_clicks.append(button)
	else:
		button._click_frame = frame
	var sound: String = ReservedSound.ui_button_click()
	if not sound.is_empty():
		SoundCore.play(sound, SoundCore.SoundBus.UI, ResourceCore.get_global_scope())
	var callback: Callable = button._callback
	if not callback.is_null():
		if callback.is_valid():
			callback.call()
		else:
			LogCore.log_error(_TAG, "UIButton: the click callback cannot be called")
			button._callback = Callable()
	if not by_accept or not _is_initialized or not is_instance_valid(button):
		return
	var element: Control = button.get_parent() as Control
	var holder: _HOLDER = _focus_target()
	var view: _VIEW_FOCUS = holder as _VIEW_FOCUS
	if view != null and element != null and holder.focus_element == element:
		if not view.accept.is_null():
			if view.accept.is_valid():
				view.accept.call(element)
			else:
				LogCore.log_error(_TAG, "set_view_focus: the accept callback cannot be called")


## Whether `InputCore` gives the pending accept input of `button` this frame, at an action click of `button` in this
## frame. The accept input came in this frame's process callbacks, so its frame is the next frame unless a press or
## release of an action it is a binding of, not a device input, came after it. A press or release of the button's
## action that is not a device input shows as the action pressed or released this frame when it was not before the
## accept input; a device input that came after it is still pending.
static func _accept_takes_frame(button: UIButton) -> bool:
	if not button._accept_bound:
		return false
	if not button._accept_was_pressed:
		return true
	return not button._accept_was_released and InputCore.is_just_released(button._action_name)


## Whether the action of `button` was pressed and released this frame, before the accept input `event` that
## `InputCore` has not seen yet.
static func _take_accept_state(button: UIButton, event: InputEvent) -> _ACCEPT_STATE:
	var state: _ACCEPT_STATE = _ACCEPT_STATE.new()
	state.frame = Engine.get_process_frames()
	state.event = event
	state.button = button
	if button == null or button._action_name == &"":
		return state
	state.was_pressed = InputCore.is_just_pressed(button._action_name)
	state.was_released = InputCore.is_just_released(button._action_name)
	return state


## Whether the block stage of `InputCore` passes the gamepad axis press `event` in the blocked state to an action whose
## source it presses: an action other than `back` with the axis direction of `event` in its binding and whose
## `InputBlockCore.pass_action` is `true`.
static func _axis_press_passes(event: InputEvent) -> bool:
	for action: StringName in InputMap.get_actions():
		if action == _BACK_ACTION or not InputCore.has_action(action) or not InputBlockCore.pass_action(action):
			continue
		if _is_binding_of(event, action):
			return true
	return false


## The device input of the key, gamepad button or gamepad axis event `event`: its press and release have one id.
static func _accept_input_id(event: InputEvent) -> String:
	if event is InputEventKey:
		var key: InputEventKey = event as InputEventKey
		return "k%d" % (key.keycode if key.keycode != KEY_NONE else key.physical_keycode)
	if event is InputEventJoypadButton:
		return "b%d:%d" % [event.device, (event as InputEventJoypadButton).button_index]
	if event is InputEventJoypadMotion:
		return "a%d:%d" % [event.device, (event as InputEventJoypadMotion).axis]
	return ""


## Whether the key, gamepad button or gamepad axis direction of `event` is in the `InputCore` binding of `action`.
static func _is_binding_of(event: InputEvent, action: StringName) -> bool:
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
		if motion.axis < 0 or motion.axis >= _PAD_AXIS_NAMES.size() or motion.axis_value == 0.0:
			return false
		input_name = _PAD_AXIS_NAMES[motion.axis] + ("+" if motion.axis_value > 0.0 else "-")
		pad = true
	if input_name.is_empty():
		return false
	# A binding has at most the larger of the setting limit and the default binding from the input map.
	var limit: String = _SETTING_MAX_PAD_BUTTONS_PER_ACTION if pad else _SETTING_MAX_KEYS_PER_ACTION
	var buffer: PackedStringArray = PackedStringArray()
	buffer.resize(maxi(CoreSettings.get_int(limit), 0) + InputMap.action_get_events(action).size())
	var count: int = InputCore.get_pad_buttons(action, buffer) if pad else InputCore.get_keys(action, buffer)
	for i: int in count:
		if buffer[i] == input_name:
			return true
	return false


## Every frame: an action click for each `UIButton` with an action pressed this frame.
static func _check_action_clicks() -> void:
	for i: int in _action_buttons.size():
		if i >= _action_buttons.size():
			return
		var button: UIButton = _action_buttons[i]
		if not is_instance_valid(button) or button._action_name == &"":
			continue
		if not InputCore.is_just_pressed(button._action_name):
			continue
		var element: Control = button.get_parent() as Control
		if element == null or not _is_element_visible(element):
			continue
		_click(button, false)
		if not _is_initialized:
			return


static func _has_ui_button(control: Control) -> bool:
	return _ui_button_of(control) != null


## The first `UIButton` child of `control`, or `null`.
static func _ui_button_of(control: Control) -> UIButton:
	for i: int in control.get_child_count():
		var button: UIButton = control.get_child(i) as UIButton
		if button != null:
			return button
	return null


## The first `Control` with a `UIButton` under `root` in the engine focus order, `root` included.
static func _first_button_in(root: Control) -> Control:
	if root.is_visible_in_tree() and root.focus_mode != Control.FOCUS_NONE and _has_ui_button(root):
		return root
	for i: int in root.get_child_count():
		var child: Control = root.get_child(i) as Control
		if child == null or not child.visible:
			continue
		var found: Control = _first_button_in(child)
		if found != null:
			return found
	return null


# --- Internal: anchors, visibility, modal cover ---


static func _register_anchor(anchor: UIAnchor) -> void:
	if _is_initialized and not _anchors.has(anchor):
		_anchors.append(anchor)


static func _unregister_anchor(anchor: UIAnchor) -> void:
	if _is_initialized:
		_anchors.erase(anchor)


## The name an anchor is found by: `<name>.<index>` inside a `UIScrollList` item UI.
static func _anchor_name_of(anchor: UIAnchor) -> String:
	var node: Node = anchor.get_parent()
	while node != null:
		var parent: Node = node.get_parent()
		var list: UIScrollList = parent as UIScrollList
		if list != null:
			var index: int = list._index_of_item(node)
			if index >= 0:
				return "%s.%d" % [anchor.anchor_name, index]
		if node is CanvasLayer:
			break
		node = parent
	return anchor.anchor_name


## The element and its ancestors are visible, it is in no panel or popup being prepared or destroyed, and it is not
## modal covered.
static func _is_element_visible(element: Control) -> bool:
	if not element.is_visible_in_tree():
		return false
	var node: Node = element
	while node != null and not (node is CanvasLayer):
		var id: int = node.get_instance_id()
		if _instance_state.has(id) and _instance_state[id] != _SHOWN:
			return false
		node = node.get_parent()
	return not _is_covered(element)


## The nearest panel or popup instance holding `node`, `node` included, or `null`.
static func _containing_instance(node: Node) -> Control:
	var current: Node = node
	while current != null and not (current is CanvasLayer):
		if _instance_state.has(current.get_instance_id()):
			return current as Control
		current = current.get_parent()
	return null


static func _canvas_layer_of(node: Node) -> CanvasLayer:
	var current: Node = node
	while current != null:
		var layer: CanvasLayer = current as CanvasLayer
		if layer != null:
			return layer
		current = current.get_parent()
	return null


## Index of the UI layer holding `node`, or -1 when it is in none (the world).
static func _layer_index_of(node: Node) -> int:
	var layer: CanvasLayer = _canvas_layer_of(node)
	if layer == null:
		return -1
	for i: int in _layers.size():
		if _layers[i] == layer:
			return i
	return -1


## A shown modal panel or modal popup is drawn above `element`. The instance holding it is not counted.
static func _is_covered(element: Control) -> bool:
	var holder: Control = _containing_instance(element)
	var layer: int = _layer_index_of(element)
	if layer > UILayer.POPUP:
		return false
	if _modal_popup_above(element, holder, layer, _shown_system) \
			or _modal_popup_above(element, holder, layer, _shown_normal):
		return true
	if layer > UILayer.PANEL or _current == null:
		return false
	var panel: UIPanel = _current.panel
	if panel == holder or not is_instance_valid(panel) or not panel.visible or not panel.modal:
		return false
	return layer < UILayer.PANEL or panel.is_greater_than(element)


static func _modal_popup_above(element: Control, holder: Control, layer: int, records: Array[_POPUP]) -> bool:
	for i: int in range(records.size() - 1, -1, -1):
		var record: _POPUP = records[i]
		if not record.modal or record.instance == holder or not is_instance_valid(record.instance):
			continue
		if layer < UILayer.POPUP or record.instance.is_greater_than(element):
			return true
	return false


# --- Internal: focus ---


static func _on_device_changed(device: InputCore.InputDevice) -> void:
	if not _is_initialized:
		return
	if device == InputCore.InputDevice.GAMEPAD:
		_focus_delay_frame = Engine.get_process_frames() + 1
	elif device == InputCore.InputDevice.TOUCH:
		_key_focus_mode = false
	_update_focus()


## A disconnected gamepad sends no release event of its held axes.
static func _on_gamepad_connection_changed(gamepad: int, connected: bool) -> void:
	if not _is_initialized or connected:
		return
	var prefix: String = "a%d:" % gamepad
	for id: String in _accept_held.keys():
		if id.begins_with(prefix):
			_accept_held.erase(id)


static func _is_focus_mode() -> bool:
	var device: InputCore.InputDevice = InputCore.get_device()
	if device == InputCore.InputDevice.GAMEPAD:
		return true
	return device == InputCore.InputDevice.KEYBOARD_MOUSE and _key_focus_mode


static func _is_text_input(control: Control) -> bool:
	return control is LineEdit or control is TextEdit


## The focus target: the top shown system popup, the `Tutorial` view focus, the `Cutscene` view focus, then the top
## shown modal panel or popup. `null` when there is none.
static func _focus_target() -> _HOLDER:
	for i: int in range(_shown_system.size() - 1, -1, -1):
		var record: _POPUP = _shown_system[i]
		if record.state != _POPUP.State.DONE and is_instance_valid(record.instance):
			return record
	if _view_has_visible(_tutorial_view):
		return _tutorial_view
	if _view_has_visible(_cutscene_view):
		return _cutscene_view
	for i: int in range(_shown_normal.size() - 1, -1, -1):
		var record: _POPUP = _shown_normal[i]
		if record.modal and record.state != _POPUP.State.DONE and is_instance_valid(record.instance):
			return record
	if _current != null and is_instance_valid(_current.panel) and _current.panel.visible and _current.panel.modal:
		return _current
	return null


static func _view_has_visible(view: _VIEW_FOCUS) -> bool:
	if view == null:
		return false
	for element: Control in view.elements:
		if is_instance_valid(element) and element.is_visible_in_tree():
			return true
	return false


## Whether `control` may have the focus while `holder` is the focus target.
static func _in_holder(holder: _HOLDER, control: Control) -> bool:
	if not _has_ui_button(control) or not control.is_visible_in_tree():
		return false
	var view: _VIEW_FOCUS = holder as _VIEW_FOCUS
	if view != null:
		return view.elements.has(control)
	return holder.instance != null and holder.instance.is_ancestor_of(control)


## The focus element of `holder`: the kept one while it is valid, else the first rule.
static func _holder_element(holder: _HOLDER) -> Control:
	var element: Control = holder.focus_element
	if element != null and is_instance_valid(element) and _in_holder(holder, element):
		return element
	element = null
	var view: _VIEW_FOCUS = holder as _VIEW_FOCUS
	if view != null:
		if view.initial != null and is_instance_valid(view.initial) and _in_holder(holder, view.initial):
			element = view.initial
		else:
			for candidate: Control in view.elements:
				if is_instance_valid(candidate) and candidate.is_visible_in_tree():
					element = candidate
					break
	else:
		var initial: Control = _initial_focus_of(holder)
		if initial != null and is_instance_valid(initial) and _in_holder(holder, initial):
			element = initial
		elif holder.instance != null:
			element = _first_button_in(holder.instance)
	holder.focus_element = element
	return element


static func _initial_focus_of(holder: _HOLDER) -> Control:
	var record: _POPUP = holder as _POPUP
	if record != null:
		return record.initial_focus
	var view: _VIEW = holder as _VIEW
	if view != null:
		return view.panel.initial_focus
	return null


## Puts the focus on the focus element of the focus target in the focus mode; takes it away outside the focus mode.
static func _update_focus() -> void:
	if not _is_initialized or not is_instance_valid(_node) or not _node.is_inside_tree():
		return
	var owner: Control = _node.get_viewport().gui_get_focus_owner()
	if not _is_focus_mode():
		if owner != null and not _is_text_input(owner):
			owner.release_focus()
		return
	if Engine.get_process_frames() < _focus_delay_frame:
		return
	var holder: _HOLDER = _focus_target()
	if holder == null:
		if owner != null and not _is_text_input(owner):
			owner.release_focus()
		return
	if owner != null and owner != holder.focus_element and _in_holder(holder, owner):
		holder.focus_element = owner
		return
	var element: Control = _holder_element(holder)
	if element == null:
		if owner != null and not _is_text_input(owner):
			owner.release_focus()
		return
	if owner != element:
		element.grab_focus()


## `Viewport.gui_focus_changed`.
static func _on_focus_changed(control: Control) -> void:
	if not _is_initialized:
		return
	if _is_text_input(control):
		if control != _text_input:
			_text_input = control
			_update_keyboard_shift()
		if not _is_focus_mode():
			return
	if not _is_focus_mode():
		control.release_focus()
		return
	var holder: _HOLDER = _focus_target()
	if holder == null:
		control.release_focus()
		return
	if _in_holder(holder, control):
		holder.focus_element = control
		return
	var to: Control = _take_view_move(holder)
	if to != null:
		to.grab_focus()
		return
	var previous: Control = _holder_element(holder)
	if previous != null and previous != control:
		previous.grab_focus()
	elif previous == null:
		control.release_focus()


## Input before `InputCore`: the focus mode start and end, the accept input frame, the system popup scroll and the
## view focus move across canvas layers.
static func _on_input(event: InputEvent) -> void:
	if not _is_initialized:
		return
	_clear_view_move()
	var mouse_motion: bool = event is InputEventMouseMotion
	var mouse_press: bool = event is InputEventMouseButton and event.is_pressed()
	if mouse_motion or mouse_press:
		if event.device != InputEvent.DEVICE_ID_EMULATION and _key_focus_mode:
			_key_focus_mode = false
			_update_focus()
		return
	var is_key: bool = event is InputEventKey
	var is_pad: bool = event is InputEventJoypadButton or event is InputEventJoypadMotion
	if not is_key and not is_pad:
		return
	if event.is_action(&"ui_accept", true) and not event.is_echo():
		var frame: int = Engine.get_process_frames()
		var press: bool = event.is_pressed()
		var id: String = _accept_input_id(event)
		var cancel_count: int = InputCore.get_cancel_count()
		var axis: bool = event is InputEventJoypadMotion
		var held: bool = press and (not axis or not InputBlockCore.is_blocked() or _axis_press_passes(event))
		var first_press: bool = held and _accept_held.get(id, -1) != cancel_count
		_accept_last = event
		if _accept_frame != frame or first_press:
			var owner: Control = _node.get_viewport().gui_get_focus_owner()
			var state: _ACCEPT_STATE = _take_accept_state(_ui_button_of(owner) if owner != null else null, event)
			if _accept_frame != frame:
				_accept_frame = frame
				_accept_first = state
			if first_press:
				_accept_presses[id] = state
		if axis:
			if held:
				_accept_held[id] = cancel_count
			else:
				_accept_held.erase(id)
	var up: bool = event.is_action_pressed(&"ui_up", true, true)
	var down: bool = event.is_action_pressed(&"ui_down", true, true)
	var direction: bool = up or down or event.is_action_pressed(&"ui_left", true, true) \
			or event.is_action_pressed(&"ui_right", true, true)
	if not direction:
		return
	var viewport: Viewport = _node.get_viewport()
	var handled: bool = false
	var focus_mode: bool = _is_focus_mode()
	if is_key and not focus_mode:
		var owner: Control = viewport.gui_get_focus_owner()
		if owner == null or not _is_text_input(owner):
			_key_focus_mode = true
			if InputCore.get_device() == InputCore.InputDevice.KEYBOARD_MOUSE:
				var holder: _HOLDER = _focus_target()
				var element: Control = _holder_element(holder) if holder != null else null
				if element != null:
					element.grab_focus()
					handled = true
			else:
				_update_focus_callable.call_deferred()
	if (up or down) and not _shown_system.is_empty():
		if not InputBlockCore.is_blocked() or InputBlockCore.pass_focus(_system_root):
			var top: _POPUP = _shown_system[_shown_system.size() - 1]
			var view: _SYSTEM_VIEW = top.system_view as _SYSTEM_VIEW
			if view != null:
				view.scroll_by(-_system_popup_scroll_step if up else _system_popup_scroll_step)
	if handled:
		viewport.set_input_as_handled()
	elif focus_mode:
		# The engine takes the last of these that the event matches.
		var side: Side = SIDE_TOP
		if event.is_action_pressed(&"ui_left", true, true):
			side = SIDE_LEFT
		if event.is_action_pressed(&"ui_right", true, true):
			side = SIDE_RIGHT
		if down:
			side = SIDE_BOTTOM
		_plan_view_move(event, viewport.gui_get_focus_owner(), side)


## Unhandled input: the engine found no focus neighbor for the planned view focus move, so UICore moves the focus.
static func _on_unhandled_input(event: InputEvent) -> void:
	if not _is_initialized or event == null or event != _view_move_event:
		return
	var holder: _HOLDER = _focus_target()
	var from: Control = _view_move_from
	var to: Control = _take_view_move(holder)
	if to == null or not is_instance_valid(from) or _node.get_viewport().gui_get_focus_owner() != from:
		return
	to.grab_focus()
	_node.get_viewport().set_input_as_handled()


## Keeps the view focus move of a direction input toward `side` when the focus owner is a view focus element and the
## engine finds no neighbor among the visible view focus elements: the engine searches only the owner's canvas layer.
static func _plan_view_move(event: InputEvent, owner: Control, side: Side) -> void:
	var view: _VIEW_FOCUS = _focus_target() as _VIEW_FOCUS
	if view == null or owner == null or not _in_holder(view, owner):
		return
	var neighbor: Control = owner.find_valid_focus_neighbor(side)
	if neighbor != null and neighbor != owner and _in_holder(view, neighbor):
		return
	var to: Control = _nearest_view_element(view, owner, side)
	if to == null:
		return
	_view_move_event = event
	_view_move_from = owner
	_view_move_to = to


## The planned view focus move target while `holder` is that view focus in the focus mode and the focus element is
## still the element the move starts from; clears the plan. `null` when there is none.
static func _take_view_move(holder: _HOLDER) -> Control:
	var from: Control = _view_move_from
	var to: Control = _view_move_to
	var planned: bool = _view_move_event != null
	_clear_view_move()
	if not planned or holder == null or not (holder is _VIEW_FOCUS) or not _is_focus_mode():
		return null
	if not is_instance_valid(from) or holder.focus_element != from:
		return null
	if not is_instance_valid(to) or not _in_holder(holder, to):
		return null
	return to


static func _clear_view_move() -> void:
	_view_move_event = null
	_view_move_from = null
	_view_move_to = null


## The visible focusable element of `view` nearest to `from` toward `side`, in viewport coordinates so that elements
## on other canvas layers count. Like the engine neighbor search, an element counts when it lies wholly past the far
## edge of `from` in that direction, and the distance is the shortest one between the two outlines.
static func _nearest_view_element(view: _VIEW_FOCUS, from: Control, side: Side) -> Control:
	var direction: Vector2 = _SIDE_DIRECTIONS[side]
	var from_points: PackedVector2Array = _canvas_corners(from)
	var reach: float = -INF
	for point: Vector2 in from_points:
		reach = maxf(reach, direction.dot(point))
	var nearest: Control = null
	var nearest_distance: float = INF
	for element: Control in view.elements:
		if element == from or not is_instance_valid(element) or element.focus_mode == Control.FOCUS_NONE \
				or not _in_holder(view, element):
			continue
		var points: PackedVector2Array = _canvas_corners(element)
		var start: float = INF
		for point: Vector2 in points:
			start = minf(start, direction.dot(point))
		if start <= reach - _NEIGHBOR_EPSILON:
			continue
		var distance: float = _outline_distance_squared(from_points, points)
		if distance < nearest_distance:
			nearest_distance = distance
			nearest = element
	return nearest


## The corners of `control` in viewport coordinates, canvas layer transform included.
static func _canvas_corners(control: Control) -> PackedVector2Array:
	var transform: Transform2D = control.get_global_transform_with_canvas()
	var size: Vector2 = control.size
	return PackedVector2Array([transform * Vector2.ZERO, transform * Vector2(size.x, 0.0), transform * size,
			transform * Vector2(0.0, size.y)])


static func _outline_distance_squared(a: PackedVector2Array, b: PackedVector2Array) -> float:
	var distance: float = INF
	for i: int in a.size():
		for j: int in b.size():
			var closest: PackedVector2Array = Geometry2D.get_closest_points_between_segments(a[i], a[(i + 1) % a.size()],
					b[j], b[(j + 1) % b.size()])
			distance = minf(distance, closest[0].distance_squared_to(closest[1]))
	return distance


## Before the content code of every frame: the pending click frames get the number of this frame's process step.
static func _on_frame_start() -> void:
	if _pending_clicks.is_empty():
		return
	var frame: int = Engine.get_process_frames()
	for button: UIButton in _pending_clicks:
		if is_instance_valid(button) and button._accept_pending:
			button._accept_pending = false
			button._click_frame = frame
	_pending_clicks.clear()


## Every frame: action clicks, the focus, the keyboard shift and the code made loading icon.
static func _on_frame(delta: float) -> void:
	if not _is_initialized:
		return
	_clear_view_move()
	_check_action_clicks()
	if not _is_initialized:
		return
	_update_focus()
	var owner: Control = _node.get_viewport().gui_get_focus_owner()
	var text_input: Control = owner if owner != null and _is_text_input(owner) else null
	if text_input != _text_input:
		_text_input = text_input
		_update_keyboard_shift()
	if _loading_icon_code_made and _loading_icon != null and _loading_icon.visible:
		_loading_icon.rotation = fposmod(_loading_icon.rotation + delta * _ICON_TURN_PER_SECOND, TAU)


static func _update_loading_icon() -> void:
	if _loading_icon != null:
		_loading_icon.visible = not _icon_tokens.is_empty()


# --- Internal: keyboard shift ---


## Moves the shift target of the focused text input element up so that the element clears the keyboard area.
static func _update_keyboard_shift() -> void:
	if not _is_initialized:
		return
	var element: Control = _text_input
	var target: Object = null
	var distance: float = 0.0
	var keyboard: Rect2 = SafeAreaCore.get_keyboard_area()
	if element != null and is_instance_valid(element) and element.is_visible_in_tree() and keyboard.has_area():
		target = _shift_target_of(element)
		if target != null:
			var rect: Rect2 = element.get_global_rect()
			if target == _shift_target and target is Control:
				rect.position.y += _shift_distance
			var safe: Rect2 = SafeAreaCore.get_safe_area()
			distance = maxf(0.0, minf(rect.end.y + _keyboard_gap - keyboard.position.y, rect.position.y - safe.position.y))
	if target != _shift_target:
		_apply_shift(_shift_target, 0.0)
		_shift_target = target
		_shift_distance = 0.0
	if target != null:
		_apply_shift(target, distance)


static func _apply_shift(target: Object, distance: float) -> void:
	if target == null or not is_instance_valid(target):
		_shift_distance = 0.0
		return
	var control: Control = target as Control
	if control != null:
		control.position.y -= distance - _shift_distance
	else:
		var layer: CanvasLayer = target as CanvasLayer
		if layer != null:
			layer.offset.y = -distance
	_shift_distance = distance


## The nearest panel or popup instance root holding `element`, else the UI layer it is on.
static func _shift_target_of(element: Control) -> Object:
	var instance: Control = _containing_instance(element)
	if instance != null:
		return instance
	var layer: int = _layer_index_of(element)
	return _layers[layer] if layer >= 0 else null
