extends Control
## Code made content of a system popup: the body and extra text, which scroll when they do not fit, over one to
## three buttons spread evenly. It fills the system popup instance root with a margin.

const _MARGIN: float = 16.0
const _BUTTON_HEIGHT: float = 56.0
const _SEPARATION: int = 16

## The system popup instance root this content is in.
var popup: Control = null
var scroll: ScrollContainer = null
var body_label: Label = null
var extra_label: Label = null
var buttons: Array[Button] = []
var _on_button_input_callable: Callable = Callable()
var _on_scroll_input_callable: Callable = Callable()


func _init() -> void:
	_on_button_input_callable = _on_button_input
	_on_scroll_input_callable = _on_scroll_input


## Builds the content. `labels` are the translated button labels.
func build(owner_popup: Control, body: String, extra: String, labels: PackedStringArray) -> void:
	popup = owner_popup
	name = "SystemPopupContent"
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_preset(Control.PRESET_FULL_RECT)
	offset_left = _MARGIN
	offset_top = _MARGIN
	offset_right = -_MARGIN
	offset_bottom = -_MARGIN
	var column: VBoxContainer = VBoxContainer.new()
	column.set_anchors_preset(Control.PRESET_FULL_RECT)
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.add_theme_constant_override("separation", _SEPARATION)
	add_child(column)
	scroll = ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	if scroll.gui_input.connect(_on_scroll_input_callable) != OK:
		LogCore.log_error(UICore._TAG, "system popup: gui_input connect failed")
	column.add_child(scroll)
	var texts: VBoxContainer = VBoxContainer.new()
	texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	texts.mouse_filter = Control.MOUSE_FILTER_IGNORE
	scroll.add_child(texts)
	body_label = Label.new()
	body_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	body_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	body_label.text = body
	texts.add_child(body_label)
	extra_label = Label.new()
	extra_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	extra_label.text = extra
	extra_label.visible = not extra.is_empty()
	texts.add_child(extra_label)
	var row: HBoxContainer = HBoxContainer.new()
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.add_theme_constant_override("separation", _SEPARATION)
	column.add_child(row)
	for i: int in labels.size():
		var button: Button = Button.new()
		button.text = labels[i]
		button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		button.custom_minimum_size = Vector2(0.0, _BUTTON_HEIGHT)
		button.focus_mode = Control.FOCUS_ALL
		if button.gui_input.connect(_on_button_input_callable) != OK:
			LogCore.log_error(UICore._TAG, "system popup: gui_input connect failed")
		var ui_button: UIButton = UIButton.new()
		ui_button.set_on_click(_on_button.bind(i))
		button.add_child(ui_button)
		row.add_child(button)
		buttons.append(button)


## Moves the scroll position by `step` game coordinates; the scroll container keeps it in range.
func scroll_by(step: float) -> void:
	if scroll != null:
		scroll.scroll_vertical += roundi(step)


func _on_button(index: int) -> void:
	UICore._on_system_button(popup, index)


## Up and down input does not move the focus of a system popup; `UICore` scrolls with it.
func _on_button_input(event: InputEvent) -> void:
	if event.is_action_pressed(&"ui_up", true, true) or event.is_action_pressed(&"ui_down", true, true):
		accept_event()


## Pointer drag scrolls the body and extra text.
func _on_scroll_input(event: InputEvent) -> void:
	var motion: InputEventMouseMotion = event as InputEventMouseMotion
	if motion != null and (motion.button_mask & MOUSE_BUTTON_MASK_LEFT) != 0 \
			and motion.device != InputEvent.DEVICE_ID_EMULATION:
		scroll.scroll_vertical -= roundi(motion.relative.y)
		accept_event()
