extends Node
## Subscriber of the SceneCore core tests: records `SceneEndedEvent`, `SceneStartedEvent` and the boot events in the
## scene trace and keeps what it saw when they came.

const Trace := preload("res://core/scene_core/tests/support/scene_trace.gd")

var fatal_count: int = 0
var restart_count: int = 0
## Active blocks with reason tag `scene` when `FatalErrorRequestedEvent` came.
var fatal_scene_blocks: int = -1
## `SceneCore.is_transitioning` and the payload when `SceneStartedEvent` came.
var started_transitioning: bool = true
var started_duration_ms: int = -1
## Active block count when `SceneStartedEvent` came.
var started_block_count: int = -1


func subscribe() -> void:
	EventCore.subscribe(SceneEndedEvent, _on_scene_ended)
	EventCore.subscribe(SceneStartedEvent, _on_scene_started)
	EventCore.subscribe(FatalErrorRequestedEvent, _on_fatal)
	EventCore.subscribe(RestartRequestedEvent, _on_restart)
	ResourceCore.add_scope_release_listener(_on_scope_released)


# The modules may outlive the probe: its scope release listener goes with it.
func _exit_tree() -> void:
	if ResourceCore.is_initialized():
		ResourceCore.remove_scope_release_listener(_on_scope_released)


func _on_scene_ended(event: SceneEndedEvent) -> void:
	Trace.add("ended:" + event.scene_key)


func _on_scene_started(event: SceneStartedEvent) -> void:
	started_transitioning = SceneCore.is_transitioning()
	started_duration_ms = event.duration_ms
	started_block_count = InputBlockCoreDev.count_active()
	Trace.add("started:" + event.scene_key)


func _on_fatal(event: FatalErrorRequestedEvent) -> void:
	if event.module != "SceneCore":
		return
	fatal_count += 1
	var blocks: Array[ActiveBlockInfo] = []
	blocks.resize(16)
	var scene_blocks: int = 0
	var count: int = InputBlockCoreDev.list_active(blocks)
	for i: int in count:
		if blocks[i].reason == "scene":
			scene_blocks += 1
	fatal_scene_blocks = scene_blocks
	Trace.add("fatal")


func _on_restart(event: RestartRequestedEvent) -> void:
	if event.module != "SceneCore":
		return
	restart_count += 1
	Trace.add("restart")


func _on_scope_released(scope: Scope) -> void:
	if scope.kind == ResourceCore.ScopeKind.SCENE:
		Trace.add("scope_released:" + scope.name)
