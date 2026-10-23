class_name LoadingScreenBase
extends Control
## Base of the root script of the loading screen resource. `SceneCore` puts the loading screen under the safe area
## root of the `Loading` layer. Fades and flashes are requested on the `Transition` channel of `ScreenEffectCore` with
## this root as the owner.


## Stage 1: the loading screen is shown for a transition to `scene_key`. May await.
func on_show(_scene_key: String) -> void:
	pass


## The progress of the transition in permille: when the loading screen is shown and when the progress changes.
func on_progress(_progress_permille: int) -> void:
	pass


## Stage 8: the loading screen is about to be hidden. May await.
func on_hide() -> void:
	pass
