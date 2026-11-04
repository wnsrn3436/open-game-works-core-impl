extends Node
## Stop check node of `SceneCore`: processes before every other node in the frame and in the physics frame, so that a
## node under the scene holder that scene code gave a `process_mode` of its own is disabled before its own callback.
## It processes only from stage 4 until the hiding of the new scene ends.


func _process(_delta: float) -> void:
	SceneCore._check_stopped()


func _physics_process(_delta: float) -> void:
	SceneCore._check_stopped()
