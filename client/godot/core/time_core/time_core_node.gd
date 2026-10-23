extends Node
## Core node of `TimeCore`: runs the engine frame, receives the background entry and return, and in the browser
## runtime turns page visibility changes into the same notifications.

const _WEB_OS_NAME: String = "Web"

## `document` of the page and the visibility callback, in the browser runtime.
var _document: JavaScriptObject = null
var _visibility_callback: JavaScriptObject = null


func _ready() -> void:
	if OS.get_name() == _WEB_OS_NAME:
		_attach_visibility()


func _process(_delta: float) -> void:
	TimeCore._on_engine_frame()


func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_PAUSED:
		TimeCore._on_engine_background()
	elif what == NOTIFICATION_APPLICATION_RESUMED:
		TimeCore._on_engine_foreground()


func _exit_tree() -> void:
	_detach_visibility()
	TimeCore._on_node_exit(self)


# ogw:input_boundary
func _attach_visibility() -> void:
	var document: Variant = JavaScriptBridge.get_interface("document")
	if not document is JavaScriptObject:
		return
	_document = document
	_visibility_callback = JavaScriptBridge.create_callback(_on_visibility_change)
	@warning_ignore("unsafe_property_access")
	document.onvisibilitychange = _visibility_callback


# ogw:input_boundary
func _detach_visibility() -> void:
	if _document == null:
		return
	var document: Variant = _document
	@warning_ignore("unsafe_property_access")
	document.onvisibilitychange = null
	_document = null
	_visibility_callback = null


## `document.hidden` is read as a string: the bridge gives a JavaScript boolean to the engine as an int.
# ogw:input_boundary
func _on_visibility_change(_args: Array) -> void:
	var hidden: Variant = JavaScriptBridge.eval("String(document.hidden)", true)
	if not hidden is String:
		return
	var text: String = hidden
	if text != "true" and text != "false":
		return
	var tree: SceneTree = get_tree()
	if tree == null:
		return
	if text == "true":
		tree.root.propagate_notification(NOTIFICATION_APPLICATION_PAUSED)
	else:
		tree.root.propagate_notification(NOTIFICATION_APPLICATION_RESUMED)
