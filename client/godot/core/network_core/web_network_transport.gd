extends NetworkTransport
## The `NetworkTransport` of the browser runtime: the page `fetch` through `JavaScriptBridge`. The engine HTTP client
## of the web export is `fetch` with the default redirect mode, which follows redirects whatever `max_redirects` is,
## so this transport asks `fetch` with `redirect: "manual"` and stops reading the body over
## `NetworkCore.responseMaxBytes`. The page script keeps the sends in `window.ogwNetworkFetch`, which this object
## reads once a frame.

const _STATE: String = "window.ogwNetworkFetch"
## Starts a send and replies its id, or an empty string.
const _START: String = """(function(){try{var s=%s=%s||{next:1,sends:{}};var id=s.next++;var max=%d;
var c=new AbortController();var e={c:c,r:""};s.sends[id]=e;var h=new Headers();var l=%s;
for(var i=0;i<l.length;i++){h.append(l[i][0],l[i][1]);}var t=atob(%s);var b=new Uint8Array(t.length);
for(var i=0;i<t.length;i++){b[i]=t.charCodeAt(i);}
function end(v){if(e.r===""){e.r=v;}}
fetch(%s,{method:"POST",headers:h,body:b,redirect:"manual",cache:"no-store",signal:c.signal}).then(function(r){
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
## Replies the result of a send and forgets it: empty while it waits, `F` for no response, `R<status>` for a redirect,
## `L<status>` for a body over the limit and `D<status>:<base64 body>` for a received response.
const _POLL: String = """(function(){var s=%s;var e=s&&s.sends[%s];if(!e){return "F";}if(e.r===""){return "";}
delete s.sends[%s];return e.r;})()"""
const _CANCEL: String = """(function(){var s=%s;var e=s&&s.sends[%s];if(e){e.c.abort();delete s.sends[%s];}return "0";})()"""

var _parent: Node = null
var _max_bytes: int = 0
## Page id of the send of each handle that is waiting.
var _ids: Dictionary[int, String] = {}


func _init(parent: Node, max_bytes: int) -> void:
	_parent = parent
	_max_bytes = max_bytes


func send(handle: int, url: String, headers: PackedStringArray, body: PackedByteArray) -> NetworkTransportResult:
	var result: NetworkTransportResult = NetworkTransportResult.new()
	result.handle = handle
	if not is_instance_valid(_parent) or not _parent.is_inside_tree():
		return result
	cancel(handle)
	var pairs: Array[PackedStringArray] = []
	for line: String in headers:
		var colon: int = line.find(":")
		if colon <= 0:
			return result
		pairs.append(PackedStringArray([line.substr(0, colon).strip_edges(), line.substr(colon + 1).strip_edges()]))
	# `Marshalls.raw_to_base64` fails on an empty array.
	var body_base64: String = "" if body.is_empty() else Marshalls.raw_to_base64(body)
	var id: String = _eval(_START % [_STATE, _STATE, _max_bytes, JSON.stringify(pairs), JSON.stringify(body_base64), JSON.stringify(url)])
	if not id.is_valid_int():
		return result
	_ids[handle] = id
	var tree: SceneTree = _parent.get_tree()
	while _waits(handle, id):
		await tree.process_frame
		if not _waits(handle, id):
			return result
		var reply: String = _eval(_POLL % [_STATE, id, id])
		if not reply.is_empty():
			_ids.erase(handle)
			_read_reply(reply, result)
			return result
	return result


func cancel(handle: int) -> void:
	if not _ids.has(handle):
		return
	var id: String = _ids[handle]
	_ids.erase(handle)
	_eval(_CANCEL % [_STATE, id, id])


## True while the send of `handle` is the page send `id` and was not cancelled.
func _waits(handle: int, id: String) -> bool:
	return _ids.has(handle) and _ids[handle] == id


func _read_reply(reply: String, result: NetworkTransportResult) -> void:
	var kind: String = reply.substr(0, 1)
	var rest: String = reply.substr(1)
	var status_text: String = rest
	var colon: int = rest.find(":")
	if kind == "D":
		if colon < 0:
			return
		status_text = rest.substr(0, colon)
	if not status_text.is_valid_int():
		return
	match kind:
		"R":
			result.http_status = status_text.to_int()
			result.transfer = NetworkCore.TransferResult.REDIRECTED
		"L":
			result.http_status = status_text.to_int()
			result.transfer = NetworkCore.TransferResult.TOO_LARGE
		"D":
			result.http_status = status_text.to_int()
			result.transfer = NetworkCore.TransferResult.DONE
			var body_base64: String = rest.substr(colon + 1)
			if not body_base64.is_empty():
				result.body = Marshalls.base64_to_raw(body_base64)


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
