extends "res://core/qa_core/tests/support/qa_test_case.gd"
## `list_ui`: visible elements without the debug layer, text and its clipping and size, owners, modal cover, buttons
## and their gamepad action, text input elements and focus; `set_input_device` and `focus_ui`.

const ADVANCE: String = "cutscene_advance"


func open_panel() -> void:
	assert_true(await UICore.open_panel(PANEL, null, false))
	await UnitTestCore.wait_frames(2)


func test_visible_elements_text_and_owners() -> void:
	assert_true(await start())
	await run_ok("set_stats_visible", PackedStringArray(["true"]))
	await open_panel()
	var list: String = await run_ok("list_ui")
	assert_eq(element_index(list, "Hidden"), -1, "a hidden element is left out")
	for i: int in JSONR.count(list, ""):
		assert_false(JSONR.text(list, "%d.path" % i).contains("QACoreDebug"), "the debug layer is left out")
	assert_true(JSONR.boolean(list, "%d.clipped" % element_index(list, "Overflow")), "overflowing text")
	assert_false(JSONR.boolean(list, "%d.clipped" % element_index(list, "Small")))
	var small: float = JSONR.number(list, "%d.font_size" % element_index(list, "Small"))
	var big: float = JSONR.number(list, "%d.font_size" % element_index(list, "Big"))
	assert_true(small > 0.0 and big > small, "a larger font gives a larger font_size")
	assert_eq(JSONR.text(list, "%d.text" % element_index(list, "Small")), "Small")
	assert_eq(JSONR.text(list, "%d.owner" % element_index(list, "Small")), PANEL, "inside the panel")
	assert_eq(JSONR.text(list, "%d.owner" % element_index(list, "SceneLabel")), SCENE, "outside panels")
	assert_eq(JSONR.text(list, "%d.anchor" % element_index(list, "Go")), "qa_go")
	assert_eq(JSONR.integer(list, "%d.anchor_key" % element_index(list, "Go")), 0)
	var go: int = element_index(list, "Go")
	var panel: int = element_index(list, "QaTestPanel")
	assert_true(panel >= 0 and JSONR.text(list, "%d.path" % go).begins_with(JSONR.text(list, "%d.path" % panel) + "/"),
		"an ancestor's path and a slash begin the path")
	assert_eq(JSONR.integer(list, "%d.font_size" % panel), 0, "no text, font_size 0")


func test_visibility_clipping_scale_and_markup() -> void:
	assert_true(await start())
	var layer: CanvasLayer = UICore.get_layer(UICore.UILayer.SCENE_UI)
	var hidden_parent: Control = Control.new()
	hidden_parent.name = "HiddenParent"
	hidden_parent.visible = false
	layer.add_child(hidden_parent)
	hidden_parent.add_child(new_label("UnderHidden", "Under a hidden ancestor", Vector2(100, 100)))
	var lines: Label = new_label("Lines", "one\ntwo\nthree", Vector2(100, 150))
	lines.max_lines_visible = 1
	layer.add_child(lines)
	var clipper: Control = Control.new()
	clipper.name = "Clipper"
	clipper.clip_contents = true
	clipper.position = Vector2(400, 150)
	clipper.size = Vector2(20, 20)
	layer.add_child(clipper)
	clipper.add_child(new_label("ClippedByAncestor", "Cut by the ancestor", Vector2.ZERO))
	layer.add_child(new_label("OffWindow", "Outside the window", Vector2(5000, 5000)))
	var multi_line: TextEdit = TextEdit.new()
	multi_line.name = "MultiLine"
	var text_lines: PackedStringArray = PackedStringArray()
	for i: int in 40:
		text_lines.append("line %d" % i)
	multi_line.text = "\n".join(text_lines)
	multi_line.position = Vector2(100, 250)
	multi_line.size = Vector2(200, 60)
	layer.add_child(multi_line)
	var plain: Label = new_label("Plain", "Plain", Vector2(100, 350))
	plain.add_theme_font_size_override(&"font_size", 20)
	layer.add_child(plain)
	var scaled: Label = new_label("Scaled", "Scaled", Vector2(100, 400))
	scaled.add_theme_font_size_override(&"font_size", 20)
	scaled.scale = Vector2(2, 2)
	layer.add_child(scaled)
	var rich: RichTextLabel = RichTextLabel.new()
	rich.name = "Rich"
	rich.bbcode_enabled = true
	rich.text = "[b]Bold[/b] and [color=red]red[/color]"
	rich.position = Vector2(100, 500)
	rich.size = Vector2(400, 40)
	layer.add_child(rich)
	await open_panel()
	assert_eq(await UICore.open_popup(POPUP, null, Callable()), UICore.PopupOpenResult.OPENED)
	await UnitTestCore.wait_frames(2)
	var list: String = await run_ok("list_ui")
	assert_eq(element_index(list, "UnderHidden"), -1, "an element under a hidden ancestor is left out")
	assert_eq(element_index(list, "HiddenParent"), -1)
	assert_true(JSONR.boolean(list, "%d.modal_covered" % element_index(list, "Go")), "a modal covered element is in")
	assert_true(JSONR.boolean(list, "%d.clipped" % element_index(list, "Lines")), "lines over the visible line count")
	assert_true(JSONR.boolean(list, "%d.clipped" % element_index(list, "Overflow")), "one line wider than its rect")
	assert_false(JSONR.boolean(list, "%d.clipped" % element_index(list, "ClippedByAncestor")), "the clip of an ancestor")
	assert_false(JSONR.boolean(list, "%d.clipped" % element_index(list, "OffWindow")), "outside the window")
	assert_false(JSONR.boolean(list, "%d.clipped" % element_index(list, "MultiLine")), "a multi-line text input scrolls")
	var plain_size: float = JSONR.number(list, "%d.font_size" % element_index(list, "Plain"))
	var scaled_size: float = JSONR.number(list, "%d.font_size" % element_index(list, "Scaled"))
	assert_true(plain_size > 0.0)
	assert_almost_eq(scaled_size, plain_size * 2.0, 0.01, "a vertical scale of 2 doubles font_size")
	assert_eq(JSONR.text(list, "%d.text" % element_index(list, "Rich")), "Bold and red", "rich text without markup")


func test_system_popup_owner() -> void:
	assert_true(await start())
	await open_panel()
	var param: SystemPopupParam = SystemPopupParam.new()
	param.body = ReservedString.network_error_general()
	var button: SystemPopupButton = SystemPopupButton.new()
	button.label = ReservedString.network_confirm()
	param.buttons.append(button)
	assert_true(await UICore.open_system_popup(param, Callable()))
	await UnitTestCore.wait_frames(2)
	var list: String = await run_ok("list_ui")
	var inside: int = 0
	for i: int in JSONR.count(list, ""):
		var path: String = JSONR.text(list, "%d.path" % i)
		var marker: int = path.find("/SystemPopupRoot/")
		if marker >= 0 and path.substr(marker + "/SystemPopupRoot/".length()).contains("/"):
			inside += 1
			assert_eq(JSONR.text(list, "%d.owner" % i), "system_popup_0", path)
	assert_true(inside >= 1, "the system popup has visible elements")
	assert_eq(JSONR.text(list, "%d.owner" % element_index(list, "Go")), PANEL, "a panel element under it")


func new_label(label_name: String, text: String, position: Vector2) -> Label:
	var label: Label = Label.new()
	label.name = label_name
	label.text = text
	label.position = position
	return label


func test_modal_cover_buttons_and_text_input() -> void:
	assert_true(await start())
	await open_panel()
	var plain: Button = add_button("plain", Vector2(100, 600))
	var action: Button = add_button("action", Vector2(300, 600))
	(action.get_child(0) as UIButton).action = ADVANCE
	var unbound: Button = add_button("unbound", Vector2(500, 600))
	(unbound.get_child(0) as UIButton).action = "qa_no_such_action"
	var label: Label = Label.new()
	label.name = "NoButton"
	label.text = "No button"
	label.position = Vector2(700, 600)
	UICore.get_layer(UICore.UILayer.SCENE_UI).add_child(label)
	await UnitTestCore.wait_frames(1)
	var list: String = await run_ok("list_ui")
	assert_true(JSONR.boolean(list, "%d.button" % element_index(list, "Plain")))
	assert_false(JSONR.boolean(list, "%d.pad_action" % element_index(list, "Plain")), "no action")
	assert_true(JSONR.boolean(list, "%d.pad_action" % element_index(list, "Action")), "an action with a gamepad binding")
	assert_false(JSONR.boolean(list, "%d.pad_action" % element_index(list, "Unbound")), "an action that has no gamepad binding")
	assert_false(JSONR.boolean(list, "%d.button" % element_index(list, "NoButton")))
	assert_false(JSONR.boolean(list, "%d.pad_action" % element_index(list, "NoButton")))
	var input: int = element_index(list, "Input")
	await run_ok("tap", center_args(JSONR.rect(list, "%d.rect" % input)))
	await UnitTestCore.wait_frames(1)
	list = await run_ok("list_ui")
	input = element_index(list, "Input")
	assert_true(JSONR.boolean(list, "%d.text_input" % input), "a LineEdit is a text input element")
	assert_true(JSONR.boolean(list, "%d.focused" % input), "the tapped text input element has the focus")
	assert_eq(await UICore.open_popup(POPUP, null, Callable()), UICore.PopupOpenResult.OPENED)
	await UnitTestCore.wait_frames(2)
	list = await run_ok("list_ui")
	assert_true(JSONR.boolean(list, "%d.modal_covered" % element_index(list, "Go")), "a panel button under the popup")
	assert_false(JSONR.boolean(list, "%d.modal_covered" % element_index(list, "Ok")), "the popup button")
	assert_eq(JSONR.text(list, "%d.owner" % element_index(list, "Ok")), POPUP)


func test_gamepad_focus() -> void:
	assert_true(await start())
	await open_panel()
	assert_eq(await UICore.open_popup(POPUP, null, Callable()), UICore.PopupOpenResult.OPENED)
	await UnitTestCore.wait_frames(2)
	await run_ok("set_input_device", PackedStringArray(["Gamepad"]))
	assert_eq(InputCore.get_device(), InputCore.InputDevice.GAMEPAD)
	var list: String = await run_ok("list_ui")
	assert_eq(focused_paths(list).size(), 1, "one focused element")
	assert_true(focused_paths(list)[0].ends_with("/Ok"), "the focus element of the top modal popup")
	assert_false((await run("set_input_device", PackedStringArray(["gamepad"]))).ok)
	var ok_path: String = JSONR.text(list, "%d.path" % element_index(list, "Ok"))
	await run_ok("focus_ui", PackedStringArray([ok_path]))
	list = await run_ok("list_ui")
	assert_eq(focused_paths(list), PackedStringArray([ok_path]))
	var go_path: String = JSONR.text(list, "%d.path" % element_index(list, "Go"))
	assert_false((await run("focus_ui", PackedStringArray([go_path]))).ok, "outside the focus target")
	assert_false((await run("focus_ui", PackedStringArray(["no/such/path"]))).ok, "no element")
	assert_eq(warns(), 3)


func focused_paths(list: String) -> PackedStringArray:
	var paths: PackedStringArray = PackedStringArray()
	for i: int in JSONR.count(list, ""):
		if JSONR.boolean(list, "%d.focused" % i):
			paths.append(JSONR.text(list, "%d.path" % i))
	return paths
