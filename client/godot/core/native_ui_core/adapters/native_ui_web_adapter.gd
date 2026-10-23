class_name NativeUiWebAdapter
extends NativeUiAdapter
## Native adapter of the browser runtime: the Web Share API (`navigator.share`). No store review request window. A
## share with an image needs `navigator.canShare` to accept a PNG file. A share the user cancels (`AbortError`) is a
## closed window. The adapter reads the page state once a frame until the share ends or `stop`; a share it stops
## waiting for is marked dropped, so its late result is not kept.

const _STATE: String = "window.ogwNativeUiShare"

## New object every `stop`: a share wait that finds another object ends.
var _life: RefCounted = RefCounted.new()


func supports_share(has_image: bool) -> bool:
	return _eval(
		(
			"(function(){try{if(!navigator.share){return \"0\";}if(!%s){return \"1\";}"
			+ "if(!navigator.canShare){return \"0\";}"
			+ "return navigator.canShare({files:[new File([new Uint8Array(0)],\"share.png\",{type:\"image/png\"})]})"
			+ "?\"1\":\"0\";}catch(e){return \"0\";}})()"
		)
		% ("true" if has_image else "false")
	) == "1"


func share(text: String, image: PackedByteArray) -> NativeUiCore.ShareResult:
	if OS.get_name() != "Web":
		return NativeUiCore.ShareResult.UNSUPPORTED
	# `Marshalls.raw_to_base64` of empty bytes is an engine error: a share without an image passes an empty text.
	var png: String = "" if image.is_empty() else Marshalls.raw_to_base64(image)
	var id: String = _eval(
		(
			"(function(){try{var s=%s=%s||{next:1,results:{},dropped:{}};var id=s.next++;var d={};var t=%s;"
			+ "if(t.length>0){d.text=t;}var b=%s;if(b.length>0){var r=atob(b);var a=new Uint8Array(r.length);"
			+ "for(var i=0;i<r.length;i++){a[i]=r.charCodeAt(i);}"
			+ "d.files=[new File([a],\"share.png\",{type:\"image/png\"})];}"
			+ "function end(v){if(s.dropped[id]){delete s.dropped[id];}else{s.results[id]=v;}}"
			+ "navigator.share(d).then(function(){end(\"0\");},"
			+ "function(e){end((e&&e.name===\"AbortError\")?\"0\":\"1\");});return String(id);}"
			+ "catch(e){return \"\";}})()"
		)
		% [_STATE, _STATE, JSON.stringify(text), JSON.stringify(png)]
	)
	if not id.is_valid_int():
		return NativeUiCore.ShareResult.FAILED
	var life: RefCounted = _life
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	while tree != null and life == _life:
		var reply: String = _eval(
			(
				"(function(){var s=%s;if(!s){return \"1\";}var r=s.results[%s];if(r===undefined){return \"\";}"
				+ "delete s.results[%s];return r;})()"
			)
			% [_STATE, id, id]
		)
		if reply == "0":
			return NativeUiCore.ShareResult.CLOSED
		if not reply.is_empty():
			return NativeUiCore.ShareResult.FAILED
		await tree.process_frame
	_eval(
		(
			"(function(){var s=%s;if(s){if(s.results[%s]!==undefined){delete s.results[%s];}else{s.dropped[%s]=true;}}"
			+ "return \"0\";})()"
		)
		% [_STATE, id, id, id]
	)
	return NativeUiCore.ShareResult.FAILED


func stop() -> void:
	_life = RefCounted.new()


## Runs `code` in the page and returns its string reply. Empty outside the browser runtime and for a reply that is
## not a string.
# ogw:input_boundary
static func _eval(code: String) -> String:
	if OS.get_name() != "Web":
		return ""
	var reply: Variant = JavaScriptBridge.eval(code, true)
	if reply is String:
		var text: String = reply
		return text
	return ""
