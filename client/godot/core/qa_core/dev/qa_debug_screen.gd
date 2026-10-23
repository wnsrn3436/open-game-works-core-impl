extends RefCounted
## Debug screen and stats display of `QACore` on the `Debug` UI layer, made in code. The debug screen shows QAState,
## the last command result, the command list and a command line. All text is English and is not translated.

const _MARGIN: int = 16
const _GAP: int = 8
const _BACKGROUND: Color = Color(0.0, 0.0, 0.0, 0.8)
const _STATS_POSITION: Vector2 = Vector2(8, 8)

var _root: Control = null
var _stats: Label = null
var _screen: PanelContainer = null
var _state_label: Label = null
var _result_label: Label = null
var _commands_label: Label = null
var _line: LineEdit = null
var _on_run: Callable = Callable()


## Makes the closed debug screen and the hidden stats display under `layer`. `on_run` takes a typed command line.
func build(layer: CanvasLayer, on_run: Callable) -> void:
	if layer == null:
		return
	_on_run = on_run
	var root: Control = Control.new()
	root.name = "QACoreDebug"
	root.process_mode = Node.PROCESS_MODE_ALWAYS
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var background: StyleBoxFlat = StyleBoxFlat.new()
	background.bg_color = _BACKGROUND
	_stats = Label.new()
	_stats.name = "Stats"
	_stats.visible = false
	_stats.position = _STATS_POSITION
	_stats.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_stats.add_theme_stylebox_override("normal", background)
	_screen = PanelContainer.new()
	_screen.name = "Screen"
	_screen.visible = false
	_screen.mouse_filter = Control.MOUSE_FILTER_STOP
	_screen.add_theme_stylebox_override("panel", background)
	_screen.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT, Control.PRESET_MODE_MINSIZE, _MARGIN)
	var column: VBoxContainer = VBoxContainer.new()
	column.add_theme_constant_override("separation", _GAP)
	var scroll: ScrollContainer = ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	var texts: VBoxContainer = VBoxContainer.new()
	texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	texts.add_theme_constant_override("separation", _GAP)
	_state_label = _text_label("State")
	_result_label = _text_label("Result")
	_commands_label = _text_label("Commands")
	texts.add_child(_state_label)
	texts.add_child(_result_label)
	texts.add_child(_commands_label)
	scroll.add_child(texts)
	var row: HBoxContainer = HBoxContainer.new()
	_line = LineEdit.new()
	_line.name = "CommandLine"
	_line.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_line.placeholder_text = "command arg1 arg2"
	var run: Button = Button.new()
	run.name = "Run"
	run.text = "Run"
	row.add_child(_line)
	row.add_child(run)
	column.add_child(scroll)
	column.add_child(row)
	_screen.add_child(column)
	root.add_child(_screen)
	root.add_child(_stats)
	if run.pressed.connect(_on_run_pressed) != OK or _line.text_submitted.connect(_on_line_submitted) != OK:
		LogCore.log_error(QACore._TAG, "could not connect the debug screen command line")
	layer.add_child(root)
	_root = root


func set_screen_visible(visible: bool) -> void:
	if is_instance_valid(_screen):
		_screen.visible = visible


func set_stats_visible(visible: bool) -> void:
	if is_instance_valid(_stats):
		_stats.visible = visible


func set_stats_text(text: String) -> void:
	if is_instance_valid(_stats):
		_stats.text = text


func set_screen_text(state: String, result: String, commands: String) -> void:
	if not is_instance_valid(_screen):
		return
	_state_label.text = "QAState\n" + state
	_result_label.text = "Last result\n" + result
	_commands_label.text = "Commands\n" + commands


## Whether the debug screen or the stats display is drawn now.
func is_drawn() -> bool:
	return is_instance_valid(_root) and ((_screen != null and _screen.visible) or (_stats != null and _stats.visible))


func destroy() -> void:
	var root: Control = _root
	_root = null
	_stats = null
	_screen = null
	_state_label = null
	_result_label = null
	_commands_label = null
	_line = null
	_on_run = Callable()
	if is_instance_valid(root):
		if root.get_parent() != null:
			root.get_parent().remove_child(root)
		root.queue_free()


func _text_label(label_name: String) -> Label:
	var label: Label = Label.new()
	label.name = label_name
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return label


func _on_run_pressed() -> void:
	_run_line()


func _on_line_submitted(_text: String) -> void:
	_run_line()


func _run_line() -> void:
	if not is_instance_valid(_line) or not _on_run.is_valid():
		return
	var line: String = _line.text
	_line.text = ""
	_on_run.call(line)
