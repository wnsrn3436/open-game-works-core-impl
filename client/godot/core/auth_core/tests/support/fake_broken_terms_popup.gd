extends "res://core/auth_core/tests/support/fake_terms_popup.gd"
## Terms popup prefab root with no confirm button: the param check fails.


func _init() -> void:
	super()
	confirm_button.free()
	confirm_button = null
