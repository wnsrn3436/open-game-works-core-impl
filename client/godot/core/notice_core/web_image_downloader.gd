extends ImageDownloader
## Default `ImageDownloader` of the browser runtime: the page `fetch` through `JavaScriptBridge`. The engine HTTP
## client of the web export is `fetch` with the default redirect mode, which follows redirects whatever
## `max_redirects` is, so this downloader asks `fetch` with `redirect: "manual"` and stops reading the body over the
## max bytes. The page script keeps the downloads in `window.ogwNoticeImageFetch`, which this object reads once a
## frame of the tree of the `NoticeCore` core node.

## Emitted when the running `download` ends or is cancelled.
signal finished

const _CORE_NODE = preload("res://core/notice_core/notice_core_node.gd")
const _STATE: String = "window.ogwNoticeImageFetch"
## Starts a download and replies its id, or an empty string.
const _START: String = """(function(){try{var s=%s=%s||{next:1,sends:{}};var id=s.next++;var max=%d;
var c=new AbortController();var e={c:c,r:""};s.sends[id]=e;
function end(v){if(e.r===""){e.r=v;}}
fetch(%s,{method:"GET",redirect:"manual",cache:"no-store",signal:c.signal}).then(function(r){
if(r.type==="opaqueredirect"||(r.status>=300&&r.status<400)){c.abort();end("R"+r.status);return;}
var n=r.headers.get("Content-Length");if(n!==null&&/^[0-9]+$/.test(n)&&Number(n)>max){c.abort();end("L"+r.status);return;}
if(!r.body){return r.arrayBuffer().then(function(a){var u=new Uint8Array(a);
if(u.length>max){end("L"+r.status);return;}done(r.status,[u],u.length);});}
var d=r.body.getReader();var parts=[];var size=0;
function next(){return d.read().then(function(p){if(p.done){done(r.status,parts,size);return;}size+=p.value.length;
if(size>max){c.abort();end("L"+r.status);return;}parts.push(p.value);return next();});}
return next();}).catch(function(){end("F");});
function done(status,parts,size){var u=new Uint8Array(size);var o=0;for(var i=0;i<parts.length;i++){u.set(parts[i],o);o+=parts[i].length;}
var x="";for(var i=0;i<u.length;i+=32768){x+=String.fromCharCode.apply(null,u.subarray(i,i+32768));}end("D"+status+":"+btoa(x));}
return String(id);}catch(err){return "";}})()"""
## Replies the result of a download and forgets it: empty while it waits, `F` for no response, `R<status>` for a
## redirect, `L<status>` for a body over the limit and `D<status>:<base64 body>` for a received response.
const _POLL: String = """(function(){var s=%s;var e=s&&s.sends[%s];if(!e){return "F";}if(e.r===""){return "";}
delete s.sends[%s];return e.r;})()"""
const _CANCEL: String = """(function(){var s=%s;var e=s&&s.sends[%s];if(e){e.c.abort();delete s.sends[%s];}return "0";})()"""

var _node: _CORE_NODE = null
## Page id of the download that is waiting; empty when none.
var _id: String = ""
## Tree whose `process_frame` polls the waiting download.
var _tree: SceneTree = null
var _result: ImageDownloader.DownloadResult = null


func _init(node: _CORE_NODE) -> void:
	_node = node


func download(url: String, max_bytes: int) -> ImageDownloader.DownloadResult:
	var failed: ImageDownloader.DownloadResult = ImageDownloader.DownloadResult.new()
	if not _id.is_empty() or not is_instance_valid(_node) or not _node.is_inside_tree():
		return failed
	var id: String = _eval(_START % [_STATE, _STATE, max_bytes, JSON.stringify(url)])
	if not id.is_valid_int():
		return failed
	_id = id
	_tree = _node.get_tree()
	if _tree.process_frame.connect(_poll) != OK:
		_eval(_CANCEL % [_STATE, id, id])
		_id = ""
		_tree = null
		return failed
	await finished
	var result: ImageDownloader.DownloadResult = _result
	_result = null
	return result if result != null else failed


func cancel() -> void:
	if _id.is_empty():
		return
	_eval(_CANCEL % [_STATE, _id, _id])
	var result: ImageDownloader.DownloadResult = ImageDownloader.DownloadResult.new()
	result.status = NoticeCore.DownloadStatus.CANCELLED
	_finish(result)


func _poll() -> void:
	if _id.is_empty():
		return
	var reply: String = _eval(_POLL % [_STATE, _id, _id])
	if not reply.is_empty():
		_finish(_read_reply(reply))


func _finish(result: ImageDownloader.DownloadResult) -> void:
	_id = ""
	if is_instance_valid(_tree) and _tree.process_frame.is_connected(_poll):
		_tree.process_frame.disconnect(_poll)
	_tree = null
	_result = result
	finished.emit()


static func _read_reply(reply: String) -> ImageDownloader.DownloadResult:
	var result: ImageDownloader.DownloadResult = ImageDownloader.DownloadResult.new()
	var kind: String = reply.substr(0, 1)
	var rest: String = reply.substr(1)
	var status_text: String = rest
	var colon: int = rest.find(":")
	if kind == "D":
		if colon < 0:
			return result
		status_text = rest.substr(0, colon)
	if not status_text.is_valid_int():
		return result
	match kind:
		"R":
			result.http_status = status_text.to_int()
		"L":
			result.http_status = status_text.to_int()
			result.status = NoticeCore.DownloadStatus.TOO_LARGE
		"D":
			result.http_status = status_text.to_int()
			result.status = NoticeCore.DownloadStatus.DONE
			var body_base64: String = rest.substr(colon + 1)
			if not body_base64.is_empty():
				result.body = Marshalls.base64_to_raw(body_base64)
	return result


## Runs `code` in the page and returns its string reply. Empty for a reply that is not a string.
# ogw:input_boundary
static func _eval(code: String) -> String:
	if OS.get_name() != "Web":
		return ""
	var reply: Variant = JavaScriptBridge.eval(code, true)
	if reply is String:
		var text: String = reply
		return text
	return ""
