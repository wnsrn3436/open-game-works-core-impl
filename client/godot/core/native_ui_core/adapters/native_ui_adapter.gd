class_name NativeUiAdapter
extends RefCounted
## Base of the native adapters of `NativeUiCore`: the store review request window and the share window of one
## platform. `BootstrapCore` passes the adapter of the build info `platform` with `NativeUiCore.set_native_adapter`.
## This base supports neither.


## Whether the platform has a store review request window.
func supports_review() -> bool:
	return false


## Asks the OS for the store review request window. True when the OS took the request.
func request_review() -> bool:
	return false


## Whether the platform can open a share window for a share with an image (`has_image`) or without one.
func supports_share(_has_image: bool) -> bool:
	return false


## Opens the share window with `text` and the PNG `image` (empty for none) and waits until it closes. Async.
func share(_text: String, _image: PackedByteArray) -> NativeUiCore.ShareResult:
	return NativeUiCore.ShareResult.UNSUPPORTED


## Ends the `share` that waits with `Failed`. `NativeUiCore.release` calls it before it drops the adapter.
func stop() -> void:
	pass
