class_name BenchOptionPanel
extends UIPanel
## Option panel over the lobby: user ID and its copy, terms and privacy documents, licenses, privacy choices, the
## account deletion code and withdrawal. The benchmark has no social login adapter in any environment, so no login
## provider is supported and the panel has no account link entry. The async flows run in static functions that check
## the panel is still there after each wait, so a closed panel never resumes.

@export var title_label: Label
@export var user_id_label: Label
@export var copy_user_id_button: Button
@export var terms_button: Button
@export var privacy_button: Button
@export var licenses_button: Button
@export var privacy_choices_button: Button
@export var withdraw_button: Button
@export var deletion_button: Button
@export var deletion_label: Label
@export var copy_code_button: Button
@export var copy_url_button: Button
@export var close_button: Button
@export var copy_user_id_click: UIButton
@export var terms_click: UIButton
@export var privacy_click: UIButton
@export var licenses_click: UIButton
@export var privacy_choices_click: UIButton
@export var withdraw_click: UIButton
@export var deletion_click: UIButton
@export var copy_code_click: UIButton
@export var copy_url_click: UIButton
@export var close_click: UIButton

var _format_args: FormatArgs = FormatArgs.new()
var _deletion: DeletionCodeResult = null


func prepare(_reason: UICore.PanelOpenReason, _cache: UIPanelCache) -> bool:
	LocalizationCore.bind_text(title_label, ReservedString.bench_option_title())
	LocalizationCore.bind_text(copy_user_id_button, ReservedString.bench_copy_user_id())
	LocalizationCore.bind_text(terms_button, ReservedString.bench_terms())
	LocalizationCore.bind_text(privacy_button, ReservedString.bench_privacy())
	LocalizationCore.bind_text(licenses_button, ReservedString.bench_licenses())
	LocalizationCore.bind_text(privacy_choices_button, ReservedString.bench_privacy_choices())
	LocalizationCore.bind_text(withdraw_button, ReservedString.bench_withdraw())
	LocalizationCore.bind_text(deletion_button, ReservedString.bench_deletion_issue())
	LocalizationCore.bind_text(copy_code_button, ReservedString.bench_copy_code())
	LocalizationCore.bind_text(copy_url_button, ReservedString.bench_copy_url())
	LocalizationCore.bind_text(close_button, ReservedString.bench_close())
	copy_user_id_click.set_on_click(_on_copy_user_id)
	terms_click.set_on_click(_on_terms)
	privacy_click.set_on_click(_on_privacy)
	licenses_click.set_on_click(_on_licenses)
	privacy_choices_click.set_on_click(_on_privacy_choices)
	withdraw_click.set_on_click(_on_withdraw)
	deletion_click.set_on_click(_on_deletion)
	copy_code_click.set_on_click(_on_copy_code)
	copy_url_click.set_on_click(_on_copy_url)
	close_click.set_on_click(_on_close)
	privacy_choices_button.visible = AuthCore.is_privacy_choices_enabled()
	EventCore.subscribe(InputPromptChangedEvent, _on_input_prompt_changed)
	_write_texts()
	return true


func _exit_tree() -> void:
	EventCore.unsubscribe_all(self)


## Writes the formatted texts: the user code and the deletion code.
func _write_texts() -> void:
	_format_args.clear()
	_format_args.set_string("public_code", _user_code())
	user_id_label.text = LocalizationCore.format(ReservedString.bench_user_id(), _format_args)
	var has_code: bool = _deletion != null and _deletion.ok
	deletion_label.visible = has_code
	copy_code_button.visible = has_code
	copy_url_button.visible = has_code
	if has_code:
		_format_args.clear()
		_format_args.set_string("code", _deletion.code)
		_format_args.set_int("expires_at", _deletion.expires_at)
		_format_args.set_string("url", _deletion.url)
		deletion_label.text = LocalizationCore.format(ReservedString.bench_deletion_info(), _format_args)


func _on_input_prompt_changed(_event: InputPromptChangedEvent) -> void:
	_write_texts()


## The public code in two groups of 4 characters joined with `-`.
func _user_code() -> String:
	var code: String = AuthCore.get_public_code()
	return "%s-%s" % [code.substr(0, 4), code.substr(4)]


func _on_copy_user_id() -> void:
	if not NativeUiCore.copy_text(_user_code()):
		MessageCore.show_toast(ReservedString.bench_option_failed())


func _on_terms() -> void:
	_open_document(CoreContract.TermsItem.TERMS_ITEM_TERMS)


func _on_privacy() -> void:
	_open_document(CoreContract.TermsItem.TERMS_ITEM_PRIVACY)


func _on_licenses() -> void:
	_open_licenses()


func _on_privacy_choices() -> void:
	_open_privacy_choices()


func _on_copy_code() -> void:
	if _deletion != null and not NativeUiCore.copy_text(_deletion.code):
		MessageCore.show_toast(ReservedString.bench_option_failed())


func _on_copy_url() -> void:
	if _deletion != null and not NativeUiCore.copy_text(_deletion.url):
		MessageCore.show_toast(ReservedString.bench_option_failed())


func _on_deletion() -> void:
	_issue_deletion_code(self)


func _on_withdraw() -> void:
	var param: SystemPopupParam = SystemPopupParam.new()
	param.body = ReservedString.bench_withdraw_confirm()
	param.buttons = [_popup_button(ReservedString.bench_withdraw_ok(), _withdraw), _popup_button(ReservedString.bench_cancel(), Callable())]
	param.back_button = 1
	UICore.open_system_popup(param, Callable())


func _on_close() -> void:
	UICore.close_panel()


static func _popup_button(label: String, callback: Callable) -> SystemPopupButton:
	var button: SystemPopupButton = SystemPopupButton.new()
	button.label = label
	button.callback = callback
	return button


static func _open_document(item: CoreContract.TermsItem) -> void:
	if not await AuthCore.open_terms_document(item):
		MessageCore.show_toast(ReservedString.bench_option_failed())


static func _open_licenses() -> void:
	if not await UICore.open_licenses():
		MessageCore.show_toast(ReservedString.bench_option_failed())


static func _open_privacy_choices() -> void:
	if not await AuthCore.open_privacy_choices():
		MessageCore.show_toast(ReservedString.bench_option_failed())


## Withdraws after the confirm popup. On success `AuthCore` restarts the game.
static func _withdraw() -> void:
	if not await AuthCore.withdraw():
		MessageCore.show_toast(ReservedString.bench_option_failed())


static func _issue_deletion_code(panel: BenchOptionPanel) -> void:
	var result: DeletionCodeResult = await AuthCore.issue_deletion_code()
	if not result.ok:
		MessageCore.show_toast(ReservedString.bench_option_failed())
		return
	if is_instance_valid(panel):
		panel._deletion = result
		panel._write_texts()

