extends Node
## Core node of `QACore`: the engine frame, the telemetry event subscriptions, the debug input handler and the debug
## screen command line.

const _TELEMETRY := preload("res://core/qa_core/dev/qa_telemetry.gd")

## Emitted at the start of every frame, after the device inputs of the input commands are put in and before the
## frame's process callbacks.
signal frame_started
## Emitted every frame after the frame's process callbacks.
signal frame_ended

## Set by `QACore.release`, so `_exit_tree` does not clean up twice.
var released: bool = false


## `SceneTree.process_frame`: it comes before the process callbacks of the frame. Frame code.
func on_process_frame() -> void:
	QACore._on_frame_start(self)


func _process(_delta: float) -> void:
	QACore._on_frame()


func _exit_tree() -> void:
	if not released:
		QACore._on_node_exit(self)


## Subscribes the telemetry and stats events. `CameraShakeStartedEvent` only when `camera` (`CameraCore` is in the
## module list). Returns whether every subscription succeeded.
func subscribe_events(camera: bool) -> bool:
	var ok: bool = EventCore.subscribe(SoundPlayedEvent, _on_sound_played)
	ok = EventCore.subscribe(ScreenEffectStartedEvent, _on_screen_effect_started) and ok
	ok = EventCore.subscribe(TweenStartedEvent, _on_tween_started) and ok
	ok = EventCore.subscribe(EffectSpawnedEvent, _on_effect_spawned) and ok
	ok = EventCore.subscribe(UIOpenedEvent, _on_ui_opened) and ok
	ok = EventCore.subscribe(UIClosedEvent, _on_ui_closed) and ok
	ok = EventCore.subscribe(SceneEndedEvent, _on_scene_ended) and ok
	ok = EventCore.subscribe(SceneStartedEvent, _on_scene_started) and ok
	ok = EventCore.subscribe(UserStateChangedEvent, _on_user_state_changed) and ok
	ok = EventCore.subscribe(ItemChangedEvent, _on_item_changed) and ok
	ok = EventCore.subscribe(BootCompletedEvent, _on_boot_completed) and ok
	if camera:
		ok = EventCore.subscribe(CameraShakeStartedEvent, _on_camera_shake_started) and ok
	return ok


func unsubscribe_events() -> void:
	if EventCore.is_initialized():
		EventCore.unsubscribe_all(self)


## The debug input handler of `InputCore`: whether the input opened or closed the debug screen.
func on_debug_input(event: InputEvent) -> bool:
	return QACore._on_debug_input(event)


## A command line typed on the debug screen.
func on_debug_run(line: String) -> void:
	QACore._on_debug_run(line)


func _on_sound_played(_event: SoundPlayedEvent) -> void:
	QACore._on_feedback(_TELEMETRY.Feedback.SOUND)


func _on_camera_shake_started(_event: CameraShakeStartedEvent) -> void:
	QACore._on_feedback(_TELEMETRY.Feedback.CAMERA_SHAKE)


func _on_screen_effect_started(_event: ScreenEffectStartedEvent) -> void:
	QACore._on_feedback(_TELEMETRY.Feedback.SCREEN_EFFECT)


func _on_tween_started(_event: TweenStartedEvent) -> void:
	QACore._on_feedback(_TELEMETRY.Feedback.TWEEN)


func _on_effect_spawned(_event: EffectSpawnedEvent) -> void:
	QACore._on_feedback(_TELEMETRY.Feedback.EFFECT)


func _on_ui_opened(_event: UIOpenedEvent) -> void:
	QACore._on_response_event()


func _on_ui_closed(_event: UIClosedEvent) -> void:
	QACore._on_response_event()


func _on_scene_ended(_event: SceneEndedEvent) -> void:
	QACore._on_response_event()


func _on_scene_started(event: SceneStartedEvent) -> void:
	QACore._on_scene_started(event.scene_key, event.duration_ms)


func _on_user_state_changed(_event: UserStateChangedEvent) -> void:
	QACore._on_state_only_event()


func _on_item_changed(event: ItemChangedEvent) -> void:
	QACore._on_item_changes(event.changes)


func _on_boot_completed(event: BootCompletedEvent) -> void:
	QACore._boot_ms = event.duration_ms
