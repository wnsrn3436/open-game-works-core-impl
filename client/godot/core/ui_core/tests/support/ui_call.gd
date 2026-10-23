extends RefCounted
## Runs one async UICore operation without the test waiting for it, and keeps its result.

signal finished

var done: bool = false
var ok: bool = false
var result: UICore.PopupOpenResult = UICore.PopupOpenResult.FAILED


func prepare() -> void:
	ok = await UICore.prepare()
	_finish()


func open_panel(key: String, param: UIParam = null, clear_stack: bool = false) -> void:
	ok = await UICore.open_panel(key, param, clear_stack)
	_finish()


func open_root_panel(key: String) -> void:
	ok = await UICore.open_root_panel(key)
	_finish()


func open_panels(requests: Array[UIPanelRequest], clear_stack: bool = false) -> void:
	ok = await UICore.open_panels(requests, clear_stack)
	_finish()


func close_panel(force: bool = false) -> void:
	ok = await UICore.close_panel(force)
	_finish()


func close_panels_to(key: String, force: bool = false) -> void:
	ok = await UICore.close_panels_to(key, force)
	_finish()


func open_popup(key: String, hidden: Callable = Callable(), suppress: PopupSuppress = null) -> void:
	result = await UICore.open_popup(key, null, hidden, suppress)
	ok = result == UICore.PopupOpenResult.OPENED
	_finish()


func open_system_popup(param: SystemPopupParam, hidden: Callable = Callable()) -> void:
	ok = await UICore.open_system_popup(param, hidden)
	_finish()


func close_popup(popup: Control, after_close: Callable = Callable()) -> void:
	await UICore.close_popup(popup, after_close)
	ok = true
	_finish()


func open_licenses() -> void:
	ok = await UICore.open_licenses()
	_finish()


func set_items(list: UIScrollList, count: int, bind: Callable, scope: Scope, end_near: Callable = Callable(),
		start_near: Callable = Callable(), from_end: bool = false) -> void:
	ok = await list.set_items(count, bind, scope, end_near, start_near, from_end)
	_finish()


func _finish() -> void:
	done = true
	finished.emit()
