extends Node
## Subscriber of the ShortcutCore core tests: records the events of a navigation in the trace.
## `scene_ended:<scene>`, `scene_started:<scene>`, `flow:<open|close>:<panel>:<success>`, `opened:<panel>`,
## `closed:<panel or popup>:<reason>`, `navigated:<shortcut ID>`.

const Trace := preload("res://core/shortcut_core/tests/support/shortcut_trace.gd")

## The `ShortcutNavigatedEvent` payloads, in order: shortcut ID, scene key and panel keys.
var navigated_ids: PackedInt64Array = PackedInt64Array()
var navigated_scenes: PackedStringArray = PackedStringArray()
var navigated_panels: Array[PackedStringArray] = []
## `ShortcutCore.is_navigating` when the last `ShortcutNavigatedEvent` came.
var navigating_at_event: bool = true


func subscribe() -> void:
	EventCore.subscribe(SceneEndedEvent, _on_scene_ended)
	EventCore.subscribe(SceneStartedEvent, _on_scene_started)
	EventCore.subscribe(PanelFlowFinishedEvent, _on_flow)
	EventCore.subscribe(UIOpenedEvent, _on_opened)
	EventCore.subscribe(UIClosedEvent, _on_closed)
	EventCore.subscribe(ShortcutNavigatedEvent, _on_navigated)


func _on_scene_ended(event: SceneEndedEvent) -> void:
	Trace.add("scene_ended:" + Trace.short(event.scene_key))


func _on_scene_started(event: SceneStartedEvent) -> void:
	Trace.add("scene_started:" + Trace.short(event.scene_key))


func _on_flow(event: PanelFlowFinishedEvent) -> void:
	Trace.add("flow:%s:%s:%s" % ["open" if event.is_open else "close", Trace.short(event.panel_key), event.success])


func _on_opened(event: UIOpenedEvent) -> void:
	if event.is_panel:
		Trace.add("opened:" + Trace.short(event.key))


func _on_closed(event: UIClosedEvent) -> void:
	var reason: String = "covered" if event.reason == UICore.PanelCloseReason.COVERED else "closed"
	Trace.add("closed:%s:%s" % [Trace.short(event.key), reason])


func _on_navigated(event: ShortcutNavigatedEvent) -> void:
	navigating_at_event = ShortcutCore.is_navigating()
	navigated_ids.append(event.shortcut_id)
	navigated_scenes.append(event.scene_key)
	navigated_panels.append(PackedStringArray(event.panel_keys))
	Trace.add("navigated:%d" % event.shortcut_id)
