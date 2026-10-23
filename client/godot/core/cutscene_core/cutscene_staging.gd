class_name CutsceneStaging
extends Node
## Staging component: a child of the root of a staging instance. `CutsceneCore` plays `animation` when the staging
## starts; the staging ends when it finishes. Without this component, or with a repeating animation, the staging has no
## end.

@export var animation_player: AnimationPlayer = null
@export var animation: String = ""
