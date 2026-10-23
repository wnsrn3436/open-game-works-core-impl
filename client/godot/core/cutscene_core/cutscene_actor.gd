class_name CutsceneActor
extends Node
## Actor component: a child of an actor node (`Node2D` or `Node3D`). It registers its parent with `actor_key` when it
## is ready and unregisters it when it leaves the tree.

## The actor key, from data.
@export var actor_key: String = ""
## The `AnimationPlayer` of the actor that `Animate` plays. `null`: the actor has no animation.
@export var animation_player: AnimationPlayer = null


func _ready() -> void:
	CutsceneCore.register_actor(actor_key, get_parent())


func _exit_tree() -> void:
	if CutsceneCore.is_initialized() and CutsceneCore._is_registered(actor_key, get_parent()):
		CutsceneCore.unregister_actor(actor_key)
