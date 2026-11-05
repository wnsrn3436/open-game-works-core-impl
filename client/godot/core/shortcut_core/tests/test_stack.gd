extends "res://core/shortcut_core/tests/support/shortcut_case.gd"
## The applied stack: where the panel path opens, the clear stack of the open, and the panel stack at the end.


func test_root_in_the_current_scene_closes_popups_and_opens_the_panel_on_the_root() -> void:
	assert_true(await start_at(SCENE_ROOT, PackedStringArray([PANEL_A, PANEL_B])))
	await open_popups(2)
	assert_eq(UICore.get_open_popup_count(), 2)
	assert_true(await ShortcutCore.navigate(shortcut("root_c")))
	assert_eq(Trace.with_prefix("scene_ended:").size(), 0)
	assert_eq(Trace.count("popup_hidden"), 2)
	assert_eq(UICore.get_open_popup_count(), 0)
	assert_eq(flows(), PackedStringArray(["flow:close:r:true", "flow:open:c:true"]))
	assert_eq(stack(), "r,c")


func test_root_with_several_panels_opens_them_with_one_open_panels() -> void:
	assert_true(await start_at(SCENE_ROOT, PackedStringArray([PANEL_A])))
	assert_true(await ShortcutCore.navigate(shortcut("root_bcd")))
	assert_eq(flows(), PackedStringArray(["flow:close:r:true", "flow:open:d:true"]))
	assert_eq(Trace.with_prefix("opened:"), PackedStringArray(["opened:r", "opened:d"]))
	assert_eq(stack(), "r,b,c,d")


func test_top_in_the_current_scene_opens_on_the_stack_without_clear_stack() -> void:
	assert_true(await start_at(SCENE_ROOT, PackedStringArray([PANEL_A])))
	assert_true(await ShortcutCore.navigate(shortcut("top_b")))
	assert_eq(flows(), PackedStringArray(["flow:open:b:true"]))
	assert_true(Trace.has("closed:a:covered"))
	assert_eq(stack(), "r,a,b")
	Trace.clear()
	assert_true(await UICore.close_panel())
	Trace.clear()
	assert_true(await ShortcutCore.navigate(shortcut("top_bc")))
	assert_eq(flows(), PackedStringArray(["flow:open:c:true"]))
	assert_eq(Trace.with_prefix("opened:"), PackedStringArray(["opened:c"]))
	assert_eq(stack(), "r,a,b,c")


func test_top_to_another_scene_makes_the_same_calls_as_root() -> void:
	assert_true(await start_at(SCENE_ROOT, PackedStringArray([PANEL_A])))
	TestScene.start_panel = PANEL_X
	assert_true(await ShortcutCore.navigate(shortcut("change_bc")))
	assert_eq(stack(), "r,b,c")
	var root_trace: PackedStringArray = PackedStringArray(Trace.entries)
	Trace.clear()
	TestScene.start_panel = ""
	assert_true(await SceneCore.change_scene(SCENE_ROOT, null))
	assert_true(await UICore.open_panel(PANEL_A, null, false))
	TestScene.start_panel = PANEL_X
	Trace.clear()
	assert_true(await ShortcutCore.navigate(shortcut("change_top_bc")))
	assert_eq(stack(), "r,b,c")
	var top_trace: PackedStringArray = PackedStringArray(Trace.entries)
	root_trace.remove_at(root_trace.size() - 1)
	top_trace.remove_at(top_trace.size() - 1)
	assert_eq(top_trace, root_trace)
	assert_true(top_trace.has("flow:close:r:true"))
	Trace.clear()
	TestScene.start_panel = ""
	assert_true(await SceneCore.change_scene(SCENE_ROOT, null))
	assert_true(await UICore.open_panel(PANEL_A, null, false))
	Trace.clear()
	assert_true(await ShortcutCore.navigate(shortcut("change_top_b")))
	assert_eq(stack(), "r,b")


func test_root_in_a_scene_without_a_root_panel_opens_with_clear_stack() -> void:
	assert_true(await start_at(SCENE_PLAIN, PackedStringArray([PANEL_A])))
	assert_true(await ShortcutCore.navigate(shortcut("plain_b")))
	assert_eq(flows(), PackedStringArray(["flow:open:b:true"]))
	assert_true(Trace.has("closed:a:closed"))
	assert_eq(stack(), "b")
	assert_true(await UICore.open_panel(PANEL_A, null, false))
	assert_eq(stack(), "b,a")
	Trace.clear()
	assert_true(await ShortcutCore.navigate(shortcut("plain_bc")))
	assert_eq(flows(), PackedStringArray(["flow:open:c:true"]))
	assert_eq(stack(), "b,c")


func test_root_with_only_the_root_panel_opens_no_panel() -> void:
	assert_true(await start_at(SCENE_ROOT, PackedStringArray([PANEL_A])))
	assert_true(await ShortcutCore.navigate(shortcut("root_r")))
	assert_eq(flows(), PackedStringArray(["flow:close:r:true"]))
	assert_eq(stack(), "r")


## Content code pushed another item with the root panel key above the root item (stack R, A, R, B, R). `Root` still
## ends with the panel path on top of the root item, or with the root item alone.
func test_root_with_root_key_items_above_the_root_item_goes_back_to_the_root_item() -> void:
	var stacked: PackedStringArray = PackedStringArray([PANEL_A, PANEL_R, PANEL_B, PANEL_R])
	assert_true(await start_at(SCENE_ROOT, stacked))
	assert_eq(stack(), "r,a,r,b,r")
	assert_true(await ShortcutCore.navigate(shortcut("root_c")))
	assert_eq(stack(), "r,c")
	assert_eq(Trace.count("flow:open:c:true"), 1)
	assert_eq(Trace.with_prefix("flow:open:").size(), 1)
	assert_true(await ShortcutCore.navigate(shortcut("top_b")))
	assert_true(await UICore.open_panel(PANEL_R, null, false))
	assert_eq(stack(), "r,c,b,r")
	Trace.clear()
	assert_true(await ShortcutCore.navigate(shortcut("root_r")))
	assert_eq(stack(), "r")
	assert_eq(Trace.with_prefix("flow:open:").size(), 0)
	assert_true(await UICore.open_panel(PANEL_A, null, false))
	assert_true(await UICore.open_panel(PANEL_R, null, false))
	Trace.clear()
	var id: int = shortcut("root_empty")
	assert_true(await ShortcutCore.navigate(id))
	assert_eq(stack(), "r")
	assert_eq(probe.navigated_ids[probe.navigated_ids.size() - 1], id)


## Going back below a root key item above the root item fails when the panel below it cannot show again: stage 7
## stops, nothing opens and the stack keeps what was not closed.
func test_root_stops_when_going_back_below_a_root_key_item_fails() -> void:
	assert_true(await start_at(SCENE_ROOT, PackedStringArray([PANEL_A, PANEL_R])))
	TestPanel.returned_gate = Gate.new()
	navigate_later(shortcut("root_c"))
	await wait_trace("panel_gated:a")
	TestPanel.returned_gate.open(false)
	await UnitTestCore.wait_frames(3)
	assert_eq(results, PackedInt32Array([0]))
	assert_eq(Trace.with_prefix("flow:open:").size(), 0)
	assert_eq(stack(), "r,a,r")
	assert_eq(probe.navigated_ids.size(), 0)


## The scene changes at stage 6 into a scene without a root panel, so `Top` acts as `Root`: no `close_panels_to`, and
## clear stack of the open is on, which also closes the panel the new scene's `on_start` opened.
func test_top_into_a_scene_without_a_root_panel_opens_with_clear_stack() -> void:
	assert_true(await start_at(SCENE_ROOT, PackedStringArray([PANEL_A])))
	TestScene.start_panel = PANEL_X
	var id: int = shortcut("plain_top_b")
	assert_true(await ShortcutCore.navigate(id))
	assert_in_order(PackedStringArray(["scene_start:plain", "start_panel:x:true", "flow:open:b:true", "navigated:%d" % id]))
	assert_eq(flows(), PackedStringArray(["flow:open:x:true", "flow:open:b:true"]))
	assert_true(Trace.has("closed:x:closed"))
	assert_eq(stack(), "b")
	TestScene.start_panel = ""
	assert_true(await SceneCore.change_scene(SCENE_ROOT, null))
	assert_true(await UICore.open_panel(PANEL_A, null, false))
	TestScene.start_panel = PANEL_X
	Trace.clear()
	assert_true(await ShortcutCore.navigate(shortcut("plain_top_bc")))
	assert_eq(flows(), PackedStringArray(["flow:open:x:true", "flow:open:c:true"]))
	assert_eq(Trace.with_prefix("opened:"), PackedStringArray(["opened:x", "opened:c"]))
	assert_true(Trace.has("closed:x:closed"))
	assert_eq(stack(), "b,c")


## The scene changes at stage 6 into a scene without a root panel with `Root`: clear stack is on.
func test_root_into_a_scene_without_a_root_panel_opens_with_clear_stack() -> void:
	assert_true(await start_at(SCENE_ROOT, PackedStringArray([PANEL_A])))
	TestScene.start_panel = PANEL_X
	assert_true(await ShortcutCore.navigate(shortcut("plain_b")))
	assert_eq(flows(), PackedStringArray(["flow:open:x:true", "flow:open:b:true"]))
	assert_true(Trace.has("closed:x:closed"))
	assert_eq(stack(), "b")
