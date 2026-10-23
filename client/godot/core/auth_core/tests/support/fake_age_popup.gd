extends AgePopup
## Age popup prefab root of the core tests.

const _UI := preload("res://core/auth_core/tests/support/popup_ui.gd")


func _init() -> void:
	_UI.size_root(self)
	title_label = _UI.label(self, 0)
	year_label = _UI.label(self, 1)
	year_input = _UI.line_edit(self, 1)
	month_label = _UI.label(self, 2)
	month_input = _UI.line_edit(self, 2)
	invalid_label = _UI.label(self, 3)
	confirm_button = _UI.button(self, "auth_test_age_confirm", 4)
