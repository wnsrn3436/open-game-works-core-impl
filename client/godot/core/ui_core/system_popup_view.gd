extends Control
## Code made content of a system popup: the body and extra text, which scroll when they do not fit, over one to
## three buttons spread evenly in one row. It fills the system popup instance root. The body and the buttons go into
## the body area and button area `Control`s of a `UISystemPopup` root, or into the part of this view each takes from
## the root: the buttons in a strip along the bottom edge, the body above the top edge of the button area. The row
## shrinks to fit its area: labels that do not fit end with an ellipsis, and a row whose minimum size is still larger
## than the area is scaled down.

const _MARGIN: float = 16.0
const _BUTTON_HEIGHT: float = 56.0
const _SEPARATION: int = 16

## The system popup instance root this content is in.
var popup: Control = null
var scroll: ScrollContainer = null
var body_label: Label = null
var extra_label: Label = null
var buttons: Array[Button] = []
## The button row.
var row: HBoxContainer = null
## The button area `Control`, or the strip of this view taken from the root, that the row fills.
var _row_area: Control = null
## The button area `Control` of the root when the body area is taken from the root above it; `null` otherwise.
var _fit_above: Control = null
var _on_button_input_callable: Callable = Callable()
var _on_scroll_input_callable: Callable = Callable()


func _init() -> void:
	_on_button_input_callable = _on_button_input
	_on_scroll_input_callable = _on_scroll_input
	set_process(false)


## Builds the content. `labels` are the translated button labels. `body_area` and `button_area` are the area
## `Control`s inside the root, or `null` for an area taken from the root.
func build(
		owner_popup: Control, body: String, extra: String, labels: PackedStringArray, body_area: Control,
		button_area: Control
) -> void:
	popup = owner_popup
	name = "SystemPopupContent"
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	scroll = ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	if scroll.gui_input.connect(_on_scroll_input_callable) != OK:
		LogCore.log_error(UICore._TAG, "system popup: gui_input connect failed")
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
	row = HBoxContainer.new()
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.add_theme_constant_override("separation", _SEPARATION)
	for i: int in labels.size():
		var button: Button = Button.new()
		button.text = labels[i]
		button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		button.clip_text = true
		button.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		button.focus_mode = Control.FOCUS_ALL
		if button.gui_input.connect(_on_button_input_callable) != OK:
			LogCore.log_error(UICore._TAG, "system popup: gui_input connect failed")
		var ui_button: UIButton = UIButton.new()
		ui_button.set_on_click(_on_button.bind(i))
		button.add_child(ui_button)
		row.add_child(button)
		buttons.append(button)
	if button_area != null:
		_row_area = button_area
	else:
		_row_area = Control.new()
		_row_area.name = "ButtonStrip"
		_row_area.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(_row_area)
		_row_area.anchor_left = 0.0
		_row_area.anchor_top = 1.0
		_row_area.anchor_right = 1.0
		_row_area.anchor_bottom = 1.0
		_row_area.offset_left = _MARGIN
		_row_area.offset_top = -(_MARGIN + _BUTTON_HEIGHT)
		_row_area.offset_right = -_MARGIN
		_row_area.offset_bottom = -_MARGIN
	_row_area.add_child(row)
	row.set_anchors_preset(Control.PRESET_TOP_LEFT)
	if _row_area.resized.connect(_fit_row) != OK or row.minimum_size_changed.connect(_fit_row) != OK:
		LogCore.log_error(UICore._TAG, "system popup: resize connect failed")
	_fit_row()
	if body_area != null:
		body_area.add_child(scroll)
		scroll.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	else:
		add_child(scroll)
		scroll.set_anchors_preset(Control.PRESET_FULL_RECT)
		scroll.offset_left = _MARGIN
		scroll.offset_top = _MARGIN
		scroll.offset_right = -_MARGIN
		scroll.offset_bottom = -(_MARGIN + _BUTTON_HEIGHT + _SEPARATION)
		if button_area != null:
			_fit_above = button_area
			set_process(true)


## The body taken from the root ends above the top edge of the button area `Control`, which may move.
func _process(_delta: float) -> void:
	if not is_instance_valid(_fit_above):
		return
	var top: float = (get_global_transform().affine_inverse() * _fit_above.get_global_rect().position).y
	var offset: float = maxf(top - _SEPARATION, _MARGIN) - size.y
	if not is_equal_approx(scroll.offset_bottom, offset):
		scroll.offset_bottom = offset


## Fills the row area with the row. A row whose minimum size is larger than the area is scaled down uniformly so its
## rectangle stays the area rectangle. An area without size is left until it is resized.
func _fit_row() -> void:
	if not is_instance_valid(_row_area) or row == null:
		return
	var area: Vector2 = _row_area.size
	if area.x <= 0.0 or area.y <= 0.0:
		return
	var need: Vector2 = row.get_combined_minimum_size()
	var factor: float = 1.0
	if need.x > area.x:
		factor = area.x / need.x
	if need.y > area.y:
		factor = minf(factor, area.y / need.y)
	row.scale = Vector2(factor, factor)
	row.position = Vector2.ZERO
	row.size = area / factor


## Moves the scroll position by `step` game coordinates; the scroll container keeps it in range. Returns whether the
## body and extra text do not fit in the scroll area, so that the body area scrolls with the input; a body that fits
## does not handle the input.
func scroll_by(step: float) -> bool:
	if scroll == null:
		return false
	var bar: VScrollBar = scroll.get_v_scroll_bar()
	if bar.max_value - bar.page <= 0.0:
		return false
	scroll.scroll_vertical += roundi(step)
	return true


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
