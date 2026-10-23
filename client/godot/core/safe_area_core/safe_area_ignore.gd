class_name SafeAreaIgnore
extends Node
## Ignore mark: a child of a UI element (`Control`). `SafeAreaCore` places that UI element by its anchors against the
## visible game area instead of its parent. Example: a dim, a panel background that fills the screen edge to edge.

## Instance ID of the UI element whose offsets `_design_offsets` holds. 0: none yet.
var _control_id: int = 0
## Left, top, right and bottom offsets of the UI element when it was first registered: the offsets taken against the
## visible game area. `SafeAreaCore` rewrites the offsets of the element, so they are kept here.
var _design_offsets: Vector4 = Vector4.ZERO
## The parent of the UI element; a change of its rectangle places the UI element again.
var _watched: Control = null
## Session of `SafeAreaCore` this mark was registered in.
var _session: RefCounted = null
var _parent_error_logged: bool = false
var _on_watched_changed: Callable = Callable()
var _on_check: Callable = Callable()


func _init() -> void:
	_on_watched_changed = _watched_changed
	_on_check = _check


func _enter_tree() -> void:
	SafeAreaCore._register_ignore(self)


func _exit_tree() -> void:
	SafeAreaCore._unregister_ignore(self)


## The design offsets of `control`; read from it when it is not the element they were read from.
func _design_offsets_of(control: Control) -> Vector4:
	if _control_id != control.get_instance_id():
		_control_id = control.get_instance_id()
		_design_offsets = Vector4(control.offset_left, control.offset_top, control.offset_right, control.offset_bottom)
	return _design_offsets


## Called by `SafeAreaCore` when it registers this mark.
func _start(session: RefCounted) -> void:
	_stop()
	_session = session
	_parent_error_logged = false
	var control: Control = get_parent() as Control
	if control != null:
		var parent: Control = control.get_parent() as Control
		if parent != null and parent.item_rect_changed.connect(_on_watched_changed) == OK:
			_watched = parent
	_on_check.call_deferred()


## Called by `SafeAreaCore` when it unregisters this mark or is released.
func _stop() -> void:
	if is_instance_valid(_watched) and _watched.item_rect_changed.is_connected(_on_watched_changed):
		_watched.item_rect_changed.disconnect(_on_watched_changed)
	_watched = null
	_session = null


func _watched_changed() -> void:
	if _session != null and _session == SafeAreaCore._session:
		SafeAreaCore._place_ignore(self)


func _check() -> void:
	if _session != null:
		SafeAreaCore._check_ignore(self, _session)
