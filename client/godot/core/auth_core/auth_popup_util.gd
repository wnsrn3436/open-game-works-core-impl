extends RefCounted
## Element checks and bindings the core popups of AuthCore share.

const _PARAM := preload("res://core/auth_core/auth_popup_param.gd")


## The `UIButton` child of `button`, or `null`.
static func ui_button(button: Button) -> UIButton:
	if button == null:
		return null
	for child: Node in button.get_children():
		if child is UIButton:
			return child as UIButton
	return null


## True when every button is a `Button` with a `UIButton` child.
static func has_buttons(buttons: Array[Button]) -> bool:
	for button: Button in buttons:
		if ui_button(button) == null:
			return false
	return true


## Binds `key` to `element` when the element is there.
static func bind(element: Control, key: String) -> void:
	if element != null:
		LocalizationCore.bind_text(element, key)


## Sets the click callback of the `UIButton` of `button`.
static func on_click(button: Button, callback: Callable) -> void:
	var target: UIButton = ui_button(button)
	if target != null:
		target.set_on_click(callback)


## Shows a toggle on or off without its signal.
static func set_toggle(toggle: Button, on: bool) -> void:
	toggle.toggle_mode = true
	toggle.set_pressed_no_signal(on)
