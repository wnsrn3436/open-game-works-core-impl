class_name BenchLobbyScene
extends SceneBase
## Lobby scene. Its root panel holds the lobby buttons. A start that comes from the arena ends a benchmark cycle.


func on_start() -> void:
	var param: BenchLobbyParam = scene_param as BenchLobbyParam
	if param == null or not param.from_arena:
		return
	EventCore.publish(EventCore.acquire(BenchCycleCompletedEvent))
