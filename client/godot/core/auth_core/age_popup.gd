class_name AgePopup
extends UIPopup
## Root of the age popup prefab (game settings `agePopup`). Confirm takes the birth year and month; an invalid value
## keeps the popup open and shows `[auth_age_invalid]`.

const _PARAM := preload("res://core/auth_core/auth_popup_param.gd")
const _UTIL := preload("res://core/auth_core/auth_popup_util.gd")

@export var title_label: Label
@export var year_label: Label
@export var year_input: LineEdit
@export var month_label: Label
@export var month_input: LineEdit
@export var invalid_label: Label
@export var confirm_button: Button

var _param: _PARAM = null


func accepts_param(param: UIParam) -> bool:
	if not param is _PARAM or year_input == null or month_input == null:
		return false
	var buttons: Array[Button] = [confirm_button]
	if not _UTIL.has_buttons(buttons):
		return false
	_param = param as _PARAM
	_UTIL.bind(title_label, ReservedString.auth_age_title())
	_UTIL.bind(year_label, ReservedString.auth_age_year())
	_UTIL.bind(month_label, ReservedString.auth_age_month())
	_UTIL.bind(confirm_button, ReservedString.auth_age_confirm())
	_UTIL.bind(invalid_label, ReservedString.auth_age_invalid())
	if invalid_label != null:
		invalid_label.visible = false
	_UTIL.on_click(confirm_button, _on_confirm)
	return true


func _on_confirm() -> void:
	var value: int = birth_year_month(year_input.text, month_input.text, TimeCore.get_server_time(), _param.max_age_years)
	if value == 0:
		if invalid_label != null:
			invalid_label.visible = true
		return
	_param.birth_year_month = value
	_param.confirmed = true
	UICore.close_popup(self, _param.on_result)


## `yyyymm` of the input, or 0 when it is invalid: the year is not 4 digits, the month is not 1 to 12, the month is
## after the UTC month of `now_ms`, or the age is over `max_age_years`. The age counts as server `auth` does.
static func birth_year_month(year_text: String, month_text: String, now_ms: int, max_age_years: int) -> int:
	if year_text.length() != 4 or not _is_digits(year_text) or not month_text.is_valid_int():
		return 0
	var year: int = year_text.to_int()
	var month: int = month_text.to_int()
	if month < 1 or month > 12 or now_ms <= 0:
		return 0
	var now_months: int = _utc_months(now_ms)
	var months: int = year * 12 + month
	if months > now_months or floori((now_months - months) / 12.0) > max_age_years:
		return 0
	return year * 100 + month


## Year × 12 + month of the UTC date of `time_ms`.
# ogw:input_boundary
static func _utc_months(time_ms: int) -> int:
	var date: Dictionary = Time.get_datetime_dict_from_unix_time(floori(time_ms / 1000.0))
	var year: Variant = date["year"] if date.has("year") else 0
	var month: Variant = date["month"] if date.has("month") else 0
	if not year is int or not month is int:
		return 0
	var year_value: int = year
	var month_value: int = month
	return year_value * 12 + month_value


static func _is_digits(text: String) -> bool:
	for i: int in text.length():
		var code: int = text.unicode_at(i)
		if code < 0x30 or code > 0x39:
			return false
	return true
