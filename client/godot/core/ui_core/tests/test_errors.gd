extends "res://core/ui_core/tests/support/ui_test_case.gd"
## The rows of the error table that the other test files do not cover. The scroll list rows are in
## `test_scroll_list.gd`.


func test_prefab_root_that_is_not_a_panel_or_popup() -> void:
	assert_true(await start())
	assert_false(await UICore.open_panel(NOT_PANEL, null, false))
	assert_eq(errors(), 1)
	assert_eq(await UICore.open_popup(NOT_PANEL, null, Callable()), UICore.PopupOpenResult.FAILED)
	assert_eq(errors(), 1)
	assert_eq(UICore.get_panel_stack().size(), 0)


func test_refused_param() -> void:
	assert_true(await start())
	LOG.refused[PANEL_A] = true
	assert_false(await UICore.open_panel(PANEL_A, null, false))
	assert_eq(errors(), 1)
	assert_eq(LOG.count(PANEL_A + ":prepare"), 0, "prepare is not called")
	LOG.refused[POPUP_A] = true
	assert_eq(await UICore.open_popup(POPUP_A, null, Callable()), UICore.PopupOpenResult.FAILED)
	assert_eq(errors(), 1)
	assert_eq(LOG.count(POPUP_A + ":prepare"), 0)


func test_empty_open_panels() -> void:
	assert_true(await start())
	assert_false(await UICore.open_panels([] as Array[UIPanelRequest]))
	assert_eq(errors(), 1)


func test_duplicate_popup_and_requests_during_close_all() -> void:
	assert_true(await start())
	assert_true(await UICore.open_popup(POPUP_A, null, Callable()) == UICore.PopupOpenResult.OPENED)
	assert_eq(await UICore.open_popup(POPUP_A, null, Callable()), UICore.PopupOpenResult.FAILED)
	assert_eq(warns(), 1, "the same key is open")
	var gate: GATE = LOG.add_gate(POPUP_B)
	var preparing: CALL = CALL.new()
	preparing.open_popup(POPUP_B)
	await UnitTestCore.wait_frames(2)
	assert_eq(await UICore.open_popup(POPUP_B, null, Callable()), UICore.PopupOpenResult.FAILED)
	assert_eq(warns(), 1, "the same key is in its open flow")
	var queued: CALL = CALL.new()
	queued.open_popup(POPUP_C)
	assert_eq(await UICore.open_popup(POPUP_C, null, Callable()), UICore.PopupOpenResult.FAILED)
	assert_eq(warns(), 1, "the same key is queued")
	gate.open()
	await finish(queued)
	UICore.close_all_popups()
	assert_true(await UICore.open_popup(POPUP_DIM_A, null, _request_during_close_all) == UICore.PopupOpenResult.OPENED)
	UICore.close_all_popups()
	assert_true(_popup_request.done and _popup_request.result == UICore.PopupOpenResult.FAILED)
	assert_true(_system_request.done and not _system_request.ok)
	assert_eq(warns(), 2, "requests during close_all_popups")


var _popup_request: CALL = null
var _system_request: CALL = null


## A hidden callback: called inside `close_all_popups`, it asks for a popup and a system popup.
func _request_during_close_all() -> void:
	_popup_request = CALL.new()
	_popup_request.open_popup(POPUP_DIM_B)
	_system_request = CALL.new()
	_system_request.open_system_popup(one_button_param())


func test_suppress_key_outside_the_rule() -> void:
	assert_true(await start())
	load_user_file()
	sync_time(SERVER_TIME)
	var suppress: PopupSuppress = PopupSuppress.new()
	suppress.key = "no_dot"
	assert_eq(await UICore.open_popup(POPUP_A, null, Callable(), suppress), UICore.PopupOpenResult.FAILED)
	assert_false(UICore.is_popup_suppressed("a.b.c"))
	UICore.suppress_popup("owner.NotSnake", UICore.PopupSuppressMode.FOREVER)
	assert_eq(errors(), 3)
	assert_eq(LocalDataCore.get_array_string(LocalDataCore.FileKind.USER, UICore._SUPPRESS_KEY).size(), 0)


func test_bad_system_popup_params() -> void:
	assert_true(await start())
	assert_false(await UICore.open_system_popup(system_param(PackedStringArray()), Callable()), "no button")
	var four: PackedStringArray = PackedStringArray()
	for i: int in 4:
		four.append(ReservedString.ui_exit_quit())
	assert_false(await UICore.open_system_popup(system_param(four), Callable()), "four buttons")
	assert_false(await UICore.open_system_popup(
			system_param(PackedStringArray([ReservedString.ui_exit_quit()]), [], 1), Callable()), "back button outside")
	var no_body: SystemPopupParam = one_button_param()
	no_body.body = ""
	assert_false(await UICore.open_system_popup(no_body, Callable()), "no body key")
	assert_false(await UICore.open_system_popup(system_param(PackedStringArray([""])), Callable()), "no label key")
	assert_eq(errors(), 5)
	assert_false(UICore.is_system_popup_visible())


func test_close_popup_of_a_popup_that_is_not_open() -> void:
	assert_true(await start())
	var stranger: Control = Control.new()
	add_child_autofree(stranger)
	await UICore.close_popup(stranger)
	assert_eq(warns(), 1)
	var call: CALL = CALL.new()
	call.open_popup(POPUP_TWEEN)
	await finish(call)
	var popup: UIPopup = popup_of(POPUP_TWEEN)
	UICore.close_popup(popup)
	await UICore.close_popup(popup)
	assert_eq(warns(), 1, "a popup that is closing")
	await advance(TWEEN_MS * 2)


func test_hide_loading_icon_without_request() -> void:
	assert_true(await start())
	var token: int = UICore.show_loading_icon()
	UICore.hide_loading_icon(token + 100)
	assert_eq(errors(), 1)
	assert_true(UICore._loading_icon.visible, "the icon stays")
	UICore.hide_loading_icon(token)


func test_view_focus_element_without_ui_button() -> void:
	assert_true(await start())
	var plain: Control = Control.new()
	UICore.get_layer(UICore.UILayer.CUTSCENE).add_child(plain)
	var button: Button = add_button(UICore.UILayer.CUTSCENE, "b")
	UICore.set_view_focus(UICore.FocusView.CUTSCENE, [plain, button] as Array[Control], null, Callable())
	assert_eq(errors(), 1)
	assert_eq(UICore._cutscene_view.elements, [button] as Array[Control], "the element is not put in")


func test_callback_that_cannot_be_called() -> void:
	assert_true(await start())
	var holder: Node = Node.new()
	add_child(holder)
	var gone: Callable = holder.queue_free
	holder.free()
	assert_true(await UICore.open_popup(POPUP_A, null, gone) == UICore.PopupOpenResult.OPENED)
	await UICore.close_popup(popup_of(POPUP_A))
	assert_eq(errors(), 1, "the hidden callback is not called")
