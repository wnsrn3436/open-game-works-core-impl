class_name BenchNoticePopup
extends UIPopup
## Popup over the arena: a notice text and its close button. The arena keeps drawing under it.

@export var body_label: Label
@export var close_button: Button
@export var close_click: UIButton


func prepare() -> bool:
	LocalizationCore.bind_text(body_label, ReservedString.bench_notice_body())
	LocalizationCore.bind_text(close_button, ReservedString.bench_close())
	close_click.set_on_click(_on_close)
	return true


func _on_close() -> void:
	UICore.close_popup(self)
