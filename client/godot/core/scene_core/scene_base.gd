class_name SceneBase
extends Node
## Base of the root script of a scene resource. `SceneCore` fills `scene_key`, `scene_param` and `scope` in stage 4
## of a transition; scene code only reads them. Scene code overrides the callbacks it needs.

## Panel key of the root panel `SceneCore` opens in stage 7. An empty string: no root panel.
@export var root_panel: String = ""
## Scene UI root: the UI element under this scene that `SceneCore` moves under the `SceneUI` layer in stage 7.
## null: no scene UI root.
@export var ui_root: Control = null

var scene_key: String = ""
## Scene param of the transition. null: none.
var scene_param: RefCounted = null
## Resource scope of this scene.
var scope: Scope = null


## Stage 2: the scene is about to be destroyed.
func on_exit() -> void:
	pass


## Stage 5: puts the resources to preload into `preload_request` and the pools to fill into `prefill_items`.
func on_preload(_preload_request: PreloadRequest, _prefill_items: Array[PrefillItem]) -> void:
	pass


## Stage 6: asks the server for the values the scene uses. May await. `false` opens the retry popup.
func on_prepare() -> bool:
	return true


## Stage 7: the scene is visible. May await.
func on_start() -> void:
	pass
