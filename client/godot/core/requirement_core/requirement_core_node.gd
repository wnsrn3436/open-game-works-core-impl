extends Node
## Core node of `RequirementCore`: runs the batch evaluation before the content update of a frame and receives the
## events that raise triggers and the game day change.

## Subscription callbacks, made once so a subscription change makes no `Callable`.
var on_user_state_changed: Callable = Callable()
var on_request_completed: Callable = Callable()
var on_ui_opened: Callable = Callable()
var on_ui_closed: Callable = Callable()
var on_content_event: Callable = Callable()
var on_day_changed: Callable = Callable()


func _init() -> void:
	on_user_state_changed = _on_user_state_changed
	on_request_completed = _on_request_completed
	on_ui_opened = _on_ui_opened
	on_ui_closed = _on_ui_closed
	on_content_event = _on_content_event
	on_day_changed = _on_day_changed


func _process(_delta: float) -> void:
	RequirementCore._on_frame()


func _exit_tree() -> void:
	RequirementCore._on_node_exit(self)


func _on_user_state_changed(event: UserStateChangedEvent) -> void:
	RequirementCore._on_user_state_changed(event.kind)


func _on_request_completed(event: RequestCompletedEvent) -> void:
	RequirementCore._on_named_trigger(RequirementCore.TriggerKind.REQUEST_COMPLETED, event.request_name)


func _on_ui_opened(event: UIOpenedEvent) -> void:
	RequirementCore._on_named_trigger(RequirementCore.TriggerKind.UI_OPENED, event.key)


func _on_ui_closed(event: UIClosedEvent) -> void:
	RequirementCore._on_named_trigger(RequirementCore.TriggerKind.UI_CLOSED, event.key)


func _on_content_event(event: EventBase) -> void:
	var type: Script = event.get_script()
	RequirementCore._on_content_event(type)


func _on_day_changed(_event: DayChangedEvent) -> void:
	RequirementCore._mark_time_watches()
