extends TermsPopup
## Terms popup prefab root of the core tests.

const _UI := preload("res://core/auth_core/tests/support/popup_ui.gd")


func _init() -> void:
	_UI.size_root(self)
	title_label = _UI.label(self, 0)
	terms_toggle = _UI.button(self, "auth_test_terms_toggle", 1, true)
	privacy_toggle = _UI.button(self, "auth_test_privacy_toggle", 2, true)
	terms_view_button = _UI.button(self, "auth_test_terms_view", 3)
	privacy_view_button = _UI.button(self, "auth_test_privacy_view", 4)
	confirm_button = _UI.button(self, "auth_test_terms_confirm", 5)
