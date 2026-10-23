class_name BenchInfoPanel
extends UIPanel
## Panel over the lobby: shows the tick count and records one tick on the server per click of the record button.
## While a record request is in flight the panel stays open, so the request callbacks always find the panel.

@export var title_label: Label
@export var tick_label: Label
@export var send_button: Button
@export var close_button: Button
@export var send_click: UIButton
@export var close_click: UIButton

var _format_args: FormatArgs = FormatArgs.new()
var _sending: bool = false
var _shown_count: int = -1


func prepare(_reason: UICore.PanelOpenReason, _cache: UIPanelCache) -> bool:
	LocalizationCore.bind_text(title_label, ReservedString.bench_info_title())
	LocalizationCore.bind_text(send_button, ReservedString.bench_tick_send())
	LocalizationCore.bind_text(close_button, ReservedString.bench_close())
	send_click.set_on_click(_on_send)
	close_click.set_on_click(_on_close)
	EventCore.subscribe(UserStateChangedEvent, _on_user_state_changed)
	EventCore.subscribe(InputPromptChangedEvent, _on_input_prompt_changed)
	_write_tick_count(true)
	return true


func on_back() -> void:
	_on_close()


func _exit_tree() -> void:
	EventCore.unsubscribe_all(self)


func _on_send() -> void:
	if _sending:
		return
	var count: int = BenchTicks.current()
	if not BenchTicks.can_record(count):
		return
	var request: GameContract.RecordBenchTickRequest = GameContract.RecordBenchTickRequest.new()
	request.tick_count = count
	_sending = true
	NetworkCore.send(request, _on_sent, _on_send_failed)


func _on_close() -> void:
	if _sending:
		return
	UICore.close_panel()


func _on_sent(_response: ContractMessage) -> void:
	_sending = false


func _on_send_failed(failure: RequestFailure) -> bool:
	_sending = false
	if failure.error_code != GameContract.GameError.GAME_ERROR_TICK_COUNT_MISMATCH:
		return false
	MessageCore.show_toast(ReservedString.bench_tick_mismatch())
	NetworkCore.resync()
	return true


func _on_user_state_changed(event: UserStateChangedEvent) -> void:
	if event.kind == GameContract.BenchUserState:
		_write_tick_count(false)


func _on_input_prompt_changed(_event: InputPromptChangedEvent) -> void:
	_write_tick_count(true)


func _write_tick_count(always: bool) -> void:
	var count: int = BenchTicks.current()
	if count == _shown_count and not always:
		return
	_shown_count = count
	_format_args.set_int("count", count)
	tick_label.text = LocalizationCore.format(ReservedString.bench_tick_count(), _format_args)
