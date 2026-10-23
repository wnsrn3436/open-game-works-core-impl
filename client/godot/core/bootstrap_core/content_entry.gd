class_name ContentEntry
extends RefCounted
## Content entry of `BootstrapCore`: the object the content code under `client/boot/` makes and passes to
## `start_boot`. The content code extends it and overrides the hooks.


## Hook `content_init`, called in `ContentInit`. Registers the content hooks of core modules and makes the
## content state. Does not wait. Returns the success flag.
func content_init() -> bool:
	return true


## Hook `content_release`, called first in a reverse release when this boot called `content_init`. Clears the
## content state and the content event subscriptions.
func content_release() -> void:
	pass


## Hook `select_first_scene`, called in `FirstScene`. Returns the scene key of the first scene.
func select_first_scene() -> String:
	return BootstrapCore.get_first_scene()
