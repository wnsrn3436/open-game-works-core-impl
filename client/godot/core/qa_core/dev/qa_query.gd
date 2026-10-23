extends RefCounted
## What `QACore` reads from the other modules and the engine: QAState, stats and the visible UI elements. Every read
## checks that the module is initialized first, so a read before a value is decided leaves no error log.

const _JSON := preload("res://core/qa_core/dev/qa_json.gd")
## Script of the content `UICore` makes in every system popup instance.
const _SYSTEM_VIEW_PATH: String = "res://core/ui_core/system_popup_view.gd"

const BOOT_STAGE_NAMES: PackedStringArray = [
	"None", "InitModules", "LoadData", "Prepare", "TitleScene", "Update", "ApplyUpdate", "ContentInit", "Login",
	"AfterLogin", "FirstScene", "Done", "Halted",
]
## Boot stages from which QAState reads `language`.
const _LANGUAGE_STAGES: PackedInt32Array = [
	BootstrapCore.BootStage.PREPARE, BootstrapCore.BootStage.TITLE_SCENE, BootstrapCore.BootStage.UPDATE,
	BootstrapCore.BootStage.APPLY_UPDATE, BootstrapCore.BootStage.CONTENT_INIT, BootstrapCore.BootStage.LOGIN,
	BootstrapCore.BootStage.AFTER_LOGIN, BootstrapCore.BootStage.FIRST_SCENE, BootstrapCore.BootStage.DONE,
]
## Room for the gamepad button binding of one action.
const _PAD_BINDING_ROOM: int = 64
const _BYTES_PER_MB: float = 1048576.0
const MATCH_STATE_NAMES: PackedStringArray = ["None", "Matching", "Connecting", "Playing"]
const PEER_STATE_NAMES: PackedStringArray = ["Waiting", "Connected", "Disconnected", "Left"]
const QUALITY_LEVEL_NAMES: PackedStringArray = ["Low", "Medium", "High"]
const REQUEST_KIND_NAMES: PackedStringArray = ["Interaction", "Retry", "Silent", "SilentRetry"]
const SCOPE_KIND_NAMES: PackedStringArray = ["Global", "Scene", "Panel", "Popup", "Owner"]
const SOUND_BUS_NAMES: PackedStringArray = ["Master", "Bgm", "Sfx", "Voice", "Ui"]
const HAPTIC_TARGET_NAMES: PackedStringArray = ["Device", "Gamepad"]
const _MS_PER_S: float = 1000.0
const _SYSTEM_POPUP_OWNER: String = "system_popup_%d"


# --- QAState ---


static func state_json() -> String:
	var info: BuildInfo = BootstrapCore.get_build_info()
	var stage: BootstrapCore.BootStage = BootstrapCore.boot_stage()
	var pairs: PackedStringArray = PackedStringArray([
		_JSON.pair("app_version", _JSON.text(info.app_version)),
		_JSON.pair("environment", _JSON.text(info.environment)),
		_JSON.pair("platform", _JSON.text(info.platform)),
		_JSON.pair("data_version", _JSON.text(DataCore.get_data_version() if _data_loaded() else "")),
		_JSON.pair("user_id", _JSON.integer(AuthCore.get_user_id() if _logged_in() else 0)),
		_JSON.pair("server_time", _JSON.integer(TimeCore.get_server_time() if _synced() else 0)),
		_JSON.pair("boot_stage", _JSON.text(_name_of(BOOT_STAGE_NAMES, stage))),
		_JSON.pair("scene_key", _JSON.text(SceneCore.current_scene_key() if SceneCore.is_initialized() else "")),
		_JSON.pair("in_transition", _JSON.boolean(SceneCore.is_initialized() and SceneCore.is_transitioning())),
		_JSON.pair("panels", _JSON.strings(UICore.get_panel_stack() if UICore.is_initialized() else PackedStringArray())),
		_JSON.pair("popups", _JSON.strings(UICore.get_open_popups() if UICore.is_initialized() else PackedStringArray())),
		_JSON.pair("input_blocks", _input_blocks_json()),
		_JSON.pair("language", _JSON.text(_language(stage))),
		_JSON.pair("time_scale", _JSON.integer(TimeCore.get_time_scale() if TimeCore.is_initialized() else 1000)),
		_JSON.pair("step_mode", _JSON.boolean(TimeCore.is_initialized() and TimeCoreDev.is_step_mode())),
		_JSON.pair("step_budget_ms", _JSON.integer(TimeCoreDev.get_step_budget() if TimeCore.is_initialized() else 0)),
		_JSON.pair("window_size", _JSON.size(ResolutionCore.get_window_size() if ResolutionCore.is_initialized() else Vector2i.ZERO)),
		_JSON.pair("game_area", _JSON.rect(_window_rect(ResolutionCore.get_game_area() if ResolutionCore.is_initialized() else Rect2()))),
		_JSON.pair("visible_game_area", _JSON.rect(_window_rect(ResolutionCore.get_visible_game_area() if ResolutionCore.is_initialized() else Rect2()))),
		_JSON.pair("safe_area", _JSON.rect(_window_rect(SafeAreaCore.get_safe_area() if SafeAreaCore.is_initialized() else Rect2()))),
		_JSON.pair("cutscene_playing", _JSON.boolean(CutsceneCore.is_playing()) if CutsceneCore.is_initialized() else _JSON.NULL),
		_JSON.pair("tutorial", _tutorial_json()),
		_JSON.pair("completed_tutorials", _completed_tutorials_json()),
		_JSON.pair("match_state", _JSON.text(_name_of(MATCH_STATE_NAMES, RealtimeCore.match_state())) if RealtimeCore.is_initialized() else _JSON.NULL),
	])
	if RealtimeCore.is_initialized():
		var room: RoomInfo = RealtimeCore.room_info()
		pairs.append(_JSON.pair("room_code", _JSON.text(room.room_code)))
		pairs.append(_JSON.pair("room_mode_id", _JSON.integer(room.mode_id)))
		pairs.append(_JSON.pair("room_mode", _JSON.text(GameDataDev.find_id_name(room.mode_id) if room.mode_id != 0 else "")))
	else:
		pairs.append(_JSON.pair("room_code", _JSON.NULL))
		pairs.append(_JSON.pair("room_mode_id", _JSON.NULL))
		pairs.append(_JSON.pair("room_mode", _JSON.NULL))
	pairs.append(_JSON.pair("content", QACore._content_json()))
	pairs.append(_JSON.pair("invariant_failures", _JSON.strings(QACore._invariant_failures)))
	pairs.append(_JSON.pair("softlock", QACore._softlock_json()))
	return _JSON.object(pairs)


static func _data_loaded() -> bool:
	return DataCore.is_initialized() and DataCore.is_loaded()


static func _logged_in() -> bool:
	return AuthCore.is_initialized() and AuthCore.is_logged_in()


static func _synced() -> bool:
	return TimeCore.is_initialized() and TimeCore.is_synced()


static func _language(stage: BootstrapCore.BootStage) -> String:
	if not stage in _LANGUAGE_STAGES or not LocalizationCore.is_initialized():
		return ""
	return LocalizationCore.get_language_code()


static func _input_blocks_json() -> String:
	var items: PackedStringArray = PackedStringArray()
	if not InputBlockCore.is_initialized():
		return _JSON.array(items)
	var blocks: Array[ActiveBlockInfo] = []
	blocks.resize(InputBlockCoreDev.count_active())
	var count: int = InputBlockCoreDev.list_active(blocks)
	for i: int in count:
		var block: ActiveBlockInfo = blocks[i]
		items.append(_JSON.object(PackedStringArray([
			_JSON.pair("reason", _JSON.text(block.reason)),
			_JSON.pair("caller_location", _JSON.text(block.caller_location)),
			_JSON.pair("elapsed_ms", _JSON.integer(block.elapsed_ms)),
		])))
	return _JSON.array(items)


static func _tutorial_json() -> String:
	if not TutorialCore.is_initialized():
		return _JSON.NULL
	var current: CurrentResult = TutorialCore.current()
	if current.tutorial_id == 0 and current.step == 0:
		return _JSON.NULL
	return _JSON.object(PackedStringArray([
		_JSON.pair("id", _JSON.text(GameDataDev.find_id_name(current.tutorial_id))),
		_JSON.pair("step", _JSON.integer(current.step)),
	]))


static func _completed_tutorials_json() -> String:
	if not TutorialCore.is_initialized():
		return _JSON.NULL
	var pairs: PackedStringArray = PackedStringArray()
	for row: GameData.TutorialRow in GameData.TutorialTable.all_rows():
		if TutorialCore.is_completed(row.id):
			pairs.append(_JSON.pair(GameDataDev.find_id_name(row.id), _JSON.boolean(true)))
	return _JSON.object(pairs)


static func _name_of(names: PackedStringArray, value: int) -> String:
	return names[value] if value >= 0 and value < names.size() else ""


## A game coordinates rectangle in window pixels.
static func _window_rect(game_rect: Rect2) -> Rect2:
	if not ResolutionCore.is_initialized():
		return Rect2()
	var start: Vector2 = ResolutionCore.game_to_window(game_rect.position)
	var end: Vector2 = ResolutionCore.game_to_window(game_rect.end)
	return Rect2(start, end - start)


# --- stats ---


## Stats. A headless run draws nothing, so its stats of drawing are 0.
static func stats_json() -> String:
	var drawn: bool = not QACore.is_headless()
	return _JSON.object(PackedStringArray([
		_JSON.pair("fps", _JSON.number(Performance.get_monitor(Performance.TIME_FPS))),
		_JSON.pair("frame_ms", _JSON.number(Performance.get_monitor(Performance.TIME_PROCESS) * _MS_PER_S)),
		_JSON.pair("static_memory_bytes", _JSON.integer(int(Performance.get_monitor(Performance.MEMORY_STATIC)))),
		_JSON.pair("video_memory_bytes", _JSON.integer(_drawn_monitor(drawn, Performance.RENDER_VIDEO_MEM_USED))),
		_JSON.pair("draw_calls", _JSON.integer(_drawn_monitor(drawn, Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME))),
		_JSON.pair("primitives", _JSON.integer(_drawn_monitor(drawn, Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME))),
		_JSON.pair("object_count", _JSON.integer(int(Performance.get_monitor(Performance.OBJECT_COUNT)))),
		_JSON.pair("last_scene_load_ms", _JSON.integer(QACore._last_scene_load_ms)),
		_JSON.pair("boot_ms", _JSON.integer(QACore._boot_ms)),
		_JSON.pair("quality_level", _JSON.text(quality_level_name())),
	]))


static func _drawn_monitor(drawn: bool, monitor: Performance.Monitor) -> int:
	return int(Performance.get_monitor(monitor)) if drawn else 0


## Element name of `QualityCore.get_level`; empty when `QualityCore` is not in the module list.
static func quality_level_name() -> String:
	if not QualityCore.is_initialized():
		return ""
	return _name_of(QUALITY_LEVEL_NAMES, QualityCore.get_level())


## Stats display text of the debug layer.
static func stats_text() -> String:
	return "fps %d  frame %.1f ms  draw %d  objects %d  memory %.1f MB" % [
		int(Performance.get_monitor(Performance.TIME_FPS)),
		Performance.get_monitor(Performance.TIME_PROCESS) * _MS_PER_S,
		int(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)),
		int(Performance.get_monitor(Performance.OBJECT_COUNT)),
		Performance.get_monitor(Performance.MEMORY_STATIC) / _BYTES_PER_MB,
	]


# --- visible UI elements ---


## Visible UI elements (`Control`s) in tree order, without the debug layer.
static func visible_elements() -> Array[Control]:
	var elements: Array[Control] = []
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree == null:
		return elements
	var debug_layer: CanvasLayer = UICore.get_layer(UICore.UILayer.DEBUG) if UICore.is_initialized() else null
	_collect(tree.root, debug_layer, elements)
	return elements


static func _collect(node: Node, debug_layer: CanvasLayer, elements: Array[Control]) -> void:
	for child: Node in node.get_children():
		if child == debug_layer or child is Viewport:
			continue
		if child is CanvasLayer and not (child as CanvasLayer).visible:
			continue
		if child is CanvasItem and not (child as CanvasItem).is_visible_in_tree():
			continue
		if child is Control:
			elements.append(child as Control)
		_collect(child, debug_layer, elements)


## Path of `element` from the root of the tree, `/` between names.
static func path_of(element: Node) -> String:
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree == null:
		return ""
	return str(tree.root.get_path_to(element))


## The visible UI element at `path`; `null` when there is none.
static func element_at(path: String) -> Control:
	for element: Control in visible_elements():
		if path_of(element) == path:
			return element
	return null


## Window pixel rectangle of `element`.
static func element_rect(element: Control) -> Rect2:
	var transform: Transform2D = element.get_global_transform_with_canvas()
	var game_rect: Rect2 = transform * Rect2(Vector2.ZERO, element.size)
	return _window_rect(game_rect)


static func list_ui_json() -> String:
	var items: PackedStringArray = PackedStringArray()
	var focus: Control = _focus_owner()
	var scene_key: String = SceneCore.current_scene_key() if SceneCore.is_initialized() else ""
	var system_root: Control = _system_popup_root()
	var buttons: PackedStringArray = PackedStringArray()
	buttons.resize(_PAD_BINDING_ROOM)
	for element: Control in visible_elements():
		var text: String = _text_of(element)
		var ui_button: UIButton = _ui_button_of(element)
		var anchor: UIAnchor = _anchor_of(element)
		var pad_action: bool = false
		if ui_button != null and not ui_button.get_action().is_empty() and InputCore.is_initialized():
			var action: StringName = StringName(ui_button.get_action())
			pad_action = InputCore.has_action(action) and InputCore.get_pad_buttons(action, buttons) >= 1
		items.append(_JSON.object(PackedStringArray([
			_JSON.pair("path", _JSON.text(path_of(element))),
			_JSON.pair("rect", _JSON.rect(element_rect(element))),
			_JSON.pair("text", _JSON.text(text)),
			_JSON.pair("font_size", _JSON.number(_font_size(element) if not text.is_empty() else 0.0)),
			_JSON.pair("clipped", _JSON.boolean(not text.is_empty() and _is_clipped(element, text))),
			_JSON.pair("anchor", _JSON.text(anchor.anchor_name if anchor != null else "")),
			_JSON.pair("anchor_key", _JSON.integer(anchor.anchor_key if anchor != null else 0)),
			_JSON.pair("owner", _JSON.text(_owner_of(element, scene_key, system_root))),
			_JSON.pair("button", _JSON.boolean(ui_button != null)),
			_JSON.pair("pad_action", _JSON.boolean(pad_action)),
			_JSON.pair("modal_covered", _JSON.boolean(UICore.is_initialized() and UICore.is_modal_covered(element))),
			_JSON.pair("text_input", _JSON.boolean(is_text_input(element))),
			_JSON.pair("focused", _JSON.boolean(element == focus and (is_text_input(element) or ui_button != null))),
		])))
	return _JSON.array(items)


static func is_text_input(element: Control) -> bool:
	return element is LineEdit or element is TextEdit


static func _focus_owner() -> Control:
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	return tree.root.gui_get_focus_owner() if tree != null else null


static func _text_of(element: Control) -> String:
	if element is Label:
		return (element as Label).text
	if element is Button:
		return (element as Button).text
	if element is LineEdit:
		return (element as LineEdit).text
	if element is TextEdit:
		return (element as TextEdit).text
	if element is RichTextLabel:
		return (element as RichTextLabel).get_parsed_text()
	return ""


static func _font_size_name(element: Control) -> StringName:
	return &"normal_font_size" if element is RichTextLabel else &"font_size"


static func _font_name(element: Control) -> StringName:
	return &"normal_font" if element is RichTextLabel else &"font"


## Font size of the text of `element` in window pixels.
static func _font_size(element: Control) -> float:
	var size: float = float(element.get_theme_font_size(_font_size_name(element)))
	size *= element.get_global_transform_with_canvas().get_scale().y
	if not ResolutionCore.is_initialized():
		return size
	return ResolutionCore.game_to_window(Vector2(0.0, size)).y


## Whether the text of `element` is not fully shown.
static func _is_clipped(element: Control, text: String) -> bool:
	var font: Font = element.get_theme_font(_font_name(element))
	var font_size: int = element.get_theme_font_size(_font_size_name(element))
	if element is Label:
		var label: Label = element as Label
		if label.get_visible_line_count() < label.get_line_count():
			return true
		if label.visible_characters >= 0 and label.visible_characters < label.get_total_character_count():
			return true
		if label.autowrap_mode == TextServer.AUTOWRAP_OFF and font != null:
			var widest: float = 0.0
			for line: String in text.split("\n"):
				widest = maxf(widest, font.get_string_size(line, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size).x)
			return widest > label.size.x + 0.5
		return false
	if element is RichTextLabel:
		var rich: RichTextLabel = element as RichTextLabel
		if rich.visible_characters >= 0 and rich.visible_characters < rich.get_total_character_count():
			return true
		return not rich.fit_content and rich.get_content_height() > rich.size.y + 0.5
	if font == null:
		return false
	var width: float = font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size).x
	if element is Button:
		var button: Button = element as Button
		var style: StyleBox = button.get_theme_stylebox(&"normal")
		var room: float = button.size.x - (style.get_margin(SIDE_LEFT) + style.get_margin(SIDE_RIGHT) if style != null else 0.0)
		if button.icon != null:
			room -= button.icon.get_width() + button.get_theme_constant(&"h_separation")
		return width > room + 0.5
	if element is LineEdit:
		var line_edit: LineEdit = element as LineEdit
		var line_style: StyleBox = line_edit.get_theme_stylebox(&"normal")
		var line_room: float = line_edit.size.x - (line_style.get_margin(SIDE_LEFT) + line_style.get_margin(SIDE_RIGHT) if line_style != null else 0.0)
		return width > line_room + 0.5
	return false


static func _ui_button_of(element: Control) -> UIButton:
	for child: Node in element.get_children():
		if child is UIButton:
			return child as UIButton
	return null


static func _anchor_of(element: Control) -> UIAnchor:
	for child: Node in element.get_children():
		if child is UIAnchor:
			return child as UIAnchor
	return null


## Key of the nearest popup, panel or system popup holding `element`; `scene_key` when there is none. A system popup key
## counts the visible system popups from the bottom.
static func _owner_of(element: Control, scene_key: String, system_root: Control) -> String:
	var node: Node = element
	while node != null:
		if system_root != null and node.get_parent() == system_root and _is_system_popup(node):
			return _SYSTEM_POPUP_OWNER % _system_popup_index(system_root, node)
		if node is UIPopup:
			return (node as UIPopup).popup_key
		if node is UIPanel:
			return (node as UIPanel).panel_key
		node = node.get_parent()
	return scene_key


## The system popup root of `UICore`: the one element of its block pass list. `null` before `UICore.init`.
static func _system_popup_root() -> Control:
	if not UICore.is_initialized():
		return null
	var pass_list: BlockPassList = UICore.get_block_pass_list()
	if pass_list == null or pass_list.elements.is_empty():
		return null
	return pass_list.elements[0]


## Whether `node`, a child of the system popup root, is a system popup instance: the root also holds the popup dim and
## modal blocker.
static func _is_system_popup(node: Node) -> bool:
	for child: Node in node.get_children():
		var view_script: Script = child.get_script()
		if view_script != null and view_script.resource_path == _SYSTEM_VIEW_PATH:
			return true
	return false


## Number of the visible system popups under `popup`, a child of `system_root`.
static func _system_popup_index(system_root: Control, popup: Node) -> int:
	var index: int = 0
	for child: Node in system_root.get_children():
		if child == popup:
			break
		if child is CanvasItem and (child as CanvasItem).visible and _is_system_popup(child):
			index += 1
	return index
