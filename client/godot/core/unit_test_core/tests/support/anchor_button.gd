extends Button
## A button with `UIButton` and `UIAnchor` children that counts its clicks.

var clicks: int = 0


## Adds the `UIButton` and the `UIAnchor` of `anchor_name` and `anchor_key`. Call after the button is in the tree.
func add_components(anchor_name: String, anchor_key: int) -> void:
	var button: UIButton = UIButton.new()
	add_child(button)
	button.set_on_click(_on_click)
	var anchor: UIAnchor = UIAnchor.new()
	anchor.anchor_name = anchor_name
	add_child(anchor)
	anchor.set_anchor_key(anchor_key)


func _on_click() -> void:
	clicks += 1
