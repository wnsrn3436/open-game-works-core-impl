extends RefCounted
## One started wait choice command (`Move`, `Animate`, `Camera`, `ScreenEffect`, `Staging`) of a playback.

## Number of the command in the module session; signal callbacks and waits find the command by it.
var serial: int = 0
var command: GameData.CutsceneCommand = GameData.CutsceneCommand.NONE
## True once the command ended: it finished, it was finalized or stopped, or its actor was destroyed.
var done: bool = false
## Instance ID of the actor node. 0: none.
var actor_id: int = 0
## `TweenCore` tween handle of `Move`.
var tween: int = 0
## The `AnimationPlayer` of `Animate` and of a staging with an end.
var player: AnimationPlayer = null
## The animation `Animate` or the staging plays.
var animation: StringName = &""
## The `animation_finished` callback connected to `player`.
var finished: Callable = Callable()
## The target position of `Camera`.
var camera_position: Vector3 = Vector3.ZERO
## The `ScreenEffectCore` handle of `ScreenEffect`.
var effect: ScreenEffectHandle = null
## The instance of a staging with an end.
var instance: Node = null
## Instance ID of `instance`.
var instance_id: int = 0
