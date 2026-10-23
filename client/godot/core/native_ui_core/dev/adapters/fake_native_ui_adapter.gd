class_name FakeNativeUiAdapter
extends NativeUiAdapter
## Fake native adapter of every platform. Supports the review and the share and shows no window. `request_review`
## counts and returns the `NativeUiCoreDev.set_fake_review_result` value; `share` records its content and returns the
## `NativeUiCoreDev.set_fake_share_result` value of the call time on the next frame.

var review_count: int = 0
var share_count: int = 0
## Text of the last share.
var last_text: String = ""
## Image byte count of the last share.
var last_image_bytes: int = 0


func supports_review() -> bool:
	return true


func request_review() -> bool:
	review_count += 1
	return NativeUiCore._fake_review_result


func supports_share(_has_image: bool) -> bool:
	return true


func share(text: String, image: PackedByteArray) -> NativeUiCore.ShareResult:
	share_count += 1
	last_text = text
	last_image_bytes = image.size()
	var result: NativeUiCore.ShareResult = NativeUiCore._fake_share_result
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree != null:
		await tree.process_frame
	return result
