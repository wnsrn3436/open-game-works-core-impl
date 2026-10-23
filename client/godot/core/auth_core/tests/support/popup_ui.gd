extends RefCounted
## Builds the elements of the test popup prefabs in code: buttons with a `UIButton` and a `UIAnchor`.


static func button(parent: Control, anchor: String, index: int, toggle: bool = false) -> Button:
	var made: Button = Button.new()
	made.position = Vector2(20, 20 + index * 60)
	made.size = Vector2(200, 48)
	made.toggle_mode = toggle
	var ui_button: UIButton = UIButton.new()
	made.add_child(ui_button)
	var ui_anchor: UIAnchor = UIAnchor.new()
	ui_anchor.anchor_name = anchor
	made.add_child(ui_anchor)
	parent.add_child(made)
	return made


static func line_edit(parent: Control, index: int) -> LineEdit:
	var made: LineEdit = LineEdit.new()
	made.position = Vector2(20, 20 + index * 60)
	made.size = Vector2(200, 48)
	parent.add_child(made)
	return made


static func label(parent: Control, index: int) -> Label:
	var made: Label = Label.new()
	made.position = Vector2(240, 20 + index * 60)
	parent.add_child(made)
	return made


static func size_root(root: Control) -> void:
	root.size = Vector2(480, 480)
