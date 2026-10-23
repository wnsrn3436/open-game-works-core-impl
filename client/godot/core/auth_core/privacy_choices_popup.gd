class_name PrivacyChoicesPopup
extends UIPopup
## Root of the privacy popup prefab (game settings `privacyPopup`): ad personalization and analytics toggles. On is
## `GRANTED`, off is `DENIED`.

const _PARAM := preload("res://core/auth_core/auth_popup_param.gd")
const _UTIL := preload("res://core/auth_core/auth_popup_util.gd")

@export var title_label: Label
@export var ad_personalization_toggle: Button
@export var analytics_toggle: Button
@export var confirm_button: Button

var _param: _PARAM = null


func accepts_param(param: UIParam) -> bool:
	var buttons: Array[Button] = [ad_personalization_toggle, analytics_toggle, confirm_button]
	if not param is _PARAM or not _UTIL.has_buttons(buttons):
		return false
	_param = param as _PARAM
	_UTIL.bind(title_label, ReservedString.auth_privacy_title())
	_UTIL.bind(ad_personalization_toggle, ReservedString.auth_privacy_ad_personalization())
	_UTIL.bind(analytics_toggle, ReservedString.auth_privacy_analytics())
	_UTIL.bind(confirm_button, ReservedString.auth_privacy_confirm())
	_UTIL.set_toggle(ad_personalization_toggle, _param.first_on)
	_UTIL.set_toggle(analytics_toggle, _param.second_on)
	_UTIL.on_click(confirm_button, _on_confirm)
	return true


func _on_confirm() -> void:
	_param.first_on = ad_personalization_toggle.button_pressed
	_param.second_on = analytics_toggle.button_pressed
	_param.confirmed = true
	UICore.close_popup(self, _param.on_result)
