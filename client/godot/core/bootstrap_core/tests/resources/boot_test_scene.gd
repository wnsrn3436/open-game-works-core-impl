extends SceneBase
## Scene root of the BootstrapCore core test scenes. Counts the scene starts and runs `start_hook` when a scene
## starts, while `SceneCore` still runs the transition.

static var start_count: int = 0
## Called with the scene key when a scene starts. A test sets it and clears it.
static var start_hook: Callable = Callable()


func on_start() -> void:
	start_count += 1
	if start_hook.is_valid():
		start_hook.call(scene_key)
