extends Node
## Core node of `TutorialCore`: the frame check, the scene and UserState events, the tutorial view buttons, the view
## focus accept callback, the UI pointer observer, the requirement watch callbacks and the deferred calls.

const _WAIT := preload("res://core/tutorial_core/tutorial_block_wait.gd")

var advance_call: Callable = Callable()
var skip_call: Callable = Callable()
var accept_call: Callable = Callable()
var pointer_call: Callable = Callable()
var tap_end_call: Callable = Callable()
var start_check_call: Callable = Callable()
var step_requirement_call: Callable = Callable()
var start_requirement_call: Callable = Callable()
var save_failure_call: Callable = Callable()
var send_call: Callable = Callable()
var load_view_call: Callable = Callable()
var block_call: Callable = Callable()


func _init() -> void:
	advance_call = _on_advance_click
	skip_call = _on_skip_click
	accept_call = _on_accept
	pointer_call = _on_pointer
	tap_end_call = _on_tap_end
	start_check_call = _on_deferred_start_check
	step_requirement_call = _on_step_requirement
	start_requirement_call = _on_start_requirement
	save_failure_call = _on_save_failure
	send_call = _on_send
	load_view_call = _on_load_view
	block_call = _on_block


func _process(_delta: float) -> void:
	TutorialCore._on_frame()


func _on_scene_started(_event: SceneStartedEvent) -> void:
	TutorialCore._on_scene_started()


func _on_scene_ended(_event: SceneEndedEvent) -> void:
	TutorialCore._on_scene_ended()


func _on_user_state_changed(_event: UserStateChangedEvent) -> void:
	TutorialCore._on_user_state_changed()


func _on_advance_click() -> void:
	TutorialCore._on_advance_click()


func _on_skip_click() -> void:
	TutorialCore._on_skip_click()


func _on_accept(element: Control) -> void:
	TutorialCore._on_accept(element)


func _on_pointer(pointer_id: int, pressed: bool, position: Vector2) -> void:
	TutorialCore._on_pointer(pointer_id, pressed, position)


func _on_tap_end() -> void:
	TutorialCore._on_tap_end()


func _on_deferred_start_check(session: RefCounted) -> void:
	TutorialCore._on_deferred_start_check(session)


func _on_step_requirement(requirement_id: int, result: RequirementResult) -> void:
	TutorialCore._on_step_requirement(requirement_id, result)


func _on_start_requirement(requirement_id: int, result: RequirementResult) -> void:
	TutorialCore._on_start_requirement(requirement_id, result)


func _on_send(session: RefCounted, tutorial_id: int, step: int) -> void:
	TutorialCore._send_now(session, tutorial_id, step)


func _on_load_view(session: RefCounted) -> void:
	TutorialCore._load_view(session)


func _on_block(session: RefCounted, wait: _WAIT) -> void:
	TutorialCore._run_block(session, wait)


## A failed `SaveTutorialProgress` goes on without a screen: the next save or the resend sends the step again.
func _on_save_failure(_failure: RequestFailure) -> bool:
	return true


func _exit_tree() -> void:
	TutorialCore._on_node_exit(self)
