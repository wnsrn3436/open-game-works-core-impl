extends PrivacyChoicesPopup
## Privacy popup prefab root of the core tests.

const _UI := preload("res://core/auth_core/tests/support/popup_ui.gd")


func _init() -> void:
	_UI.size_root(self)
	title_label = _UI.label(self, 0)
	ad_personalization_toggle = _UI.button(self, "auth_test_privacy_ad", 1, true)
	analytics_toggle = _UI.button(self, "auth_test_privacy_analytics", 2, true)
	confirm_button = _UI.button(self, "auth_test_privacy_confirm", 3)
