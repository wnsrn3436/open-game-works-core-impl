extends PushConsentPopup
## Push consent popup prefab root of the core tests.

const _UI := preload("res://core/auth_core/tests/support/popup_ui.gd")


func _init() -> void:
	_UI.size_root(self)
	title_label = _UI.label(self, 0)
	ad_push_toggle = _UI.button(self, "auth_test_push_ad", 1, true)
	night_push_toggle = _UI.button(self, "auth_test_push_night", 2, true)
	confirm_button = _UI.button(self, "auth_test_push_confirm", 3)
