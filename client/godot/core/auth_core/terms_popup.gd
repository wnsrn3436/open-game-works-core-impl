class_name TermsPopup
extends UIPopup
## Root of the terms popup prefab (game settings `termsPopup`). Each terms item has a toggle and a document view
## button. The popup closes with its result only by the confirm button.

const _PARAM := preload("res://core/auth_core/auth_popup_param.gd")
const _UTIL := preload("res://core/auth_core/auth_popup_util.gd")

@export var title_label: Label
@export var terms_toggle: Button
@export var privacy_toggle: Button
@export var terms_view_button: Button
@export var privacy_view_button: Button
@export var confirm_button: Button

var _param: _PARAM = null


func accepts_param(param: UIParam) -> bool:
	if not param is _PARAM:
		return false
	var buttons: Array[Button] = [terms_toggle, privacy_toggle, terms_view_button, privacy_view_button, confirm_button]
	if not _UTIL.has_buttons(buttons):
		return false
	_param = param as _PARAM
	_UTIL.bind(title_label, ReservedString.auth_terms_title())
	_UTIL.bind(terms_toggle, ReservedString.auth_terms_agree_terms())
	_UTIL.bind(privacy_toggle, ReservedString.auth_terms_agree_privacy())
	_UTIL.bind(terms_view_button, ReservedString.auth_terms_view())
	_UTIL.bind(privacy_view_button, ReservedString.auth_terms_view())
	_UTIL.bind(confirm_button, ReservedString.auth_terms_confirm())
	_UTIL.set_toggle(terms_toggle, false)
	_UTIL.set_toggle(privacy_toggle, false)
	_UTIL.on_click(terms_view_button, _on_terms_view)
	_UTIL.on_click(privacy_view_button, _on_privacy_view)
	_UTIL.on_click(confirm_button, _on_confirm)
	return true


func _on_terms_view() -> void:
	_param.open_url.call(_param.terms_url)


func _on_privacy_view() -> void:
	_param.open_url.call(_param.privacy_url)


func _on_confirm() -> void:
	_param.first_on = terms_toggle.button_pressed
	_param.second_on = privacy_toggle.button_pressed
	_param.confirmed = true
	UICore.close_popup(self, _param.on_result)
