class_name PushConsentPopup
extends UIPopup
## Root of the push consent popup prefab (game settings `pushConsentPopup`): ad push and night ad push toggles. On
## is `GRANTED`, off is `DENIED`.

const _PARAM := preload("res://core/auth_core/auth_popup_param.gd")
const _UTIL := preload("res://core/auth_core/auth_popup_util.gd")

@export var title_label: Label
@export var ad_push_toggle: Button
@export var night_push_toggle: Button
@export var confirm_button: Button

var _param: _PARAM = null


func accepts_param(param: UIParam) -> bool:
	var buttons: Array[Button] = [ad_push_toggle, night_push_toggle, confirm_button]
	if not param is _PARAM or not _UTIL.has_buttons(buttons):
		return false
	_param = param as _PARAM
	_UTIL.bind(title_label, ReservedString.auth_push_title())
	_UTIL.bind(ad_push_toggle, ReservedString.auth_push_ad())
	_UTIL.bind(night_push_toggle, ReservedString.auth_push_night())
	_UTIL.bind(confirm_button, ReservedString.auth_push_confirm())
	_UTIL.set_toggle(ad_push_toggle, _param.first_on)
	_UTIL.set_toggle(night_push_toggle, _param.second_on)
	_UTIL.on_click(confirm_button, _on_confirm)
	return true


func _on_confirm() -> void:
	_param.first_on = ad_push_toggle.button_pressed
	_param.second_on = night_push_toggle.button_pressed
	_param.confirmed = true
	UICore.close_popup(self, _param.on_result)
