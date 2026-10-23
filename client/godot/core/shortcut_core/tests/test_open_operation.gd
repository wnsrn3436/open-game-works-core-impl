extends "res://core/shortcut_core/tests/support/shortcut_case.gd"
## The `UICore` operation stage 8 calls: `open_panel` for one panel, `open_panels` for several. Both open one panel
## the same way, so each test sets the panel lock just before stage 8: `UICore` refuses the open with a warn log that
## names the operation, and the test reads that log line from the log file.

const _MARK_TAG: String = "ShortcutOpenTest"

## Marks of `_open_operations`, one for each call in a test.
var _marks: int = 0


func test_root_to_another_scene_with_one_panel_calls_open_panel() -> void:
	assert_true(await start_at(SCENE_ROOT))
	TestScene.start_panel = PANEL_X
	assert_eq(await _open_operations_at_root_return("change_b"), PackedStringArray(["open_panel"]))


func test_top_to_another_scene_calls_the_same_operation_as_root() -> void:
	assert_true(await start_at(SCENE_ROOT))
	TestScene.start_panel = PANEL_X
	assert_eq(await _open_operations_at_root_return("change_top_b"), PackedStringArray(["open_panel"]))
	assert_true(await SceneCore.change_scene(SCENE_ROOT, null))
	assert_eq(await _open_operations_at_root_return("change_top_bc"), PackedStringArray(["open_panels"]))


func test_root_in_the_current_scene_calls_open_panel_for_one_panel_and_open_panels_for_several() -> void:
	assert_true(await start_at(SCENE_ROOT, PackedStringArray([PANEL_A])))
	assert_eq(await _open_operations_at_root_return("root_c"), PackedStringArray(["open_panel"]))
	assert_true(await UICore.open_panel(PANEL_A, null, false))
	assert_eq(await _open_operations_at_root_return("root_bcd"), PackedStringArray(["open_panels"]))


func test_top_calls_open_panel_for_one_panel_and_open_panels_for_several() -> void:
	assert_true(await start_at(SCENE_ROOT, PackedStringArray([PANEL_A])))
	assert_eq(await _open_operations_at_popup_close("top_b"), PackedStringArray(["open_panel"]))
	assert_eq(await _open_operations_at_popup_close("top_bc"), PackedStringArray(["open_panels"]))
	assert_eq(stack(), "r,a")


func test_root_without_a_root_panel_calls_open_panel_for_one_panel_and_open_panels_for_several() -> void:
	assert_true(await start_at(SCENE_PLAIN, PackedStringArray([PANEL_A])))
	assert_eq(await _open_operations_at_popup_close("plain_b"), PackedStringArray(["open_panel"]))
	assert_eq(await _open_operations_at_popup_close("plain_bc"), PackedStringArray(["open_panels"]))
	assert_eq(stack(), "a")


## Navigates `shortcut_name` and sets the panel lock while stage 7 waits for the return to the root panel R, after
## `close_panels_to` started. The names of the `UICore` operations refused under the lock. Async.
func _open_operations_at_root_return(shortcut_name: String) -> PackedStringArray:
	var mark: String = _mark()
	var ended: int = results.size()
	TestPanel.returned_gate = Gate.new()
	navigate_later(shortcut(shortcut_name))
	await wait_trace("panel_gated:r")
	UICore.set_panel_lock(true)
	TestPanel.returned_gate.open(true)
	TestPanel.returned_gate = null
	await wait_results(ended + 1)
	return _refused_operations(mark, results[ended])


## Navigates `shortcut_name` with a popup open whose hidden callback sets the panel lock in stage 5: no transition
## runs, so the stage 5 check passes and stages 6 and 7 do not run. The names of the `UICore` operations refused under
## the lock. Async.
func _open_operations_at_popup_close(shortcut_name: String) -> PackedStringArray:
	var result: UICore.PopupOpenResult = await UICore.open_popup(POPUP, null, _lock_panels)
	assert_eq(result, UICore.PopupOpenResult.OPENED)
	var mark: String = _mark()
	var ok: bool = await ShortcutCore.navigate(shortcut(shortcut_name))
	return _refused_operations(mark, 1 if ok else 0)


## Checks the end of a navigation under the panel lock and takes the lock off. The operation names of the `UICore`
## panel lock warn logs after `mark` in the log file.
func _refused_operations(mark: String, result: int) -> PackedStringArray:
	UICore.set_panel_lock(false)
	assert_eq(result, 0, "the open under the panel lock fails")
	assert_eq(warns("UICore"), 1)
	assert_eq(errors(TAG), 0)
	Trace.clear()
	var text: String = ""
	for path: String in LogCoreDev.list_log_files():
		text += FileAccess.get_file_as_string(CoreBuildInfo.storage_root + path)
	var at: int = text.rfind(mark)
	assert_gt(at, -1, "log mark " + mark)
	var refused: RegEx = RegEx.create_from_string("\tUICore\t([a-z_]+): during a panel transition or the panel lock")
	var names: PackedStringArray = PackedStringArray()
	for found: RegExMatch in refused.search_all(text.substr(at)):
		names.append(found.get_string(1))
	return names


## Writes a new mark line to the log file.
func _mark() -> String:
	_marks += 1
	var mark: String = "open operation mark %d" % _marks
	LogCore.log_info(_MARK_TAG, mark)
	return mark


func _lock_panels() -> void:
	UICore.set_panel_lock(true)
