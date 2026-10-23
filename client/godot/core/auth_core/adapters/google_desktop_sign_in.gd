extends RefCounted
## Google sign-in of `windows`, `macos` and `linux`: installed app OAuth with PKCE and a loopback listener. The
## credential is the authorization code that server `auth` exchanges; the client secret stays on the server.

const _AUTH_URL: String = "https://accounts.google.com/o/oauth2/v2/auth"
const _HOST: String = "127.0.0.1"
## Bytes of one request this listener reads at most: the request line and headers.
const _MAX_REQUEST_BYTES: int = 16384

var _server: TCPServer = null
var _peers: Array[StreamPeerTCP] = []
var _buffers: Array[PackedByteArray] = []
## True after `stop`: the wait ends with `FAILED` and closes the listener.
var _stopped: bool = false


## Ends a running `sign_in` with `FAILED` and closes the listener at its next frame.
func stop() -> void:
	_stopped = true


func sign_in(client_id: String, timeout_ms: int, open_url: Callable) -> SocialAdapter.SignInResult:
	var start: int = TimeCore.get_real_time()
	_server = TCPServer.new()
	if client_id.is_empty() or _server.listen(0, _HOST) != OK:
		return _fail()
	var redirect_uri: String = "http://%s:%d" % [_HOST, _server.get_local_port()]
	var crypto: Crypto = Crypto.new()
	var verifier: String = _base64url(crypto.generate_random_bytes(32))
	var state: String = _base64url(crypto.generate_random_bytes(32))
	var url: String = (
		"%s?client_id=%s&redirect_uri=%s&response_type=code&scope=openid&code_challenge=%s"
		+ "&code_challenge_method=S256&state=%s"
	) % [
		_AUTH_URL,
		client_id.uri_encode(),
		redirect_uri.uri_encode(),
		_base64url(_sha256(verifier.to_utf8_buffer())),
		state.uri_encode(),
	]
	if not open_url.is_valid() or open_url.call(url) != true:
		return _fail()
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	while tree != null and not _stopped and TimeCore.get_real_time() - start < timeout_ms:
		var query: Dictionary[String, String] = _poll()
		if not query.is_empty():
			_close()
			var code: String = query["code"] if query.has("code") else ""
			var got_state: String = query["state"] if query.has("state") else ""
			if got_state != state or query.has("error") or code.is_empty():
				return SocialAdapter.SignInResult.new(SocialAdapter.SignInStatus.FAILED)
			var credential: Dictionary[String, String] = {
				"authorization_code": code,
				"code_verifier": verifier,
				"redirect_uri": redirect_uri,
			}
			return SocialAdapter.SignInResult.new(SocialAdapter.SignInStatus.SUCCESS, JSON.stringify(credential))
		await tree.process_frame
	return _fail()


## Accepts and reads the waiting connections. Returns the query of the first request that has `state` or `error`,
## after the reply is sent; an empty dictionary until then. Other requests get 404.
func _poll() -> Dictionary[String, String]:
	while _server.is_connection_available():
		var peer: StreamPeerTCP = _server.take_connection()
		if peer != null:
			_peers.append(peer)
			_buffers.append(PackedByteArray())
	var i: int = _peers.size() - 1
	while i >= 0:
		var peer: StreamPeerTCP = _peers[i]
		peer.poll()
		if peer.get_status() != StreamPeerTCP.STATUS_CONNECTED:
			_drop(i)
			i -= 1
			continue
		var buffer: PackedByteArray = _buffers[i]
		buffer.append_array(_read_available(peer))
		_buffers[i] = buffer
		var text: String = buffer.get_string_from_utf8()
		var line_end: int = text.find("\r\n")
		if line_end >= 0:
			var query: Dictionary[String, String] = _query_of(text.substr(0, line_end))
			if query.has("state") or query.has("error"):
				_reply(peer, 200, LocalizationCore.get_text(ReservedString.auth_google_desktop_done()).xml_escape())
				_drop(i)
				return query
			_reply(peer, 404, "")
			_drop(i)
		elif buffer.size() > _MAX_REQUEST_BYTES:
			_drop(i)
		i -= 1
	return {}


# ogw:input_boundary
func _read_available(peer: StreamPeerTCP) -> PackedByteArray:
	var available: int = peer.get_available_bytes()
	if available <= 0:
		return PackedByteArray()
	var chunk: Array = peer.get_partial_data(available)
	if chunk.size() != 2 or chunk[0] != OK or not chunk[1] is PackedByteArray:
		return PackedByteArray()
	var data: PackedByteArray = chunk[1]
	return data


## Query of a request line `GET <target> HTTP/1.1`.
func _query_of(line: String) -> Dictionary[String, String]:
	var query: Dictionary[String, String] = {}
	var parts: PackedStringArray = line.split(" ")
	if parts.size() != 3:
		return query
	var mark: int = parts[1].find("?")
	if mark < 0:
		return query
	for pair: String in parts[1].substr(mark + 1).split("&", false):
		var equals: int = pair.find("=")
		var key: String = (pair if equals < 0 else pair.substr(0, equals)).uri_decode()
		if not query.has(key):
			query[key] = "" if equals < 0 else pair.substr(equals + 1).uri_decode()
	return query


func _reply(peer: StreamPeerTCP, status: int, body: String) -> void:
	var content: PackedByteArray = (
		("<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body>%s</body></html>" % body).to_utf8_buffer()
		if status == 200
		else PackedByteArray()
	)
	var head: String = "HTTP/1.1 %s\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: %d\r\nConnection: close\r\n\r\n" % [
		"200 OK" if status == 200 else "404 Not Found",
		content.size(),
	]
	var bytes: PackedByteArray = head.to_utf8_buffer()
	bytes.append_array(content)
	if peer.put_data(bytes) != OK:
		return


func _drop(index: int) -> void:
	_peers[index].disconnect_from_host()
	_peers.remove_at(index)
	_buffers.remove_at(index)


func _close() -> void:
	while not _peers.is_empty():
		_drop(_peers.size() - 1)
	if _server != null:
		_server.stop()


func _fail() -> SocialAdapter.SignInResult:
	_close()
	return SocialAdapter.SignInResult.new(SocialAdapter.SignInStatus.FAILED)


static func _sha256(bytes: PackedByteArray) -> PackedByteArray:
	var context: HashingContext = HashingContext.new()
	if context.start(HashingContext.HASH_SHA256) != OK or context.update(bytes) != OK:
		return PackedByteArray()
	return context.finish()


static func _base64url(bytes: PackedByteArray) -> String:
	return Marshalls.raw_to_base64(bytes).replace("+", "-").replace("/", "_").replace("=", "")
