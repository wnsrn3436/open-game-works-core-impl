class_name UICoreDev
extends RefCounted
## DEV operations of `UICore`.


## Puts the focus on `element` when the input device is `Gamepad` and `element` is a `UIButton` element in the focus
## target instance or a visible element of the view focus. It becomes the focus element there.
static func set_test_focus(element: Control) -> bool:
	if not UICore._check_initialized("set_test_focus"):
		return false
	if element == null or not is_instance_valid(element):
		return false
	if InputCore.get_device() != InputCore.InputDevice.GAMEPAD:
		return false
	var holder: UICore._HOLDER = UICore._focus_target()
	if holder == null or not UICore._in_holder(holder, element):
		return false
	holder.focus_element = element
	element.grab_focus()
	return true
