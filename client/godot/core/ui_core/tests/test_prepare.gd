extends "res://core/ui_core/tests/support/ui_test_case.gd"
## `prepare` and the code made dim, loading icon and system popup.


func test_code_made_elements_with_empty_keys() -> void:
	assert_true(await start())
	assert_true(UICore._loading_icon_code_made)
	var token: int = UICore.show_loading_icon()
	assert_true(UICore._loading_icon.visible, "code made loading icon")
	UICore.hide_loading_icon(token)
	assert_true(await UICore.open_popup(POPUP_DIM_A, null, Callable()) == UICore.PopupOpenResult.OPENED)
	assert_true(UICore._popup_dim is ColorRect and UICore._popup_dim.visible, "code made dim")
	assert_true(await UICore.open_system_popup(one_button_param(), Callable()))
	assert_null(UICore._system_popup_scene)
	assert_true(system_popup() is Panel and system_popup().scene_file_path.is_empty(), "code made system popup")


func test_failed_resources_fall_back_to_code_made() -> void:
	set_string("UICore.dimResource", MISSING)
	set_string("UICore.loadingIconResource", NODE_ROOT)
	set_string("UICore.systemPopupResource", FRAME)
	assert_true(await start(true, false, false))
	assert_false(await UICore.prepare())
	assert_eq(errors(), 2, "one per failed resource")
	assert_eq(UnitTestCore.check_logs(ERROR, "ResourceCore"), 1, "the missing key")
	assert_true(ResourceCore.is_loaded(FRAME, ResourceCore.BaseKind.PACKED_SCENE), "the system popup prefab")
	assert_true(ResourceCore.is_loaded(CLICK, ResourceCore.BaseKind.AUDIO_STREAM), "[ui_button_click]")
	assert_true(UICore._loading_icon_code_made, "code made loading icon")
	assert_true(await UICore.open_popup(POPUP_DIM_A, null, Callable()) == UICore.PopupOpenResult.OPENED)
	assert_true(UICore._popup_dim is ColorRect and UICore._popup_dim.visible, "code made dim")
	var token: int = UICore.show_loading_icon()
	assert_true(UICore._loading_icon.visible)
	UICore.hide_loading_icon(token)
	assert_true(await UICore.open_system_popup(one_button_param(), Callable()))
	assert_eq(system_popup().scene_file_path, RESOURCES + "test_frame.tscn", "the loaded system popup")


func test_prefab_dim_and_icon() -> void:
	set_string("UICore.dimResource", NOT_PANEL)
	set_string("UICore.loadingIconResource", NOT_PANEL)
	assert_true(await start())
	assert_false(UICore._loading_icon_code_made)
	assert_eq(UICore._loading_icon.scene_file_path, RESOURCES + "test_not_panel.tscn")
	assert_eq(UICore._popup_dim.scene_file_path, RESOURCES + "test_not_panel.tscn")


func test_operations_before_prepare_ends() -> void:
	assert_true(await start(true, false))
	assert_false(await UICore.open_root_panel(PANEL_R))
	assert_false(await UICore.open_panel(PANEL_A, null, false))
	assert_false(await UICore.open_panels([UIPanelRequest.new()] as Array[UIPanelRequest]))
	assert_eq(await UICore.open_popup(POPUP_A, null, Callable()), UICore.PopupOpenResult.FAILED)
	assert_false(await UICore.open_system_popup(one_button_param(), Callable()))
	assert_eq(UICore.show_loading_icon(), 0)
	assert_eq(errors(), 6)
	assert_true(await UICore.prepare())
	assert_true(await UICore.open_panel(PANEL_A, null, false), "a finished prepare lifts the limit")
